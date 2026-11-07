import {
  priceForTargetRate,
  CATEGORIES, NO_CLIENT, SORT_MODES, WARN_LIMIT, HOURS_PER_DAY,
  computeStats, categoryBreakdown, breakdownBy, clientList, suggestion, recordSuggestion,
  validateRecord, validateChange, validateTemplate, overrunPct, isFinished, fmtSigned, fmtWon,
  accuracyLevel, filterRecords, sortRecords, toCSV, importCSV,
  roundHoursUp, hoursToDays, withSurcharge, hourlyRate,
  compareProjects, buildPrintReport,
  monthlyTotals, changeSummary, adjustedQuote, scopeCreepSummary, buildSummaryText,
  sanitizeRecord, sanitizeTemplate, sanitizeSettings, buildBackup, parseBackup,
  AI_KEY_STORAGE, AI_MAX_ITEMS, isPlausibleKey, parseLineItems, buildReviewPrompt, buildAnthropicRequest,
  extractText, parseReviewResponse, localReview, aiErrorMessage,
  catLabel, unsetLabel, money, moneyPerHour, hoursText, levelText, resolveCategory,
} from './logic.js';
import {
  t, setLang, getLang, detectLang, readSavedLang, saveLang, applyI18n, LANGS, fmtDate, fmtCompact, fmtNumber,
} from './i18n.js';

const KEY = 'estimate-check:v1';
const THEME_KEY = 'estimate-check:theme';
const TPL_KEY = 'estimate-check:templates:v1';
const SET_KEY = 'estimate-check:settings:v1';
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BOM = String.fromCharCode(0xfeff);
const SORT_KEYS = {
  'date-desc': 'sortDateDesc', 'date-asc': 'sortDateAsc', 'variance-desc': 'sortVarDesc',
  'variance-asc': 'sortVarAsc', 'price-desc': 'sortPriceDesc',
};
const LEVEL_VAR = { good: '--good', warn: '--warn', bad: '--bad' };
const DEMO_IDS = new Set(['demo1', 'demo2', 'demo3', 'demo4', 'demo5', 'demo6']);

let records = [];
let templates = [];
let settings = { monthlyTarget: 0 };
let editingId = null;
let changesFor = null;
let lastFocus = null;
let confirmAction = null;
const view = { query: '', category: '', client: '', sort: 'date-desc' };

// ---------- storage (each read/write guarded) ----------
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function persistRecords() {
  if (!writeJSON(KEY, records)) toast(t('storageFail'));
}
function persistTemplates() {
  if (!writeJSON(TPL_KEY, templates)) toast(t('storageFail'));
}
function getTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function setTheme(th) {
  document.documentElement.dataset.theme = th;
  try { localStorage.setItem(THEME_KEY, th); } catch { /* ignore */ }
}

