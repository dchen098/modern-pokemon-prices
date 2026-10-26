// Small data layer for the static site: loads the CSV files in data/,
// runs derived calculations, and keeps the selected set/card in the URL hash.
// It exposes the same `dash` calls the page script uses.
window.dash = (() => {
  const store = {};
  const calcs = {};
  const listeners = [];
  let scheduled = false;

  function pathFor(id) {
    if (id === 'sets') return 'data/sets.csv';
    if (id === 'cards') return 'data/cards.csv';
    if (id.startsWith('hist_')) return 'data/hist/' + encodeURIComponent(id.slice(5)) + '.csv';
    return null;
  }

  function notify() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const fn of listeners) {
        try { fn(); } catch (e) { console.error(e); }
      }
    });
  }

  function load(id) {
    const path = pathFor(id);
    if (!path) { store[id] = { status: 'missing', data: [] }; return; }
    store[id] = { status: 'loading', data: [] };
    fetch(path, { cache: 'no-cache' })
      .then((r) => {
        if (r.status === 404) { store[id] = { status: 'missing', data: [] }; return null; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then((text) => { if (text != null) store[id] = { status: 'ok', data: d3.csvParse(text) }; })
      .catch((e) => { store[id] = { status: 'error', data: [], message: String(e.message || e) }; })
      .finally(notify);
  }

  function runCalc(id) {
    const c = calcs[id];
    const inputs = c.inputs.map((i) => data(i));
    const notReady = inputs.find((x) => x.status !== 'ok');
    if (notReady) return { status: notReady.status, data: [] };
    const rows = inputs.map((x) => x.data);
    if (c.cache && c.cache.rows.every((r, i) => r === rows[i])) return c.cache.result;
    let result;
    try { result = { status: 'ok', data: c.fn(...rows) }; }
    catch (e) { console.error(e); result = { status: 'error', data: [], message: String(e.message || e) }; }
    c.cache = { rows, result };
    return result;
  }

  function data(id) {
    if (calcs[id]) return runCalc(id);
    if (!store[id]) load(id);
    return store[id];
  }

  function readHash() {
    const out = {};
    const h = location.hash.replace(/^#/, '');
    for (const part of h.split('&')) {
      if (!part) continue;
      const [k, v] = part.split('=');
      if (k && v) out[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    return out;
  }

  let params = readHash();
  window.addEventListener('hashchange', () => { params = readHash(); notify(); });
  window.addEventListener('popstate', () => { params = readHash(); notify(); });
  window.addEventListener('resize', notify);

  return {
    data,
    calc(id, def) { calcs[id] = { inputs: def.inputs, fn: def.fn }; },
    onData(fn) { listeners.push(fn); fn(); },
    params() { return { set: null, card: null, ...params }; },
    setParams(patch) {
      params = { ...params, ...patch };
      for (const k of Object.keys(params)) if (params[k] == null) delete params[k];
      const h = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
      history.pushState(null, '', h ? '#' + h : location.pathname + location.search);
      notify();
    },
    resetParams() { params = {}; history.pushState(null, '', location.pathname + location.search); notify(); },
    colors: ['var(--series-1)'],
  };
})();

// "Prices as of" line
fetch('data/meta.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => {
    if (!m || !m.prices_as_of) return;
    const d = d3.utcParse('%Y-%m-%d')(m.prices_as_of);
    document.querySelectorAll('.asof').forEach((el) => { el.textContent = d3.utcFormat('%b %-d, %Y')(d); });
  })
  .catch(() => {});
