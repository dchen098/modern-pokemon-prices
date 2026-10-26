#!/usr/bin/env python3
"""Weekly price update.

Downloads the latest TCGplayer market prices from tcgcsv.com for every set in
data/sets.csv, writes them into data/cards.csv, adds one row per card to
data/hist/<set>.csv for the snapshot date, and records the date in
data/meta.json.

Run from the repository root:  python3 scripts/update_prices.py
Add --prices FILE to use a saved list of "productId,subTypeName,marketPrice"
lines instead of downloading (for testing).
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.request

BASE = 'https://tcgcsv.com'
USER_AGENT = 'modern-pokemon-prices weekly update (github.com/dchen098/modern-pokemon-prices)'
DATA = 'data'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


def download_prices(group_ids):
    prices = {}
    for gid in group_ids:
        body = json.loads(get(f'{BASE}/tcgplayer/3/{gid}/prices'))
        for p in body.get('results', []):
            if p.get('marketPrice') is not None:
                prices[(str(p['productId']), p['subTypeName'])] = float(p['marketPrice'])
        time.sleep(0.25)
    return prices


def read_prices_file(path):
    prices = {}
    for line in open(path, encoding='utf-8'):
        parts = line.strip().split(',')
        if len(parts) == 3 and parts[0].isdigit() and parts[2]:
            prices[(parts[0], parts[1])] = float(parts[2])
    return prices


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prices', help='use a saved prices file instead of downloading')
    ap.add_argument('--date', help='snapshot date (YYYY-MM-DD); defaults to tcgcsv.com last-updated date')
    args = ap.parse_args()

    sets = list(csv.DictReader(open(os.path.join(DATA, 'sets.csv'), encoding='utf-8')))
    snap = args.date or get(f'{BASE}/last-updated.txt').strip()[:10]
    prices = read_prices_file(args.prices) if args.prices else download_prices([s['tcgplayer_group_id'] for s in sets])

    cards_path = os.path.join(DATA, 'cards.csv')
    cards = list(csv.DictReader(open(cards_path, encoding='utf-8')))
    fields = list(cards[0].keys())
    todays = {}
    for c in cards:
        p = prices.get((c['tcgplayer_id'], c['variant']))
        if p is not None:
            c['price'] = f'{p:.2f}'
            todays.setdefault(c['set_id'], []).append((c['card_id'], c['price']))
    priced = sum(len(v) for v in todays.values())
    print(f'snapshot {snap}: prices for {priced} of {len(cards)} cards')
    if priced < len(cards) * 0.9:
        sys.exit('Fewer than 90% of cards got a price; leaving the data unchanged.')

    added = 0
    for s in sets:
        path = os.path.join(DATA, 'hist', s['set_id'] + '.csv')
        rows = list(csv.reader(open(path, encoding='utf-8'))) if os.path.exists(path) else [['card_id', 'date', 'price']]
        seen = {(r[0], r[1]) for r in rows[1:]}
        new = [[cid, snap, price] for cid, price in todays.get(s['set_id'], []) if (cid, snap) not in seen]
        if new:
            rows.extend(new)
            added += len(new)
            with open(path, 'w', newline='', encoding='utf-8') as f:
                csv.writer(f).writerows(rows)
    if added == 0:
        print('This snapshot is already recorded; nothing to update.')
        return

    with open(cards_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(cards)
    meta_path = os.path.join(DATA, 'meta.json')
    meta = json.load(open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) else {}
    meta['prices_as_of'] = snap
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    print(f'added {added} history rows')


if __name__ == '__main__':
    main()