// ---------- helpers ----------
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) e.append(kid);
  return e;
}
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const kv = (k, v) => el('div', { class: 'kv' }, el('dt', { text: k }), el('dd', { text: v }));
function toast(msg) {
  const node = el('div', { class: 'toast', text: msg });
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 3200);
}
function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function newId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function countUp(node, to, fmt) {
  if (to == null) { node.textContent = '-'; return; }
  if (reduced) { node.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(to * e);
    if (p < 1) requestAnimationFrame(step); else node.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}
function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  const ta = el('textarea', { readonly: '', style: 'position:fixed;opacity:0;pointer-events:none' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Empty-state illustration: a small clipboard drawn with theme tokens.
function artSvg(kind) {
  const s = svgEl('svg', { viewBox: '0 0 120 90', width: '104', height: '78', class: 'art', 'aria-hidden': 'true', focusable: 'false' });
  const paper = 'stroke:var(--line-strong);fill:var(--surface-2)';
  const ink = 'stroke:var(--muted);fill:none';
  if (kind === 'template') s.append(svgEl('rect', { x: 42, y: 4, width: 50, height: 62, rx: 4, style: paper, 'stroke-width': 1.5 }));
  s.append(svgEl('rect', { x: 30, y: 14, width: 54, height: 66, rx: 4, style: paper, 'stroke-width': 1.5 }));
  for (let i = 0; i < 3; i++) {
    s.append(svgEl('line', { x1: 42, x2: 72 - i * 8, y1: 34 + i * 12, y2: 34 + i * 12, style: ink, 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
  }
  s.append(svgEl('circle', { cx: 88, cy: 24, r: 13, style: 'stroke:var(--accent);fill:var(--surface)', 'stroke-width': 2 }));
  if (kind === 'list') {
    s.append(svgEl('path', { d: 'M81 24l5 5 9-10', style: 'stroke:var(--accent);fill:none', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  } else {
    s.append(svgEl('path', { d: 'M88 18v12M82 24h12', style: 'stroke:var(--accent);fill:none', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  }
  return s;
}
function emptyBlock(kind, text, action = null) {
  return el('div', { class: 'empty' }, artSvg(kind), el('p', { text }), action);
}
function smallEmpty(text) {
  return el('div', { class: 'empty small-empty' }, el('p', { text }));
}

// ---------- render: dashboard ----------
function renderSticky(s) {
  $('#stCount').textContent = t('projectsCount', { n: s.count });
  $('#stHit').textContent = s.hitRate == null ? '-' : Math.round(s.hitRate) + '%';
  $('#stAvg').textContent = s.avgOverrun == null ? '-' : fmtSigned(s.avgOverrun) + '%';
  $('#stRate').textContent = s.effectiveRate == null ? '-' : moneyPerHour(s.effectiveRate);
}
function syncSticky() {
  const show = window.scrollY > 380;
  const box = $('#sticky');
  box.classList.toggle('show', show);
  box.setAttribute('aria-hidden', String(!show));
}
function renderStats() {
  const s = computeStats(records);
  renderSticky(s);
  const defs = [
    [t('statTotal'), s.totalQuoted, (n) => fmtWon(n), t('unitWon')],
    [t('statActual'), s.totalActualHours, (n) => fmtNumber(Math.round(n * 10) / 10, { maximumFractionDigits: 1 }), t('unitHours')],
    [t('statRate'), s.effectiveRate, (n) => fmtWon(n), t('unitPerHour')],
    [t('statHit'), s.hitRate, (n) => Math.round(n).toString(), '%'],
    [t('statAvg'), s.avgOverrun, (n) => fmtSigned(n), '%'],
  ];
  const box = $('#stats');
  box.replaceChildren();
  defs.forEach(([k, v, fmt, unitText]) => {
    const val = el('span', { text: '-' });
    const card = el('div', { class: 'stat' },
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v' }, val, v == null ? null : el('span', { class: 'u', text: ' ' + unitText })));
    box.append(card);
    countUp(val, v, fmt);
  });
}
function renderSuggestion() {
  const s = suggestion(records);
  const c = $('#suggestCard');
  c.className = 'card suggest ' + (s.kind === 'neutral' ? '' : s.kind);
  c.replaceChildren(
    el('div', { class: 'ico', 'aria-hidden': 'true' }),
    el('div', {}, el('strong', { text: t('sugTitle') }), el('p', { text: s.message })));
}
function renderBars(sel, rows, emptyText) {
  const box = $(sel);
  box.replaceChildren();
  if (!rows.some((r) => r.finishedCount > 0)) {
    box.append(smallEmpty(emptyText));
    return;
  }
  const max = Math.max(WARN_LIMIT, ...rows.map((r) => Math.abs(r.avgOverrun ?? 0)));
  const fills = [];
  for (const r of rows) {
    const has = r.avgOverrun !== null;
    const pct = has ? Math.min(100, (Math.abs(r.avgOverrun) / max) * 100) : 0;
    const fill = el('div', { class: 'bar-fill ' + (has && r.avgOverrun < 0 ? 'neg' : 'pos') });
    fills.push([fill, pct]);
    const valText = has ? fmtSigned(r.avgOverrun) + '%' : t('noData');
    box.append(el('div', { class: 'bar-row' },
      el('span', { class: 'bar-label', text: r.label }),
      el('div', { class: 'bar-track', role: 'img', 'aria-label': `${r.label} ${valText}` }, fill),
      el('div', { class: 'bar-val' }, has ? valText : '-',
        el('div', { class: 'bar-sub', text: t('doneCount', { n: r.finishedCount }) }))));
  }
  requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(([f, p]) => { f.style.width = p + '%'; })));
}
function renderTrend() {
  const box = $('#trend');
  box.replaceChildren();
  const pts = [...records].filter((r) => r.estimatedHours > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) {
    box.append(smallEmpty(t('chartTrendNeed')));
    return;
  }
  const W = 480, H = 220, L = 38, R = 14, T = 14, B = 28;
  const maxV = Math.max(...pts.flatMap((r) => [r.estimatedHours, r.actualHours || 0])) * 1.1;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('ariaTrend') });
  for (let g = 0; g <= 4; g++) {
    const v = (maxV * g) / 4, yy = y(v);
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, stroke: 'currentColor', 'stroke-opacity': '.12' }));
    const tx = svgEl('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '.7' });
    tx.textContent = Math.round(v);
    svg.append(tx);
  }
  const line = (key, color, dash) => {
    const seg = pts.map((r, i) => [i, r[key]]).filter(([, v]) => v > 0);
    if (!seg.length) return;
    const p = svgEl('polyline', { points: seg.map(([i, v]) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (dash) p.setAttribute('stroke-dasharray', dash);
    svg.append(p);
    for (const [i, v] of seg) {
      const c = svgEl('circle', { cx: x(i), cy: y(v), r: '3.5', fill: color });
      const tt = svgEl('title');
      tt.textContent = `${pts[i].name}: ${hoursText(v)}`;
      c.append(tt);
      svg.append(c);
    }
  };
  line('estimatedHours', 'var(--muted)', '5 4');
  line('actualHours', 'var(--accent)');
  pts.forEach((r, i) => {
    if (pts.length > 8 && i % 2) return;
    const tx = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '.7' });
    tx.textContent = r.date.slice(5);
    svg.append(tx);
  });
  box.append(svg, el('div', { class: 'legend' },
    el('span', {}, el('i', { class: 'dot dash' }), t('legEst')),
    el('span', {}, el('i', { class: 'dot accent' }), t('legActual'))));
}
function renderVariance() {
  const box = $('#varChart');
  box.replaceChildren();
  const pts = sortRecords(records.filter(isFinished), 'date-asc');
  if (pts.length < 2) {
    box.append(smallEmpty(t('chartVarNeed')));
    return;
  }
  const W = 480, H = 180, L = 44, R = 10, T = 12, B = 26;
  const maxAbs = Math.max(WARN_LIMIT, ...pts.map((r) => Math.abs(overrunPct(r))));
  const cap = Math.ceil(maxAbs / 10) * 10;
  const y = (v) => T + (1 - (v + cap) / (2 * cap)) * (H - T - B);
  const zero = y(0);
  const slot = (W - L - R) / pts.length;
  const bw = Math.max(4, Math.min(28, slot * 0.6));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('ariaVar') });
  for (const v of [-cap, -cap / 2, 0, cap / 2, cap]) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': v === 0 ? '.4' : '.12' }));
    const tx = svgEl('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '.7' });
    tx.textContent = `${v > 0 ? '+' : ''}${Math.round(v)}%`;
    svg.append(tx);
  }
  const labelStep = Math.ceil(pts.length / 8);
  pts.forEach((r, i) => {
    const v = overrunPct(r);
    const cx = L + slot * (i + 0.5);
    const top = Math.min(y(v), zero);
    const h = Math.max(1.5, Math.abs(y(v) - zero));
    const lvl = accuracyLevel(v);
    const bar = svgEl('rect', { x: cx - bw / 2, y: top, width: bw, height: h, rx: 2, style: `fill:var(${LEVEL_VAR[lvl]})` });
    const tt = svgEl('title');
    tt.textContent = `${r.name}: ${fmtSigned(Math.round(v * 10) / 10)}%`;
    bar.append(tt);
    svg.append(bar);
    if (i % labelStep === 0) {
      const tx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '.7' });
      tx.textContent = r.date.slice(5);
      svg.append(tx);
    }
  });
  box.append(svg);
}
function renderMonthly() {
  const box = $('#monthChart');
  box.replaceChildren();
  const target = settings.monthlyTarget || 0;
  const rows = monthlyTotals(records, target);
  if (!rows.length) {
    box.append(smallEmpty(t('chartMonthNeed')));
    return;
  }
  const W = 480, H = 200, L = 56, R = 10, T = 14, B = 28;
  const maxV = (Math.max(target, ...rows.map((r) => r.total)) * 1.1) || 1;
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const slot = (W - L - R) / rows.length;
  const bw = Math.max(6, Math.min(36, slot * 0.6));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('ariaMonth') });
  for (let g = 0; g <= 4; g++) {
    const v = (maxV * g) / 4;
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': '.12' }));
    const tx = svgEl('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '.7' });
    tx.textContent = fmtCompact(v);
    svg.append(tx);
  }
  const labelStep = Math.ceil(rows.length / 8);
  rows.forEach((r, i) => {
    const cx = L + slot * (i + 0.5);
    const top = y(r.total);
    const bar = svgEl('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(0, T + (H - T - B) - top), rx: 2, style: 'fill:var(--accent)' });
    const tt = svgEl('title');
    tt.textContent = `${r.month}: ${money(r.total)}`;
    bar.append(tt);
    svg.append(bar);
    if (i % labelStep === 0) {
      const tx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '.7' });
      tx.textContent = r.month.slice(2);
      svg.append(tx);
    }
  });
  if (target > 0) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(target), y2: y(target), style: 'stroke:var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    const tx = svgEl('text', { x: W - R, y: y(target) - 6, 'text-anchor': 'end', 'font-size': '11', style: 'fill:var(--ink)', 'font-weight': '600' });
    tx.textContent = t('targetLine', { n: money(target) });
    svg.append(tx);
  }
  box.append(svg);
  if (target > 0) {
    const hit = rows.filter((r) => r.total >= target).length;
    box.append(el('p', { class: 'legend', text: t('targetHit', { hit, total: rows.length }) }));
  }
}
function renderScope() {
  const box = $('#scopeBox');
  box.replaceChildren();
  const s = scopeCreepSummary(records);
  if (!s.count) {
    box.append(emptyBlock('scope', t('scopeEmpty')));
    return;
  }
  box.append(el('dl', { class: 'kvs' },
    kv(t('scopeCount'), t('scopeCountVal', { n: s.count, projects: s.projects })),
    kv(t('scopeAmount'), money(s.amount)),
    kv(t('scopeHours'), hoursText(s.hours)),
    kv(t('scopeRatio'), s.ratioPct == null ? '-' : `+${s.ratioPct}%`)));
  box.append(el('h3', { class: 'sub-h', text: t('scopeTop') }));
  for (const p of s.perRecord.slice(0, 5)) {
    box.append(el('div', { class: 'scope-row' },
      el('span', { class: 'nm', text: p.name }),
      el('span', { class: 'scope-amt', text: `+${money(p.amount)}` })));
  }
}
function renderTemplates() {
  const box = $('#tplList');
  box.replaceChildren();
  if (!templates.length) {
    box.append(emptyBlock('template', t('tplEmpty')));
    return;
  }
  [...templates].sort((a, b) => a.name.localeCompare(b.name)).forEach((tp) => {
    const meta = `${catLabel(tp.category)}${tp.client ? ' · ' + tp.client : ''} · ${money(tp.quotedPrice)} · ${t('estLabel')} ${hoursText(tp.estimatedHours)}`;
    box.append(el('div', { class: 'tpl-item' },
      el('div', { class: 'tpl-main' },
        el('div', { class: 'nm', text: tp.name }),
        el('div', { class: 'meta', text: meta })),
      el('div', { class: 'actions' },
        el('button', { class: 'btn sm primary', type: 'button', text: t('tplUse'), 'aria-label': t('ariaTplUse', { name: tp.name }), onclick: () => openForm(null, tp.id) }),
        el('button', { class: 'btn sm danger', type: 'button', text: t('deleteBtn'), 'aria-label': t('ariaTplDel', { name: tp.name }),
          onclick: () => askConfirm(t('askDelTplTitle'), t('askDelTplMsg', { name: tp.name }), t('deleteBtn'), () => deleteTemplate(tp.id)) }))));
  });
}
function renderAll() {
  renderStats();
  renderSuggestion();
  renderBars('#catBars',
    categoryBreakdown(records).map((r) => ({ label: catLabel(r.category), finishedCount: r.finishedCount, avgOverrun: r.avgOverrun })),
    t('catBarsEmpty'));
  renderBars('#clientBars',
    breakdownBy(records, 'client').map((r) => ({ label: r.label, finishedCount: r.finishedCount, avgOverrun: r.avgOverrun })),
    t('clientBarsEmpty'));
  renderTrend();
  renderVariance();
  renderMonthly();
  renderTemplates();
  renderScope();
  renderFilters();
  renderList();
  renderCompareSelects();
  renderCompare();
}

// ---------- render: unit helper ----------
function renderUnit() {
  const uf = $('#unitForm');
  const f = (n) => uf.elements.namedItem(n);
  const out = $('#unitOut');
  out.replaceChildren();
  const h = Number(f('hours').value);
  if (!(h > 0)) {
    out.append(smallEmpty(t('unitEmpty')));
    return;
  }
  const step = Number(f('step').value);
  const pct = Number(f('pct').value) || 0;
  const price = f('price').value;
  const target = f('target').value;
  const rows = [
    [t('unitRoundRow', { step: fmtSigned(step).replace(/^\+/, '') }), roundHoursUp(h, step), (v) => hoursText(v)],
    [t('unitDayRow', { h: HOURS_PER_DAY }), hoursToDays(h), (v) => t('daysVal', { n: v })],
    [t('unitSurRow', { pct }), withSurcharge(h, pct), (v) => hoursText(v)],
    [t('unitRateRow'), hourlyRate(price, h), (v) => moneyPerHour(v)],
  ];
  if (Number(target) > 0) rows.push([t('unitTargetRow'), priceForTargetRate(h, target), (v) => money(v)]);
  const dl = el('dl', { class: 'kvs' });
  for (const [k, v, fmt] of rows) dl.append(kv(k, v == null ? '-' : fmt(v)));
  out.append(dl);
}

// ---------- render: records list ----------
function fillSelect(sel, options, value) {
  sel.replaceChildren(...options.map(([v, label]) => el('option', { value: v, text: label })));
  sel.value = value;
}
function renderFilters() {
  const catSel = $('#fCategory'), cliSel = $('#fClient'), sortSel = $('#sort'), dl = $('#clientList');
  const clients = clientList(records);
  if (view.category && !CATEGORIES.includes(view.category)) view.category = '';
  if (view.client && view.client !== NO_CLIENT && !clients.includes(view.client)) view.client = '';
  fillSelect(catSel, [['', t('allCategories')], ...CATEGORIES.map((c) => [c, catLabel(c)])], view.category);
  fillSelect(cliSel, [['', t('allClients')], [NO_CLIENT, unsetLabel()], ...clients.map((c) => [c, c])], view.client);
  fillSelect(sortSel, SORT_MODES.map((m) => [m, t(SORT_KEYS[m])]), view.sort);
  dl.replaceChildren(...clients.map((c) => el('option', { value: c })));
}
function resetView() {
  Object.assign(view, { query: '', category: '', client: '', sort: 'date-desc' });
  $('#search').value = '';
  renderFilters();
  renderList();
}
function renderList() {
  const box = $('#list');
  box.replaceChildren();
  $('#clearBtn').disabled = records.length === 0;
  $('#exportBtn').disabled = records.length === 0;
  if (!records.length) {
    $('#countLine').textContent = '';
    box.append(emptyBlock('list', t('listEmpty'),
      el('button', { class: 'btn primary sm', type: 'button', text: t('heroDemo'), onclick: loadDemo })));
    return;
  }
  const rows = sortRecords(filterRecords(records, view), view.sort);
  $('#countLine').textContent = t('countLine', { total: records.length, shown: rows.length });
  if (!rows.length) {
    box.append(emptyBlock('list', t('listNoMatch'),
      el('button', { class: 'btn ghost sm', type: 'button', text: t('resetFilter'), onclick: resetView })));
    return;
  }
  rows.forEach((r) => box.append(recordItem(r)));
}
function recordItem(r) {
  const o = overrunPct(r);
  const level = accuracyLevel(o);
  const label = level === 'pending' ? t('lvPending') : `${fmtSigned(Math.round(o * 10) / 10)}%`;
  const sug = recordSuggestion(r);
  const cs = changeSummary(r);
  const meta = t('recMeta', {
    date: fmtDate(r.date), quote: money(r.quotedPrice), est: hoursText(r.estimatedHours),
    act: isFinished(r) ? hoursText(r.actualHours) : '-',
  });
  return el('article', { class: 'item' },
    el('div', { class: 'item-main' },
      el('div', { class: 'badges' },
        el('span', { class: 'badge', text: catLabel(r.category) }),
        r.client ? el('span', { class: 'badge client', text: r.client }) : null,
        r.demo ? el('span', { class: 'badge demo', text: t('demoBadge') }) : null,
        el('span', { class: 'badge acc ' + level, text: label })),
      el('h3', { class: 'nm', text: r.name }),
      el('div', { class: 'meta', text: meta }),
      cs.count ? el('div', { class: 'meta change-line', text: t('changeLine', { n: cs.count, amt: money(cs.amount), adj: money(adjustedQuote(r)) }) }) : null,
      sug ? el('p', { class: 'tip ' + sug.level, text: sug.text }) : null),
    el('div', { class: 'actions' },
      el('button', { class: 'btn sm', type: 'button', 'aria-label': t('ariaEdit', { name: r.name }), text: t('editBtn'), onclick: () => openForm(r.id) }),
      el('button', { class: 'btn sm', type: 'button', 'aria-label': t('ariaChange', { name: r.name }), text: t('changeBtn'), onclick: () => openChanges(r.id) }),
      el('button', { class: 'btn sm', type: 'button', 'aria-label': t('ariaDup', { name: r.name }), text: t('dupBtn'), onclick: () => duplicateRecord(r.id) }),
      el('button', { class: 'btn sm danger', type: 'button', 'aria-label': t('ariaDel', { name: r.name }), text: t('deleteBtn'),
        onclick: () => askConfirm(t('askDelRecTitle'), t('askDelRecMsg', { name: r.name }), t('deleteBtn'), () => deleteRecord(r.id)) })));
}

// ---------- modals ----------
const modal = $('#modal'), form = $('#form');
const tplModal = $('#tplModal'), tplForm = $('#tplForm');
const chModal = $('#chModal'), chForm = $('#chForm');
const confirmM = $('#confirm');
const fld = (f, name) => f.elements.namedItem(name);
function resetErrors(f) {
  for (const e of f.querySelectorAll('[data-err]')) e.textContent = '';
}
function showErrors(f, errors) {
  for (const e of f.querySelectorAll('[data-err]')) e.textContent = errors[e.dataset.err] || '';
  const first = Object.keys(errors)[0];
  if (first) fld(f, first)?.focus();
}
function openModal(m) { lastFocus = document.activeElement; m.hidden = false; }
function closeModal(m) {
  m.hidden = true;
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  lastFocus = null;
}
function closeConfirm() {
  confirmAction = null;
  closeModal(confirmM);
}
function dismiss(m) {
  if (m === confirmM) closeConfirm();
  else {
    if (m === chModal) changesFor = null;
    closeModal(m);
  }
}
function askConfirm(title, msg, okLabel, action) {
  $('#cTitle').textContent = title;
  $('#cMsg').textContent = msg;
  $('#cOk').textContent = okLabel;
  confirmAction = action;
  openModal(confirmM);
  $('#cCancel').focus();
}
for (const m of [modal, tplModal, chModal, confirmM]) {
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dismiss(m); });
}
$('#cOk').addEventListener('click', () => {
  const action = confirmAction;
  closeConfirm();
  if (action) action();
});
document.addEventListener('keydown', (e) => {
  const top = [confirmM, chModal, tplModal, modal].find((m) => !m.hidden);
  if (!top) return;
  if (e.key === 'Escape') { dismiss(top); return; }
  if (e.key !== 'Tab') return;
  // Focus trap: keep Tab cycling inside the open dialog.
  const sheet = top.querySelector('.sheet, form');
  const items = [...sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')]
    .filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !sheet.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !sheet.contains(active))) { e.preventDefault(); first.focus(); }
});

