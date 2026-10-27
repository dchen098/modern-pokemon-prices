// Page logic: set list, ranked card table and price chart.
// ---------- computed values ----------
dash.calc('set_summary', {
  inputs: ['sets', 'cards'],
  title: 'Set summary',
  description: 'Per set: card count, priciest card, cards at $20+, and the sum of every priced card.',
  fn: (sets, cards) => {
    const by = {};
    for (const c of cards) (by[c.set_id] = by[c.set_id] || []).push(c);
    return sets.map((s) => {
      const cs = by[s.set_id] || [];
      let top = null, total = 0, hits = 0;
      for (const c of cs) {
        if (c.price === '' || c.price == null) continue;
        const p = Number(c.price);
        total += p;
        if (p >= 20) hits++;
        if (!top || p > Number(top.price)) top = c;
      }
      return {
        set_id: s.set_id, set_name: s.set_name, series: s.series, release_date: s.release_date,
        card_count: cs.length, top_card: top ? top.name : null, top_price: top ? Number(top.price) : null,
        cards_20_plus: hits, set_value: Math.round(total * 100) / 100,
      };
    });
  },
});

// Per-set calculations over that set's history file, registered when the set is first opened.
const registeredSets = new Set();
function ensureSetCalcs(id) {
  if (registeredSets.has(id)) return;
  registeredSets.add(id);
  dash.calc('change_' + id, {
    inputs: ['hist_' + id],
    title: '1-year change',
    description: 'Each card’s latest price against its price closest to one year earlier (within 3 weeks); blank if history is shorter.',
    fn: (history) => {
      const by = {};
      for (const r of history) (by[r.card_id] = by[r.card_id] || []).push([String(r.date), Number(r.price)]);
      const out = [];
      for (const [card_id, pts] of Object.entries(by)) {
        pts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const [lastDate, lastPrice] = pts[pts.length - 1];
        const target = Date.parse(lastDate) - 365 * 864e5;
        let best = null;
        for (const p of pts) { const d = Math.abs(Date.parse(p[0]) - target); if (!best || d < best.d) best = { d, p }; }
        const ok = best && best.d <= 21 * 864e5 && best.p[1] > 0;
        out.push({ card_id, change_pct: ok ? Math.round((lastPrice / best.p[1] - 1) * 1000) / 1000 : null });
      }
      return out;
    },
  });
  dash.calc('stats_' + id, {
    inputs: ['hist_' + id],
    title: 'Price range',
    description: 'Each card’s earliest tracked price, its peak and its low.',
    fn: (history) => {
      const by = {};
      for (const r of history) {
        const p = Number(r.price), d = String(r.date);
        const s = by[r.card_id] || (by[r.card_id] = { card_id: r.card_id, first_date: d, first_price: p, peak_price: p, peak_date: d, low_price: p, low_date: d });
        if (d < s.first_date) { s.first_date = d; s.first_price = p; }
        if (p > s.peak_price) { s.peak_price = p; s.peak_date = d; }
        if (p < s.low_price) { s.low_price = p; s.low_date = d; }
      }
      return Object.values(by);
    },
  });
}

// ---------- helpers ----------
const fmtUSD = d3.format('$,.2f');
const fmtPct = d3.format('+.0%');
const parseDay = d3.utcParse('%Y-%m-%d');
const fmtDay = d3.utcFormat('%b %-d, %Y');
const fmtShort = d3.utcFormat('%b %-d');
const fmtMonth = d3.utcFormat('%b %Y');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => encodeURIComponent(String(v));
const money = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : fmtUSD(Number(v)));

const ui = {
  series: 'All',
  setSort: { key: 'release_date', dir: 'descending' },
  cardSort: { key: 'price', dir: 'descending' },
  setQuery: '',
  cardQuery: '',
  rarity: '',
  range: '1y',
  lastSet: null,
};

const cache = new Map();
function indexed(key, rows, build) {
  const c = cache.get(key);
  if (c && c.rows === rows) return c.value;
  const value = build(rows);
  cache.set(key, { rows, value });
  return value;
}

