// The report's only script, embedded with a CSP nonce so reports stay usable offline with no external assets.
// One filter state drives every control: severity buttons, surface tiles, layer and final-status chips, the reviewer select
// and the search box all combine through cardMatches. The cross-check table has its own status chips.
// The functions below are serialized into the page, so they must not reference anything outside themselves.

// card: {severity, surface, layer, status, reviewers: string[], text}. state: {severity, surface, layer, status, reviewer, query}.
export function cardMatches(card, state) {
  const severity = state.severity === 'all' || card.severity === state.severity || (state.severity === 'low' && card.severity === 'info');
  const surface = state.surface === 'all' || card.surface === state.surface;
  const layer = !state.layer || card.layer === state.layer;
  const status = !state.status || card.status === state.status;
  // Cards list auditor stems (<reviewer id>-s<n>-<slug>); a reviewer id may itself contain hyphens.
  const reviewer = !state.reviewer || card.reviewers.some((id) => id === state.reviewer || (id.startsWith(`${state.reviewer}-s`) && /^\d/.test(id.slice(state.reviewer.length + 2))));
  const query = !state.query || card.text.includes(state.query);
  return severity && surface && layer && status && reviewer && query;
}

export function installReport(doc, matches) {
  const all = (selector) => [...doc.querySelectorAll(selector)];
  const cards = all('.finding');
  const search = doc.querySelector('#search-box');
  const reviewerSelect = doc.querySelector('[data-reviewer-filter]');
  const state = { severity: 'all', surface: 'all', layer: '', status: '', reviewer: '', query: '' };
  const press = (buttons, active) => buttons.forEach((item) => { item.classList?.toggle('active', item === active); item.setAttribute('aria-pressed', String(item === active)); });
  const view = (card) => ({
    severity: card.dataset.severity, surface: card.dataset.surface, layer: card.dataset.layer || '', status: card.dataset.status || '',
    reviewers: (card.dataset.reviewers || '').split(/\s+/).filter(Boolean), text: card.textContent.toLowerCase(),
  });
  const label = () => {
    const visible = cards.filter((card) => !card.hidden);
    const expand = doc.querySelector('#expand-all');
    if (expand) expand.textContent = visible.length && visible.every((card) => card.open) ? 'Collapse findings' : 'Expand findings';
  };
  const apply = () => {
    state.query = search ? search.value.trim().toLowerCase() : '';
    let shown = 0;
    for (const card of cards) { card.hidden = !matches(view(card), state); if (!card.hidden) shown += 1; }
    const count = doc.querySelector('#results-count');
    if (count) count.textContent = `${shown} / ${cards.length} findings${state.surface === 'all' ? '' : ` · ${state.surface}`}`;
    const empty = doc.querySelector('#empty-results');
    if (empty) empty.hidden = shown !== 0;
    const reset = doc.querySelector('#reset-filters');
    if (reset) reset.hidden = state.severity === 'all' && state.surface === 'all' && !state.layer && !state.status && !state.reviewer && !state.query;
    label();
  };
  const severityButtons = all('[data-filter]');
  severityButtons.forEach((button) => button.addEventListener('click', () => { state.severity = button.dataset.filter; press(severityButtons, button); apply(); }));
  const surfaceButtons = all('[data-surface-filter]');
  surfaceButtons.forEach((button) => button.addEventListener('click', () => {
    state.surface = state.surface === button.dataset.surfaceFilter ? 'all' : button.dataset.surfaceFilter;
    surfaceButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.surfaceFilter === state.surface)));
    apply();
    doc.querySelector('#findings')?.scrollIntoView({ block: 'start' });
  }));
  const statusButtons = all('[data-status-filter]');
  statusButtons.forEach((button) => button.addEventListener('click', () => {
    state.status = state.status === button.dataset.statusFilter ? '' : button.dataset.statusFilter;
    statusButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.statusFilter === state.status)));
    apply();
  }));
  const layerButtons = all('[data-layer-filter]');
  layerButtons.forEach((button) => button.addEventListener('click', () => {
    state.layer = state.layer === button.dataset.layerFilter ? '' : button.dataset.layerFilter;
    layerButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.layerFilter === state.layer)));
    apply();
  }));
  reviewerSelect?.addEventListener('change', () => { state.reviewer = reviewerSelect.value; apply(); });
  search?.addEventListener('input', apply);
  doc.querySelector('#reset-filters')?.addEventListener('click', () => {
    Object.assign(state, { severity: 'all', surface: 'all', layer: '', status: '', reviewer: '' });
    if (search) search.value = '';
    if (reviewerSelect) reviewerSelect.value = '';
    press(severityButtons, severityButtons.find((item) => item.dataset.filter === 'all'));
    [...surfaceButtons, ...layerButtons, ...statusButtons].forEach((item) => item.setAttribute('aria-pressed', 'false'));
    apply();
  });
  doc.querySelector('#expand-all')?.addEventListener('click', () => {
    const visible = cards.filter((card) => !card.hidden);
    const open = !visible.every((card) => card.open);
    visible.forEach((card) => { card.open = open; });
    label();
  });
  cards.forEach((card) => card.addEventListener('toggle', label));
  apply();
  return state;
}

// Cross-check table chips, opening a linked finding, and printing every disclosure open.
export function installPage(doc, win) {
  const all = (selector) => [...doc.querySelectorAll(selector)];
  const crossButtons = all('[data-cross-filter]');
  crossButtons.forEach((button) => button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    crossButtons.forEach((item) => item.setAttribute('aria-pressed', String(on && item === button)));
    const status = on ? button.dataset.crossFilter : '';
    all('#crosscheck tbody tr').forEach((row) => { row.hidden = Boolean(status) && row.dataset.status !== status; });
  }));
  const reveal = () => { const target = doc.getElementById(win.location.hash.slice(1)); if (target?.tagName === 'DETAILS') target.open = true; };
  win.addEventListener('hashchange', reveal);
  reveal();
  let printState = [];
  win.addEventListener('beforeprint', () => { printState = all('details').map((item) => [item, item.open]); printState.forEach(([item]) => { item.open = true; }); });
  win.addEventListener('afterprint', () => { printState.forEach(([item, open]) => { item.open = open; }); printState = []; });
}

export function browserScript() {
  return `(${installReport.toString()})(document, ${cardMatches.toString()});(${installPage.toString()})(document, window);`;
}