// ---------- project form ----------
function renderTplPick() {
  const sel = $('#tplPick');
  fillSelect(sel, [['', t('typeDirect')],
    ...[...templates].sort((a, b) => a.name.localeCompare(b.name))
      .map((tp) => [tp.id, t('tplOption', { name: tp.name, cat: catLabel(tp.category) })])], sel.value || '');
}
function fillCategorySelects() {
  for (const f of [form, tplForm]) {
    const sel = fld(f, 'category');
    const prev = sel.value;
    fillSelect(sel, [['', t('selectPlaceholder')], ...CATEGORIES.map((c) => [c, catLabel(c)])], prev);
  }
  const ai = $('#aiCategory');
  fillSelect(ai, CATEGORIES.map((c) => [c, catLabel(c)]), ai.value || CATEGORIES[0]);
  const unit = $('#unitStep');
  const step = unit.value || '1';
  fillSelect(unit, [['0.5', t('unitStep', { n: '0.5' })], ['1', t('unitStep', { n: '1' })], ['2', t('unitStep', { n: '2' })], ['4', t('unitStep', { n: '4' })]], step);
}
function applyTemplate(id) {
  const tp = templates.find((x) => x.id === id);
  if (!tp) return;
  fld(form, 'client').value = tp.client || '';
  fld(form, 'category').value = tp.category;
  fld(form, 'quotedPrice').value = tp.quotedPrice;
  fld(form, 'estimatedHours').value = tp.estimatedHours;
}
function openForm(id = null, tplId = '') {
  editingId = id;
  const r = id ? records.find((x) => x.id === id) : null;
  $('#formTitle').textContent = r ? t('formEdit') : t('formAdd');
  form.reset();
  resetErrors(form);
  fld(form, 'date').value = r ? r.date : localToday();
  $('#tplPickWrap').hidden = !!r;
  if (!r) {
    renderTplPick();
    $('#tplPick').value = tplId;
  }
  if (r) {
    fld(form, 'name').value = r.name;
    fld(form, 'client').value = r.client || '';
    fld(form, 'category').value = r.category;
    fld(form, 'quotedPrice').value = r.quotedPrice;
    fld(form, 'estimatedHours').value = r.estimatedHours;
    fld(form, 'actualHours').value = r.actualHours ?? '';
  } else if (tplId) {
    applyTemplate(tplId);
  }
  openModal(modal);
  fld(form, 'name').focus();
}
$('#tplPick').addEventListener('change', (e) => { if (e.target.value) applyTemplate(e.target.value); });
$('#saveAsTpl').addEventListener('click', () => {
  const raw = Object.fromEntries(new FormData(form));
  resetErrors(tplForm);
  tplForm.reset();
  for (const k of ['client', 'category', 'quotedPrice', 'estimatedHours']) {
    const f = fld(tplForm, k);
    if (f) f.value = raw[k] ?? '';
  }
  openModal(tplModal);
  fld(tplForm, 'name').focus();
});
form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = validateRecord(Object.fromEntries(new FormData(form)));
  showErrors(form, v.errors);
  if (!v.valid) return;
  if (editingId) {
    records = records.map((r) => (r.id === editingId ? { ...r, ...v.value } : r));
    toast(t('toastEdited'));
  } else {
    records.push({ id: newId(), changes: [], ...v.value });
    toast(t('toastAdded'));
  }
  persistRecords();
  closeModal(modal);
  renderAll();
});