function compare(a, b, key, dir) {
  let x = a[key], y = b[key];
  if (key === 'number') { x = parseInt(x, 10) || 0; y = parseInt(y, 10) || 0; }
  const nx = x == null || x === '' || Number.isNaN(x), ny = y == null || y === '' || Number.isNaN(y);
  if (nx && ny) return 0; if (nx) return 1; if (ny) return -1;
  const r = typeof x === 'number' || typeof y === 'number' ? Number(x) - Number(y) : String(x).localeCompare(String(y));
  return dir === 'ascending' ? r : -r;
}

function setSortHeaders(table, sort) {
  $$('th[data-sort]', table).forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === sort.key ? sort.dir : 'none'));
}

function failLine(el) { el.replaceChildren(); const d = document.createElement('div'); d.className = 'px-fail'; d.textContent = 'Failed to load'; el.append(d); }

function mark(el, source, where) {
  if (source) el.setAttribute('data-source', source);
  if (where) el.setAttribute('data-where', where); else el.removeAttribute('data-where');
}

// ---------- all sets view ----------
function drawSets(summary) {
  const tbody = $('.px-sets tbody');
  const seriesBox = $('.px-series');
  const series = ['All', ...Array.from(new Set(summary.map((s) => s.series)))];
  seriesBox.replaceChildren(...series.map((name) => {
    const b = document.createElement('button');
    b.className = 'px-chip'; b.textContent = name; b.setAttribute('aria-pressed', String(ui.series === name));
    b.addEventListener('click', () => { ui.series = name; redraw(); });
    return b;
  }));
  const q = ui.setQuery.trim().toLowerCase();
  const rows = summary
    .filter((s) => ui.series === 'All' || s.series === ui.series)
    .filter((s) => !q || (s.set_name + ' ' + (s.top_card || '')).toLowerCase().includes(q))
    .sort((a, b) => compare(a, b, ui.setSort.key, ui.setSort.dir));
  const maxValue = d3.max(summary, (s) => s.set_value) || 1;
  setSortHeaders($('.px-sets'), ui.setSort);
  tbody.replaceChildren(...rows.map((s) => {
    const tr = document.createElement('tr');
    tr.className = 'px-row'; tr.dataset.key = s.set_id; tr.tabIndex = 0;
    const cells = [
      ['px-name', s.set_name],
      ['px-muted px-hide-narrow', s.series],
      ['', fmtDay(parseDay(s.release_date))],
      ['num px-hide-narrow', d3.format(',')(s.card_count)],
      ['px-hide-narrow', s.top_card || ''],
      ['num', money(s.top_price)],
    ];
    for (const [cls, text] of cells) { const td = document.createElement('td'); td.className = cls; td.textContent = text; tr.append(td); }
    const td = document.createElement('td'); td.className = 'num px-bar';
    const fill = document.createElement('span'); fill.className = 'fill'; fill.style.width = (s.set_value / maxValue * 100).toFixed(1) + '%';
    const val = document.createElement('span'); val.className = 'val'; val.textContent = fmtUSD(s.set_value);
    td.append(fill, val); tr.append(td);
    return tr;
  }));
  const top = d3.greatest(summary, (s) => s.top_price);
  if (top) {
    const w = 'set_id=' + esc(top.set_id);
    [['.px-top-name', top.top_card], ['.px-top-set', top.set_name], ['.px-top-price', fmtUSD(top.top_price)]].forEach(([sel, text]) => {
      const el = $(sel); mark(el, null, w); el.textContent = text; el.classList.remove('dash-skeleton');
    });
  }
}

