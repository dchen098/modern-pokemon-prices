#!/usr/bin/env python3
"""Add every set of one series (era) to the site.

For each set in the series that isn't on the site yet, this downloads its card
list from PokemonTCG/pokemon-tcg-data, finds the matching TCGplayer group and
products on tcgcsv.com, and adds the cards with their current market price to
data/sets.csv, data/cards.csv and a new data/hist/<set>.csv.

Run from the repository root:
  python3 scripts/add_sets.py --series "Sun & Moon" --report report.txt
The report says which sets were added, how many cards got a price, and anything
that couldn't be matched.
"""
import argparse
import csv
import json
import os
import re
import time
import urllib.request

TCGCSV = 'https://tcgcsv.com'
CARD_DATA = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master'
USER_AGENT = 'modern-pokemon-prices set import (github.com/dchen098/modern-pokemon-prices)'
DATA = 'data'

# Set names that TCGplayer spells differently
GROUP_ALIASES = {
    'Sun & Moon': 'SM Base Set',
    'SM Black Star Promos': 'SM Promos',
    'SWSH Black Star Promos': 'SWSH: Sword & Shield Promo Cards',
    'Sword & Shield': 'SWSH01: Sword & Shield Base Set',
}
# Product names that are special printings rather than the main card
SPECIAL_PRINTING = re.compile(r'pattern|staff|prerelease|stamp|cosmos|jumbo|league|error|1st|ball', re.I)


def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def get_text(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


def squash(name):
    return re.sub(r'[^a-z0-9]', '', name.lower().replace('&', 'and'))


def group_key(name):
    # "SM - Burning Shadows", "SM11: Unified Minds", "SWSH07: Evolving Skies" -> set name
    name = re.sub(r'^(SM|SWSH|SV|ME)\d*\s*[-:]\s*', '', name)
    return squash(name)


def card_name_key(name):
    name = re.sub(r'\s+-\s+[a-z]*\d+[a-z]*(/[a-z]*\d+)?$', '', name, flags=re.I)
    return squash(name)


def number_key(num):
    m = re.match(r'^([A-Za-z]*)0*(\d+)([A-Za-z]*)$', str(num).split('/')[0].strip())
    return (m.group(1) + m.group(2) + m.group(3)).upper() if m else str(num).upper()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--series', required=True)
    ap.add_argument('--report', required=True)
    args = ap.parse_args()

    sets_path = os.path.join(DATA, 'sets.csv')
    sets = list(csv.DictReader(open(sets_path, encoding='utf-8')))
    set_fields = list(sets[0].keys())
    have = {s['set_id'] for s in sets}
    cards_path = os.path.join(DATA, 'cards.csv')
    cards = list(csv.DictReader(open(cards_path, encoding='utf-8')))
    card_fields = list(cards[0].keys())

    snap = get_text(f'{TCGCSV}/last-updated.txt').strip()[:10]
    all_sets = get_json(f'{CARD_DATA}/sets/en.json')
    wanted = [s for s in all_sets if s['series'] == args.series and s['id'] not in have]
    groups = get_json(f'{TCGCSV}/tcgplayer/3/groups')['results']
    by_key = {}
    for g in groups:
        by_key.setdefault(group_key(g['name']), []).append(g)

    report = []
    added_sets = added_cards = priced_cards = 0
    for s in sorted(wanted, key=lambda x: x['releaseDate']):
        target = GROUP_ALIASES.get(s['name'], s['name'])
        matches = by_key.get(group_key(target), [])
        if len(matches) != 1:
            report.append(f"SKIPPED {s['name']} ({s['id']}): {len(matches)} TCGplayer groups matched")
            continue
        g = matches[0]
        set_cards = get_json(f"{CARD_DATA}/cards/en/{s['id']}.json")
        products = get_json(f"{TCGCSV}/tcgplayer/3/{g['groupId']}/products")['results']
        price_rows = get_json(f"{TCGCSV}/tcgplayer/3/{g['groupId']}/prices")['results']
        time.sleep(0.25)
        prices = {}
        for p in price_rows:
            if p.get('marketPrice') is not None:
                prices.setdefault(p['productId'], {})[p['subTypeName']] = float(p['marketPrice'])
        by_number = {}
        for p in products:
            num = next((e['value'] for e in p.get('extendedData', []) if e['name'] == 'Number'), None)
            if num:
                by_number.setdefault(number_key(num), []).append(p)

        hist_rows = []
        set_priced = 0
        unmatched = []
        for c in set_cards:
            cand = by_number.get(number_key(c['number']), [])
            clean = [p for p in cand if not SPECIAL_PRINTING.search(p['name'])]
            cand = clean or cand
            exact = [p for p in cand if card_name_key(p['name']) == card_name_key(c['name'])]
            cand = exact or cand
            pid = variant = price = ''
            if cand:
                p = cand[0]
                pr = prices.get(p['productId'], {})
                low = (c.get('rarity') or '').lower() in ('common', 'uncommon')
                order = ['Normal', 'Holofoil', 'Reverse Holofoil'] if low else ['Holofoil', 'Normal', 'Reverse Holofoil']
                variant = next((v for v in order if v in pr), next(iter(pr), ''))
                pid = p['productId']
                if variant:
                    price = f'{pr[variant]:.2f}'
            if not price:
                unmatched.append(f"{c['number']} {c['name']}")
            else:
                set_priced += 1
                hist_rows.append([c['id'], snap, price])
            cards.append({
                'card_id': c['id'], 'set_id': s['id'], 'number': c['number'], 'name': c['name'],
                'supertype': c['supertype'], 'rarity': c.get('rarity') or 'Unknown', 'price': price,
                'tcgplayer_id': pid if price else '', 'variant': variant if price else '',
                'image': c.get('images', {}).get('large', ''),
            })
        sets.append({
            'set_id': s['id'], 'set_name': s['name'], 'series': s['series'],
            'release_date': s['releaseDate'].replace('/', '-'), 'printed_total': s.get('printedTotal', s['total']),
            'card_count': len(set_cards), 'tcgplayer_group_id': g['groupId'],
        })
        with open(os.path.join(DATA, 'hist', s['id'] + '.csv'), 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(['card_id', 'date', 'price'])
            w.writerows(hist_rows)
        added_sets += 1
        added_cards += len(set_cards)
        priced_cards += set_priced
        line = f"{s['name']} ({s['id']}, TCGplayer group {g['groupId']} \"{g['name']}\"): {set_priced} of {len(set_cards)} cards priced"
        if unmatched:
            line += '; no price: ' + ', '.join(unmatched[:8]) + (' ...' if len(unmatched) > 8 else '')
        report.append(line)

    with open(sets_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=set_fields)
        w.writeheader()
        w.writerows(sets)
    with open(cards_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=card_fields)
        w.writeheader()
        w.writerows(cards)

    head = f"Add {args.series} sets: {added_sets} sets, {priced_cards} of {added_cards} cards priced (prices as of {snap})"
    with open(args.report, 'w', encoding='utf-8') as f:
        f.write(head + '\n\n' + '\n'.join(report) + '\n')
    print(head)
    print('\n'.join(report))


if __name__ == '__main__':
    main()