// ---------- template form ----------
tplForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = validateTemplate(Object.fromEntries(new FormData(tplForm)));
  showErrors(tplForm, v.errors);
  if (!v.valid) return;
  templates = [...templates, { id: newId(), ...v.value }];
  persistTemplates();
  closeModal(tplModal);
  renderAll();
  toast(t('toastTplSaved'));
});
$('#tplAddBtn').addEventListener('click', () => {
  resetErrors(tplForm);
  tplForm.reset();
  openModal(tplModal);
  fld(tplForm, 'name').focus();
});
function deleteTemplate(id) {
  templates = templates.filter((tp) => tp.id !== id);
  persistTemplates();
  renderAll();
  toast(t('toastTplDeleted'));
}

// ---------- change requests (scope creep) ----------
function openChanges(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  changesFor = id;
  $('#chTitle').textContent = t('chTitle', { name: r.name });
  chForm.reset();
  resetErrors(chForm);
  fld(chForm, 'date').value = localToday();
  renderChanges();
  openModal(chModal);
  fld(chForm, 'note').focus();
}
function renderChanges() {
  const r = records.find((x) => x.id === changesFor);
  const list = $('#chList');
  list.replaceChildren();
  if (!r) return;
  const sum = changeSummary(r);
  $('#chSum').textContent = sum.count
    ? t('chSumCount', { n: sum.count, amt: money(sum.amount), h: hoursText(sum.hours), adj: money(adjustedQuote(r)) })
    : t('chSumNone', { amt: money(r.quotedPrice) });
  if (!r.changes.length) {
    list.append(emptyBlock('scope', t('chEmpty')));
    return;
  }
  [...r.changes].sort((a, b) => b.date.localeCompare(a.date)).forEach((c) => {
    const extra = [c.costHours ? `+${hoursText(c.costHours)}` : '', c.costAmount ? `+${money(c.costAmount)}` : ''].filter(Boolean).join(' · ');
    list.append(el('div', { class: 'ch-item' },
      el('div', { class: 'ch-main' },
        el('div', { class: 'nm', text: c.note }),
        el('div', { class: 'meta', text: `${fmtDate(c.date)}${extra ? ' · ' + extra : ''}` })),
      el('button', { class: 'btn sm danger', type: 'button', text: t('deleteBtn'), 'aria-label': t('ariaChDel', { note: c.note }),
        onclick: () => askConfirm(t('askDelChTitle'), t('askDelChMsg', { note: c.note }), t('deleteBtn'), () => deleteChange(c.id)) })));
  });
}
function setRecordChanges(id, fn) {
  records = records.map((r) => (r.id === id ? { ...r, changes: fn(r.changes) } : r));
  persistRecords();
  renderChanges();
  renderAll();
}
function deleteChange(cid) {
  setRecordChanges(changesFor, (list) => list.filter((c) => c.id !== cid));
  // The deleted button is gone and closeConfirm restored focus to it, so move focus inside the dialog.
  fld(chForm, 'note').focus();
  toast(t('toastChDeleted'));
}
chForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = validateChange(Object.fromEntries(new FormData(chForm)));
  showErrors(chForm, v.errors);
  if (!v.valid) return;
  setRecordChanges(changesFor, (list) => [...list, { id: newId(), ...v.value }]);
  chForm.reset();
  fld(chForm, 'date').value = localToday();
  resetErrors(chForm);
  fld(chForm, 'note').focus();
  toast(t('toastChAdded'));
});