// ---------- one set view ----------
function drawSet(setId, sets, summary, cards) {
  ensureSetCalcs(setId);
  const set = sets.find((s) => s.set_id === setId);
  const sum = summary.find((s) => s.set_id === setId);
  if (!set || !sum) return;
  const sw = 'set_id=' + esc(setId);
  [['.px-set-title', set.set_name], ['.px-set-series', set.series]].forEach(([sel, t]) => { const el = $(sel); mark(el, null, sw); el.textContent = t; });
  const dEl = $('.px-set-date'); mark(dEl, null, sw); dEl.textContent = fmtDay(parseDay(set.release_date));
  [['.px-t-top', money(sum.top_price)], ['.px-t-topname', sum.top_card || ''], ['.px-t-value', fmtUSD(sum.set_value)], ['.px-t-count', d3.format(',')(sum.card_count)], ['.px-t-hits', d3.format(',')(sum.cards_20_plus)]]
    .forEach(([sel, t]) => { const el = $(sel); mark(el, null, sw); el.textContent = t; });

  const changeId = 'change_' + setId;
  $('.px-th-change').setAttribute('data-source', changeId);
  const change = dash.data(changeId);
  const changeBy = change.status === 'ok' ? indexed(changeId, change.data, (rows) => new Map(rows.map((r) => [r.card_id, r.change_pct]))) : new Map();
  const setCards = indexed('setcards:' + setId, cards, (rows) => {
    const cs = rows.filter((c) => c.set_id === setId).map((c) => ({ ...c, price: c.price === '' || c.price == null ? null : Number(c.price) }));
    const ranked = cs.slice().sort((a, b) => compare(a, b, 'price', 'descending'));
    ranked.forEach((c, i) => { c.rank = c.price == null ? null : i + 1; });
    return ranked;
  });
  setCards.forEach((c) => { c.change_pct = changeBy.has(c.card_id) ? changeBy.get(c.card_id) : null; });

  const sel = $('.px-rarity');
  if (ui.lastSet !== setId) {
    ui.lastSet = setId; ui.rarity = ''; ui.cardQuery = ''; $('.px-card-search').value = '';
    const counts = d3.rollups(setCards, (v) => ({ n: v.length, p: d3.max(v, (c) => c.price ?? 0) }), (c) => c.rarity).sort((a, b) => b[1].p - a[1].p);
    sel.replaceChildren(new Option('All rarities', ''), ...counts.map(([r, v]) => new Option(`${r} (${v.n})`, r)));
  }
  sel.value = ui.rarity;

  const q = ui.cardQuery.trim().toLowerCase();
  const rows = setCards
    .filter((c) => !ui.rarity || c.rarity === ui.rarity)
    .filter((c) => !q || c.name.toLowerCase().includes(q) || String(c.number).toLowerCase() === q)
    .sort((a, b) => compare(a, b, ui.cardSort.key, ui.cardSort.dir));

  const want = dash.params().card;
  const picked = want && setCards.some((c) => c.card_id === want) ? want : setCards[0] && setCards[0].card_id;
  setSortHeaders($('.px-cards'), ui.cardSort);
  $('.px-cards tbody').replaceChildren(...rows.map((c) => {
    const tr = document.createElement('tr');
    tr.className = 'px-row'; tr.dataset.key = c.card_id; tr.tabIndex = 0;
    tr.setAttribute('aria-selected', String(c.card_id === picked));
    const ch = c.change_pct;
    const cells = [
      ['num px-muted', c.rank == null ? '' : String(c.rank)],
      ['px-muted px-hide-narrow', c.number],
      ['px-name', c.name],
      ['px-muted px-hide-narrow', c.rarity],
      ['num', money(c.price)],
      ['num ' + (ch == null ? 'px-muted' : ch >= 0 ? 'px-up' : 'px-down'), ch == null ? '—' : fmtPct(ch)],
    ];
    for (const [cls, text] of cells) { const td = document.createElement('td'); td.className = cls; td.textContent = text; tr.append(td); }
    const artTd = document.createElement('td');
    if (c.image && /^https:\/\//.test(c.image)) {
      const a = document.createElement('a');
      a.className = 'px-link'; a.href = c.image; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'View ↗'; a.setAttribute('aria-label', 'View card art for ' + c.name);
      artTd.append(a);
    }
    tr.append(artTd);
    return tr;
  }));

  drawDetail(setCards.find((c) => c.card_id === picked), set);
}