// ---------- delete / demo / clear ----------
function deleteRecord(id) {
  records = records.filter((r) => r.id !== id);
  if (changesFor === id) {
    changesFor = null;
    chModal.hidden = true;
  }
  persistRecords();
  renderAll();
  toast(t('toastRecDeleted'));
}
function demoData() {
  const d = (n) => {
    const tm = new Date(Date.now() - n * 86400000);
    return new Date(tm.getTime() - tm.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  // Sample data: names and client tags are translated, category values stay canonical (Korean).
  const mk = (i, client, category, quotedPrice, estimatedHours, actualHours, ago) =>
    ({ id: 'demo' + i, demo: true, name: t('demoName', { name: t('demo' + i) }),
      client: client ? t('demoClient' + client) : '', category, quotedPrice, estimatedHours, actualHours, date: d(ago), changes: [] });
  const list = [
    mk(1, 'A', '디자인', 1200000, 20, 23, 150),
    mk(2, 'B', '개발', 3500000, 60, 88, 110),
    mk(3, 'C', '영상', 900000, 16, 15, 80),
    mk(4, 'B', '개발', 2400000, 40, 58, 50),
    mk(5, '', '글쓰기', 600000, 12, 13, 25),
    mk(6, 'A', '개발', 1800000, 30, null, 5),
  ];
  list[1].changes = [{ id: 'democh1', note: t('demoChange1'), date: d(100), costHours: 8, costAmount: 400000 }];
  list[0].changes = [{ id: 'democh2', note: t('demoChange2'), date: d(140), costHours: 2, costAmount: 150000 }];
  return list;
}
function loadDemo() {
  records = [...records.filter((r) => !r.demo), ...demoData()];
  persistRecords();
  renderAll();
  toast(t('toastDemo'));
}

// ---------- CSV / backup / summary ----------
function exportCSV() {
  if (!records.length) { toast(t('toastNoExport')); return; }
  downloadFile(`estimate-check-${localToday()}.csv`, BOM + toCSV(records), 'text/csv;charset=utf-8');
  toast(t('toastExported', { n: records.length }));
}
// Reads UTF-8; falls back to EUC-KR (Excel's Korean CSV default) when UTF-8 decoding hits invalid bytes.
async function readText(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) {
    try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* keep UTF-8 result */ }
  }
  return text;
}
function duplicateRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  const copy = { ...r, id: newId(), name: t('copyName', { name: r.name }).slice(0, 60), date: localToday(),
    actualHours: null, demo: false, changes: [] };
  records = [...records, copy];
  persistRecords();
  renderAll();
  toast(t('toastDup'));
}
async function importCSVFile(file) {
  let text;
  try { text = await readText(file); } catch { toast(t('readFail')); return; }
  const { records: rows, errors } = importCSV(text);
  if (!rows.length) {
    toast(errors.length ? t('importFail', { line: errors[0].line, msg: errors[0].message }) : t('importNone'));
    return;
  }
  records = [...records, ...rows.map((r) => ({ id: newId(), changes: [], ...r }))];
  persistRecords();
  renderAll();
  const skipped = errors.length ? t('importSkip', { n: errors.length, line: errors[0].line, msg: errors[0].message }) : '';
  toast(t('toastImported', { n: rows.length, skip: skipped }));
}
function backupJSON() {
  const text = JSON.stringify(buildBackup({ records, templates, settings }, new Date().toISOString()), null, 2);
  downloadFile(`estimate-check-backup-${localToday()}.json`, text, 'application/json');
  toast(t('toastBackup'));
}
async function restoreFile(file) {
  let text;
  try { text = await readText(file); } catch { toast(t('readFail')); return; }
  const res = parseBackup(text);
  if (!res.ok) { toast(res.error); return; }
  askConfirm(t('askRestoreTitle'),
    t('askRestoreMsg', { r: res.records.length, t: res.templates.length }),
    t('restoreBtn'), () => {
      const seen = new Set();
      records = res.records.map((r) => {
        const id = r.id && !seen.has(r.id) ? r.id : newId();
        seen.add(id);
        const changes = r.changes.map((c) => ({ ...c, id: c.id || newId() }));
        return { ...r, id, changes };
      });
      templates = res.templates.map((tp) => ({ ...tp, id: tp.id || newId() }));
      settings = res.settings;
      writeJSON(SET_KEY, settings);
      $('#targetInput').value = settings.monthlyTarget || '';
      persistRecords();
      persistTemplates();
      renderAll();
      toast(t('toastRestored') + (res.skipped ? t('restoreSkip', { n: res.skipped }) : ''));
    });
}

// ---------- comparison ----------
const CMP_SEL = { a: '#cmpA', b: '#cmpB' };
function fillCompareSelect(sel, prevId, fallbackIndex) {
  const list = sortRecords(records, 'date-desc');
  sel.replaceChildren(...list.map((r) => el('option', { value: r.id, text: t('cmpOption', { name: r.name, date: r.date ? fmtDate(r.date) : t('noDate') }) })));
  const hasPrev = list.some((r) => r.id === prevId);
  if (hasPrev) sel.value = prevId;
  else if (list[fallbackIndex]) sel.value = list[fallbackIndex].id;
}
function renderCompareSelects() {
  const a = $(CMP_SEL.a), b = $(CMP_SEL.b);
  const prevA = a.value, prevB = b.value;
  fillCompareSelect(a, prevA, 0);
  fillCompareSelect(b, prevB, 1);
  a.disabled = b.disabled = records.length < 2;
}
function fmtCmpValue(unit, v) {
  if (v == null) return '-';
  if (unit === 'won') return money(v);
  if (unit === 'hours') return hoursText(v);
  if (unit === 'pct') return fmtSigned(v) + '%';
  return String(v);
}
function fmtCmpDiff(unit, d) {
  if (d == null) return '-';
  if (unit === 'won') return (d > 0 ? '+' : '') + money(d);
  if (unit === 'hours') return (d > 0 ? '+' : '') + hoursText(d);
  if (unit === 'pct') return fmtSigned(d) + ' ' + t('pctPoint');
  return String(d);
}
function renderCompare() {
  const out = $('#cmpOut');
  if (records.length < 2) {
    out.replaceChildren(el('p', { class: 'hint', text: t('cmpNeed') }));
    return;
  }
  const a = records.find((r) => r.id === $(CMP_SEL.a).value);
  const b = records.find((r) => r.id === $(CMP_SEL.b).value);
  const c = compareProjects(a, b);
  if (!c) {
    out.replaceChildren(el('p', { class: 'hint', text: t('cmpDiffNeed') }));
    return;
  }
  const rows = c.rows.map((r) => el('tr', {},
    el('th', { scope: 'row', text: r.label }),
    el('td', { class: 'num', text: fmtCmpValue(r.unit, r.left) }),
    el('td', { class: 'num', text: fmtCmpValue(r.unit, r.right) }),
    el('td', { class: 'num diff', text: fmtCmpDiff(r.unit, r.diff) })));
  rows.push(el('tr', {},
    el('th', { scope: 'row', text: t('cmpAccuracy') }),
    el('td', { text: c.leftLevel }),
    el('td', { text: c.rightLevel }),
    el('td', { text: '-' })));
  out.replaceChildren(
    el('div', { class: 'cmp-wrap', role: 'region', 'aria-label': t('cmpRegion'), tabindex: '0' },
      el('table', { class: 'cmp' },
        el('caption', { class: 'sr-only', text: t('cmpCaption', { a: c.left.name, b: c.right.name }) }),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: t('cmpMetric') }),
          el('th', { scope: 'col', text: t('cmpColA', { name: c.left.name }) }),
          el('th', { scope: 'col', text: t('cmpColB', { name: c.right.name }) }),
          el('th', { scope: 'col', text: t('cmpColDiff') }))),
        el('tbody', {}, ...rows))));
}