function drawDetail(card, set) {
  const box = $('#price-chart');
  const note = $('#chart-note');
  if (!card) { box.replaceChildren(); note.textContent = ''; return; }
  const setId = set.set_id;
  const cw = 'card_id=' + esc(card.card_id);
  [['.px-detail-name', card.name], ['.px-d-rarity', card.rarity], ['.px-d-number', card.number], ['.px-d-price', money(card.price)]].forEach(([sel, t]) => { const el = $(sel); mark(el, null, cw); el.textContent = t; });
  const chEl = $('.px-d-change'); mark(chEl, 'change_' + setId, cw);
  chEl.className = 'px-d-change ' + (card.change_pct == null ? 'px-muted' : card.change_pct >= 0 ? 'px-up' : 'px-down');
  chEl.textContent = card.change_pct == null ? 'Under a year of history' : fmtPct(card.change_pct) + ' over 1 yr';
  const art = $('.px-art');
  if (card.image) { art.href = card.image; art.hidden = false; } else art.hidden = true;
  const tcg = $('.px-tcg');
  if (card.tcgplayer_id) { tcg.href = 'https://www.tcgplayer.com/product/' + encodeURIComponent(card.tcgplayer_id); tcg.hidden = false; } else tcg.hidden = true;
  $$('.px-range').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === ui.range)));

  const histId = 'hist_' + setId, statsId = 'stats_' + setId;
  box.setAttribute('data-source', histId);
  const stats = dash.data(statsId);
  const sEls = [['.px-s-first', 'first'], ['.px-s-peak', 'peak'], ['.px-s-low', 'low']];
  const s = stats.status === 'ok' ? stats.data.find((r) => r.card_id === card.card_id) : null;
  sEls.forEach(([sel, k]) => {
    const el = $(sel); mark(el, statsId, cw);
    el.textContent = s ? `${fmtUSD(s[k + '_price'])} · ${fmtShort(parseDay(s[k + '_date']))}, ${s[k + '_date'].slice(0, 4)}` : '—';
  });

  const hist = dash.data(histId);
  if (hist.status === 'missing') { box.replaceChildren(); box.classList.remove('dash-skeleton'); note.textContent = 'No price history for this set yet.'; return; }
  if (hist.status === 'error') { failLine(box); note.textContent = ''; return; }
  if (hist.status !== 'ok') { box.replaceChildren(); box.classList.add('dash-skeleton'); note.textContent = ''; return; }
  box.classList.remove('dash-skeleton');
  const byCard = indexed(histId, hist.data, (rows) => {
    const m = new Map(); let maxDate = '';
    for (const r of rows) {
      const d = String(r.date);
      if (!m.has(r.card_id)) m.set(r.card_id, []);
      m.get(r.card_id).push({ date: parseDay(d), price: Number(r.price) });
      if (d > maxDate) maxDate = d;
    }
    for (const v of m.values()) v.sort((a, b) => a.date - b.date);
    return { m, end: parseDay(maxDate) };
  });
  const pts = byCard.m.get(card.card_id) || [];
  drawChart(box, pts, byCard.end, parseDay(set.release_date));
  if (!pts.length) note.textContent = 'No price history yet for this card.';
  else if (pts.length === 1) note.textContent = `Tracked weekly since ${fmtDay(pts[0].date)}; the chart fills in from here.`;
  else note.textContent = `History from ${fmtDay(pts[0].date)}${ui.range === '5y' ? '. Earlier prices aren’t available.' : '.'}`;
}