// ---------- printable report ----------
function printReport() {
  const r = buildPrintReport(records, localToday());
  const area = $('#printArea');
  const stats = el('dl', { class: 'print-stats' }, ...r.stats.map((s) =>
    el('div', {}, el('dt', { text: s.label }), el('dd', { text: s.value }))));
  const head = el('tr', {}, ...[t('prName'), t('prClient'), t('prCategory'), t('prDate'), t('prQuote'), t('prEst'), t('prAct'), t('prVar'), t('prAcc')]
    .map((x) => el('th', { scope: 'col', text: x })));
  const body = r.rows.map((x) => el('tr', {},
    el('td', { text: x.name }), el('td', { text: x.client }), el('td', { text: x.category }),
    el('td', { text: fmtDate(x.date) }), el('td', { class: 'num', text: x.quoted }), el('td', { class: 'num', text: x.estimated }),
    el('td', { class: 'num', text: x.actual }), el('td', { class: 'num', text: x.overrun }), el('td', { text: x.level })));
  area.replaceChildren(
    el('h1', { text: r.title }),
    el('p', { text: r.date ? t('printBase', { d: fmtDate(r.date) }) : '' }),
    stats,
    el('p', { text: t('printSuggest', { text: r.suggestion }) }),
    r.empty
      ? el('p', { text: t('printEmpty') })
      : el('table', { class: 'print-table' }, el('thead', {}, head), el('tbody', {}, ...body)),
    el('p', { class: 'print-note', text: r.note }));
  window.print();
}

async function copySummary() {
  const ok = await copyText(buildSummaryText(records, localToday()));
  toast(ok ? t('toastCopied') : t('toastCopyFail'));
}

$('#demoBtn').addEventListener('click', loadDemo);
$('#addBtn').addEventListener('click', () => openForm());
$('#copySummary').addEventListener('click', copySummary);
$('#printBtn').addEventListener('click', printReport);
$(CMP_SEL.a).addEventListener('change', renderCompare);
$(CMP_SEL.b).addEventListener('change', renderCompare);
$('#exportBtn').addEventListener('click', exportCSV);
$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importCSVFile(file);
  e.target.value = '';
});
$('#backupBtn').addEventListener('click', backupJSON);
$('#restoreFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) restoreFile(file);
  e.target.value = '';
});
$('#clearBtn').addEventListener('click', () => askConfirm(t('askClearTitle'),
  t('askClearMsg', { n: records.length }), t('clearAll'), () => {
    records = [];
    persistRecords();
    renderAll();
    toast(t('toastCleared'));
  }));
$('#targetInput').addEventListener('change', (e) => {
  settings = sanitizeSettings({ monthlyTarget: e.target.value });
  writeJSON(SET_KEY, settings);
  renderMonthly();
  toast(settings.monthlyTarget ? t('toastTarget') : t('toastTargetClear'));
});

// toolbar: search, filters, sort
$('#search').addEventListener('input', (e) => { view.query = e.target.value; renderList(); });
$('#fCategory').addEventListener('change', (e) => { view.category = e.target.value; renderList(); });
$('#fClient').addEventListener('change', (e) => { view.client = e.target.value; renderList(); });
$('#sort').addEventListener('change', (e) => { view.sort = e.target.value; renderList(); });

// unit helper
$('#unitForm').addEventListener('input', renderUnit);
$('#unitForm').addEventListener('change', renderUnit);
$('#unitForm').addEventListener('submit', (e) => e.preventDefault());

// sticky summary
window.addEventListener('scroll', syncSticky, { passive: true });

// ---------- theme ----------
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function syncThemeBtn() {
  const dark = currentTheme() === 'dark';
  const btn = $('#themeBtn');
  btn.textContent = dark ? t('themeLight') : t('themeDark');
  btn.setAttribute('aria-pressed', String(dark));
}
$('#themeBtn').addEventListener('click', () => {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  syncThemeBtn();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeBtn);

// ---------- language ----------
function applyLanguage(code) {
  setLang(code);
  saveLang(code);
  applyI18n();
  document.title = t('docTitle');
  document.querySelector('meta[name="description"]').setAttribute('content', t('metaDesc'));
  const sel = $('#langSelect');
  if (sel.value !== getLang()) sel.value = getLang();
  fillCategorySelects();
  syncAiMode();
  syncThemeBtn();
  renderAll();
  renderUnit();
  renderAiOut(aiState.result, aiState.opts);
}
{
  const sel = $('#langSelect');
  sel.replaceChildren(...Object.entries(LANGS).map(([k, v]) => el('option', { value: k, text: v.name })));
  sel.addEventListener('change', (e) => applyLanguage(e.target.value));
}

// ---------- AI review (optional, uses the user's own key) ----------
let aiBusy = false;
const aiState = { result: null, opts: {} };
function readAiKey() {
  try { return (localStorage.getItem(AI_KEY_STORAGE) || '').trim(); } catch { return ''; }
}
function writeAiKey(v) {
  try { localStorage.setItem(AI_KEY_STORAGE, v); return true; } catch { return false; }
}
function removeAiKey() {
  try { localStorage.removeItem(AI_KEY_STORAGE); return true; } catch { return false; }
}
function syncAiMode() {
  const on = !!readAiKey();
  $('#aiMode').textContent = on ? t('aiModeAi') : t('aiModeBasic');
  $('#aiKeyToggle').textContent = on ? t('aiKeyManage') : t('aiKeySet');
}
function aiList(title, list, empty) {
  const wrap = el('div', { class: 'ai-block' }, el('h3', { class: 'sub-h', text: title }));
  if (!list.length) { wrap.append(el('p', { class: 'hint', text: empty })); return wrap; }
  const ul = el('ul', { class: 'ai-list' });
  for (const x of list) ul.append(el('li', {}, el('strong', { text: x.item }), el('span', { text: x.reason })));
  wrap.append(ul);
  return wrap;
}
// Everything here is set with textContent, so model output is never parsed as HTML.
function renderAiOut(result, opts = {}) {
  aiState.result = result;
  aiState.opts = opts;
  const { source = 'local', note = '', busy = false } = opts;
  const out = $('#aiOut');
  out.replaceChildren();
  if (busy) { out.append(el('p', { class: 'hint', text: t('aiBusy') })); return; }
  if (note) out.append(el('p', { class: 'tip warn', text: note }));
  if (!result) {
    if (!note) out.append(el('p', { class: 'hint', text: t('aiIdle') }));
    return;
  }
  out.append(el('p', { class: 'ai-sum', text: result.summary }));
  out.append(aiList(t('aiRisks'), result.risks, t('aiNoRisks')));
  out.append(aiList(t('aiMissing'), result.missing, t('aiNoMissing')));
  if (result.hoursAdjustmentPct > 0) {
    out.append(el('p', { class: 'tip good', text: t('aiAdjust', { pct: result.hoursAdjustmentPct }) }));
  }
  out.append(el('p', { class: 'hint', text: source === 'ai' ? t('aiResultAi') : t('aiResultLocal') }));
}
async function runAiReview(e) {
  e.preventDefault();
  if (aiBusy) return;
  const category = resolveCategory($('#aiCategory').value);
  const { items, skipped } = parseLineItems($('#aiItems').value);
  if (!items.length) {
    renderAiOut(null, { note: t('aiNeedItems') });
    return;
  }
  const skipNote = skipped ? t('aiSkipNote', { max: AI_MAX_ITEMS, n: skipped }) : '';
  const benchmark = categoryBreakdown(records).find((c) => c.category === category) || null;
  const local = localReview({ items, category, records });
  const key = readAiKey();
  if (!key) {
    renderAiOut(local, { note: t('aiNoKey') + skipNote });
    return;
  }
  aiBusy = true;
  $('#aiRun').disabled = true;
  renderAiOut(null, { busy: true });
  let note = '';
  try {
    const { system, user } = buildReviewPrompt({ items, category, benchmark, lang: getLang() });
    const req = buildAnthropicRequest({ apiKey: key, system, user });
    const res = await fetch(req.url, req.init);
    if (!res.ok) {
      note = aiErrorMessage(res.status);
    } else {
      const body = await res.json();
      const usable = body.stop_reason !== 'max_tokens' && body.stop_reason !== 'refusal';
      const parsed = usable ? parseReviewResponse(extractText(body)) : null;
      if (parsed) { renderAiOut(parsed, { source: 'ai', note: skipNote.trim() }); return; }
      note = t('aiParseFail');
    }
  } catch (err) {
    note = err instanceof TypeError ? t('aiNetFail') : t('aiReadFail');
  } finally {
    aiBusy = false;
    $('#aiRun').disabled = false;
  }
  renderAiOut(local, { note: t('aiFallback', { note, skip: skipNote }) });
}
$('#aiKeyToggle').addEventListener('click', () => {
  const box = $('#aiKeyBox');
  const open = box.hidden;
  box.hidden = !open;
  $('#aiKeyToggle').setAttribute('aria-expanded', String(open));
  if (open) $('#aiKeyInput').focus();
});
$('#aiKeySave').addEventListener('click', () => {
  const v = $('#aiKeyInput').value.trim();
  if (!isPlausibleKey(v)) { toast(t('keyBad')); return; }
  if (!writeAiKey(v)) { toast(t('keyCantSave')); return; }
  $('#aiKeyInput').value = '';
  syncAiMode();
  toast(t('keySaved'));
});
$('#aiKeyClear').addEventListener('click', () => {
  removeAiKey();
  $('#aiKeyInput').value = '';
  syncAiMode();
  toast(t('keyDeleted'));
});
$('#aiForm').addEventListener('submit', runAiReview);
$('#aiExample').addEventListener('click', () => { $('#aiItems').value = t('aiExampleText'); });

// ---------- init ----------
const savedTheme = getTheme();
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
setLang(detectLang(readSavedLang()));
$('#langSelect').value = getLang();
applyI18n();
document.title = t('docTitle');
document.querySelector('meta[name="description"]').setAttribute('content', t('metaDesc'));
fillCategorySelects();
syncThemeBtn();
syncAiMode();
renderAiOut(null);
{
  const raw = readJSON(KEY, []);
  // Malformed saved rows are dropped instead of crashing the charts.
  records = (Array.isArray(raw) ? raw : [])
    .map((r) => sanitizeRecord(r))
    .filter(Boolean)
    .map((r) => (r.id ? r : { ...r, id: newId() }));
  const tpl = readJSON(TPL_KEY, []);
  templates = (Array.isArray(tpl) ? tpl : []).map(sanitizeTemplate).filter(Boolean)
    .map((tp) => (tp.id ? tp : { ...tp, id: newId() }));
  settings = sanitizeSettings(readJSON(SET_KEY, {}));
  $('#targetInput').value = settings.monthlyTarget || '';
}
renderAll();
renderUnit();
syncSticky();