function drawChart(box, pts, end, release) {
  box.replaceChildren();
  if (!pts.length) return;
  const W = Math.max(280, box.clientWidth || 280), H = 260, mt = 22, mb = 26, mr = 12;
  const months = ui.range === '3m' ? 3 : ui.range === '5y' ? 60 : 12;
  const start = d3.utcMonth.offset(end, -months);
  const shown = pts.filter((p) => p.date >= start);
  if (!shown.length) return;
  const ymax = d3.max(shown, (p) => p.price) || 1;
  const y = d3.scaleLinear([0, ymax * 1.08], [H - mb, mt]).nice();
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Price chart');
  const fmtTick = ymax >= 5 ? d3.format('$,.0f') : d3.format('$,.2f');
  const ticks = y.ticks(4);
  const labels = svg.append('g').selectAll('text').data(ticks).join('text').attr('x', 0).attr('y', (d) => y(d)).attr('dy', '0.32em')
    .attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)').style('font-variant-numeric', 'tabular-nums').text(fmtTick);
  let lw = 0; labels.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
  const ml = Math.ceil(lw) + 10;
  labels.attr('x', ml - 8).attr('text-anchor', 'end');
  const x = d3.scaleUtc([start, end], [ml, W - mr]);
  svg.insert('g', ':first-child').selectAll('line').data(ticks).join('line')
    .attr('x1', ml).attr('x2', W - mr).attr('y1', (d) => y(d)).attr('y2', (d) => y(d)).attr('stroke', 'var(--cds-chart-grid)').attr('stroke-width', 1);
  const xt = months >= 60 ? d3.utcYear.range(d3.utcYear.ceil(start), d3.utcDay.offset(end, 1)) : x.ticks(Math.max(2, Math.min(6, Math.floor((W - ml) / 80))));
  const xfmt = months >= 60 ? d3.utcFormat('%Y') : months >= 12 ? d3.utcFormat('%b %Y') : d3.utcFormat('%b %-d');
  svg.append('line').attr('x1', ml).attr('x2', W - mr).attr('y1', H - mb).attr('y2', H - mb).attr('stroke', 'var(--cds-chart-axis)');
  const xl = svg.append('g').selectAll('text').data(xt).join('text').attr('x', (d) => x(d)).attr('y', H - mb + 16).attr('text-anchor', 'middle')
    .attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)').text(xfmt);
  let lastRight = -Infinity;
  xl.each(function () { const w = this.getComputedTextLength(); let cx = +this.getAttribute('x'); cx = Math.min(Math.max(cx, ml + w / 2), W - mr - w / 2); this.setAttribute('x', cx); if (cx - w / 2 < lastRight + 6) this.remove(); else lastRight = cx + w / 2; });

  if (release >= start && release <= end) {
    const rx = x(release);
    svg.append('line').attr('x1', rx).attr('x2', rx).attr('y1', mt - 6).attr('y2', H - mb).attr('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '3 3');
    const near = rx > (W - mr) - 70;
    svg.append('text').attr('x', near ? rx - 4 : rx + 4).attr('y', mt - 8).attr('text-anchor', near ? 'end' : 'start')
      .attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)').text('Released');
  }

  const color = dash.colors[0];
  const gid = 'px-grad-' + Math.random().toString(36).slice(2, 8);
  const grad = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  [[0, .26], [.25, .16], [.5, .08], [.75, .03], [1, 0]].forEach(([o, a]) => grad.append('stop').attr('offset', o).attr('style', `stop-color:${color};stop-opacity:${a}`));
  if (shown.length > 1) {
    svg.append('path').datum(shown).attr('fill', `url(#${gid})`).attr('d', d3.area().x((p) => x(p.date)).y0(H - mb).y1((p) => y(p.price)));
    svg.append('path').datum(shown).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', d3.line().x((p) => x(p.date)).y((p) => y(p.price)));
  }
  const lastP = shown[shown.length - 1];
  svg.append('circle').attr('cx', x(lastP.date)).attr('cy', y(lastP.price)).attr('r', 3.5).attr('fill', color);

  const tip = document.createElement('div'); tip.className = 'px-tip'; tip.hidden = true; box.append(tip);
  const dot = svg.append('circle').attr('r', 4).attr('fill', color).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2).style('display', 'none');
  const rule = svg.append('line').attr('y1', mt).attr('y2', H - mb).attr('stroke', 'var(--cds-chart-axis)').style('display', 'none');
  const bis = d3.bisector((p) => p.date).center;
  svg.append('rect').attr('x', ml).attr('y', mt).attr('width', W - mr - ml).attr('height', H - mb - mt).attr('fill', 'transparent')
    .on('pointermove', (event) => {
      const [mx] = d3.pointer(event); const p = shown[bis(shown, x.invert(mx))]; if (!p) return;
      const px = x(p.date), py = y(p.price);
      dot.style('display', null).attr('cx', px).attr('cy', py);
      rule.style('display', null).attr('x1', px).attr('x2', px);
      tip.replaceChildren(); const d = document.createElement('div'); d.className = 'd'; d.textContent = fmtDay(p.date); const v = document.createElement('div'); v.textContent = fmtUSD(p.price); tip.append(d, v);
      tip.hidden = false;
      const scale = box.clientWidth / W; const tw = tip.offsetWidth;
      let left = px * scale + 10; if (left + tw > box.clientWidth) left = px * scale - tw - 10;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = Math.max(0, py * scale - 40) + 'px';
    })
    .on('pointerleave', () => { tip.hidden = true; dot.style('display', 'none'); rule.style('display', 'none'); });
}

// ---------- wiring ----------
function redraw() {
  const setId = dash.params().set;
  const sets = dash.data('sets'), summary = dash.data('set_summary'), cards = dash.data('cards');
  $('#all-sets').hidden = !!setId;
  $('#set-view').hidden = !setId;
  if (!setId) {
    if (summary.status === 'ok') drawSets(summary.data);
    else if (summary.status === 'error' || sets.status === 'error' || cards.status === 'error') { const td = document.createElement('td'); td.colSpan = 7; failLine(td); $('.px-sets tbody').replaceChildren(td); }
    return;
  }
  if (summary.status === 'ok' && sets.status === 'ok' && cards.status === 'ok') {
    drawSet(setId, sets.data, summary.data, cards.data);
  } else if (cards.status === 'error' || sets.status === 'error') {
    const td = document.createElement('td'); td.colSpan = 7; failLine(td); $('.px-cards tbody').replaceChildren(td);
  }
}

dash.onData(redraw);

$('.px-sets').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) { const k = th.dataset.sort; ui.setSort = { key: k, dir: ui.setSort.key === k && ui.setSort.dir === 'descending' ? 'ascending' : 'descending' }; redraw(); return; }
  const tr = e.target.closest('tr[data-key]');
  if (tr) { dash.setParams({ set: tr.dataset.key, card: null }); document.getElementById('explorer').scrollIntoView(); }
});
$('.px-sets').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-key]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); } });
$('.px-cards').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const th = e.target.closest('th[data-sort]');
  if (th) { const k = th.dataset.sort; ui.cardSort = { key: k, dir: ui.cardSort.key === k && ui.cardSort.dir === 'descending' ? 'ascending' : 'descending' }; redraw(); return; }
  const tr = e.target.closest('tr[data-key]');
  if (tr) { dash.setParams({ card: tr.dataset.key }); if (window.matchMedia('(max-width: 860px)').matches) $('#card-detail').scrollIntoView({ block: 'start' }); }
});
$('.px-cards').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-key]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); } });
$('#back-to-sets').addEventListener('click', () => { dash.setParams({ set: null, card: null }); });
$('.px-set-search').addEventListener('input', (e) => { ui.setQuery = e.target.value; redraw(); });
$('.px-card-search').addEventListener('input', (e) => { ui.cardQuery = e.target.value; redraw(); });
$('.px-rarity').addEventListener('change', (e) => { ui.rarity = e.target.value; redraw(); });
$$('.px-range').forEach((b) => b.addEventListener('click', () => { ui.range = b.dataset.range; redraw(); }));
