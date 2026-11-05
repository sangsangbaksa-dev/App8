import {
  CATEGORIES, NO_CLIENT, UNSET_LABEL, SORT_MODES, WARN_LIMIT, HOURS_PER_DAY,
  computeStats, categoryBreakdown, breakdownBy, clientList, suggestion, recordSuggestion,
  validateRecord, validateChange, validateTemplate, overrunPct, isFinished, fmtSigned, fmtWon,
  accuracyLevel, filterRecords, sortRecords, normalizeRecord, toCSV, importCSV,
  roundHoursUp, hoursToDays, withSurcharge, hourlyRate,
  monthlyTotals, changeSummary, adjustedQuote, scopeCreepSummary, buildSummaryText,
  sanitizeRecord, sanitizeTemplate, sanitizeSettings, buildBackup, parseBackup,
} from './logic.js';

const KEY = 'estimate-check:v1';
const THEME_KEY = 'estimate-check:theme';
const TPL_KEY = 'estimate-check:templates:v1';
const SET_KEY = 'estimate-check:settings:v1';
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BOM = String.fromCharCode(0xfeff);
const SORT_LABELS = {
  'date-desc': '최신순', 'date-asc': '오래된순', 'variance-desc': '편차 큰 순',
  'variance-asc': '편차 작은 순', 'price-desc': '견적 금액 큰 순',
};
const LEVEL_VAR = { good: '--good', warn: '--warn', bad: '--bad' };

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
  if (!writeJSON(KEY, records)) toast('저장소를 사용할 수 없어 새로고침 시 사라져요.');
}
function persistTemplates() {
  if (!writeJSON(TPL_KEY, templates)) toast('저장소를 사용할 수 없어 새로고침 시 사라져요.');
}
function getTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
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
  const t = el('div', { class: 'toast', text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3200);
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
  const t0 = performance.now(), dur = 900;
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
  const s = svgEl('svg', { viewBox: '0 0 120 90', width: '112', height: '84', class: 'art', 'aria-hidden': 'true', focusable: 'false' });
  const paper = 'stroke:var(--line-strong);fill:var(--surface-2)';
  const ink = 'stroke:var(--muted);fill:none';
  const badge = 'stroke:var(--accent);fill:var(--surface)';
  if (kind === 'template') s.append(svgEl('rect', { x: 42, y: 4, width: 50, height: 62, rx: 8, style: paper, 'stroke-width': 2 }));
  s.append(svgEl('rect', { x: 30, y: 14, width: 54, height: 66, rx: 8, style: paper, 'stroke-width': 2 }));
  for (let i = 0; i < 3; i++) {
    s.append(svgEl('line', { x1: 42, x2: 72 - i * 8, y1: 34 + i * 12, y2: 34 + i * 12, style: ink, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  }
  s.append(svgEl('circle', { cx: 88, cy: 24, r: 14, style: badge, 'stroke-width': 2.5 }));
  if (kind === 'list') {
    s.append(svgEl('path', { d: 'M81 24l5 5 9-10', style: 'stroke:var(--good);fill:none', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  } else {
    s.append(svgEl('path', { d: 'M88 17v14M81 24h14', style: 'stroke:var(--accent);fill:none', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
  }
  return s;
}
function emptyBlock(kind, text, action = null) {
  return el('div', { class: 'empty' }, artSvg(kind), el('p', { text }), action);
}

// ---------- render: dashboard ----------
function renderSticky(s) {
  $('#stCount').textContent = `${s.count}건`;
  $('#stHit').textContent = s.hitRate == null ? '-' : Math.round(s.hitRate) + '%';
  $('#stAvg').textContent = s.avgOverrun == null ? '-' : fmtSigned(s.avgOverrun) + '%';
  $('#stRate').textContent = s.effectiveRate == null ? '-' : fmtWon(s.effectiveRate) + '원';
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
    ['총 견적 금액', s.totalQuoted, (n) => fmtWon(n), '원'],
    ['총 실제 시간', s.totalActualHours, (n) => (Math.round(n * 10) / 10).toString(), '시간'],
    ['실질 시급', s.effectiveRate, (n) => fmtWon(n), '원/시간'],
    ['적중률 (±10%)', s.hitRate, (n) => Math.round(n).toString(), '%'],
    ['평균 편차율', s.avgOverrun, (n) => fmtSigned(n), '%'],
  ];
  const box = $('#stats');
  box.replaceChildren();
  defs.forEach(([k, v, fmt, unit], i) => {
    const val = el('span', { text: '-' });
    const card = el('div', { class: 'stat', style: `animation-delay:${i * 70}ms` },
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v' }, val, v == null ? null : el('span', { class: 'u', text: ' ' + unit })));
    box.append(card);
    countUp(val, v, fmt);
  });
}
function renderSuggestion() {
  const s = suggestion(records);
  const c = $('#suggestCard');
  c.className = 'card suggest ' + (s.kind === 'neutral' ? '' : s.kind);
  c.replaceChildren(
    el('div', { class: 'ico', 'aria-hidden': 'true', text: s.kind === 'warn' ? '!' : s.kind === 'good' ? 'OK' : 'i' }),
    el('div', {}, el('strong', { text: '다음 견적 제안' }), el('p', { text: s.message })));
}
function renderBars(sel, rows, emptyText) {
  const box = $(sel);
  box.replaceChildren();
  if (!rows.some((r) => r.finishedCount > 0)) {
    box.append(el('div', { class: 'empty small-empty' }, el('p', { text: emptyText })));
    return;
  }
  const max = Math.max(WARN_LIMIT, ...rows.map((r) => Math.abs(r.avgOverrun ?? 0)));
  const fills = [];
  for (const r of rows) {
    const has = r.avgOverrun !== null;
    const pct = has ? Math.min(100, (Math.abs(r.avgOverrun) / max) * 100) : 0;
    const fill = el('div', { class: 'bar-fill ' + (has && r.avgOverrun < 0 ? 'neg' : 'pos') });
    fills.push([fill, pct]);
    box.append(el('div', { class: 'bar-row' },
      el('span', { class: 'bar-label', text: r.label }),
      el('div', { class: 'bar-track', role: 'img', 'aria-label': `${r.label} ${has ? fmtSigned(r.avgOverrun) + '%' : '데이터 없음'}` }, fill),
      el('div', { class: 'bar-val' }, has ? fmtSigned(r.avgOverrun) + '%' : '-',
        el('div', { class: 'bar-sub', text: `${r.finishedCount}건 완료` }))));
  }
  requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(([f, p]) => { f.style.width = p + '%'; })));
}
function renderTrend() {
  const box = $('#trend');
  box.replaceChildren();
  const pts = [...records].filter((r) => r.estimatedHours > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) {
    box.append(el('div', { class: 'empty small-empty' }, el('p', { text: '프로젝트가 2건 이상이면 추이 그래프가 표시돼요.' })));
    return;
  }
  const W = 480, H = 220, L = 38, R = 14, T = 14, B = 28;
  const maxV = Math.max(...pts.flatMap((r) => [r.estimatedHours, r.actualHours || 0])) * 1.1;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '프로젝트별 예상 시간과 실제 시간 추이' });
  for (let g = 0; g <= 4; g++) {
    const v = (maxV * g) / 4, yy = y(v);
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, stroke: 'currentColor', 'stroke-opacity': '.14' }));
    const t = svgEl('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.7' });
    t.textContent = Math.round(v);
    svg.append(t);
  }
  const line = (key, color, dash) => {
    const seg = pts.map((r, i) => [i, r[key]]).filter(([, v]) => v > 0);
    if (!seg.length) return;
    const p = svgEl('polyline', { points: seg.map(([i, v]) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (dash) p.setAttribute('stroke-dasharray', dash);
    svg.append(p);
    for (const [i, v] of seg) {
      const c = svgEl('circle', { cx: x(i), cy: y(v), r: '4', fill: color });
      const tt = svgEl('title');
      tt.textContent = `${pts[i].name}: ${v}시간`;
      c.append(tt);
      svg.append(c);
    }
  };
  line('estimatedHours', '#18b4e8', '6 4');
  line('actualHours', '#e14eca');
  pts.forEach((r, i) => {
    if (pts.length > 8 && i % 2) return;
    const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.7' });
    t.textContent = r.date.slice(5);
    svg.append(t);
  });
  box.append(svg, el('div', { class: 'legend' },
    el('span', {}, el('i', { class: 'dot', style: 'background:#18b4e8' }), '예상 시간'),
    el('span', {}, el('i', { class: 'dot', style: 'background:#e14eca' }), '실제 시간')));
}
function renderVariance() {
  const box = $('#varChart');
  box.replaceChildren();
  const pts = sortRecords(records.filter(isFinished), 'date-asc');
  if (pts.length < 2) {
    box.append(el('div', { class: 'empty small-empty' }, el('p', { text: '완료된 프로젝트가 2건 이상이면 편차율 막대가 표시돼요.' })));
    return;
  }
  const W = 480, H = 180, L = 44, R = 10, T = 12, B = 26;
  const maxAbs = Math.max(WARN_LIMIT, ...pts.map((r) => Math.abs(overrunPct(r))));
  const cap = Math.ceil(maxAbs / 10) * 10;
  const y = (v) => T + (1 - (v + cap) / (2 * cap)) * (H - T - B);
  const zero = y(0);
  const slot = (W - L - R) / pts.length;
  const bw = Math.max(4, Math.min(28, slot * 0.6));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '프로젝트별 편차율 막대 그래프' });
  for (const v of [-cap, -cap / 2, 0, cap / 2, cap]) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': v === 0 ? '.4' : '.14' }));
    const t = svgEl('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.7' });
    t.textContent = `${v > 0 ? '+' : ''}${Math.round(v)}%`;
    svg.append(t);
  }
  const labelStep = Math.ceil(pts.length / 8);
  pts.forEach((r, i) => {
    const v = overrunPct(r);
    const cx = L + slot * (i + 0.5);
    const top = Math.min(y(v), zero);
    const h = Math.max(1.5, Math.abs(y(v) - zero));
    const lvl = accuracyLevel(v);
    const bar = svgEl('rect', { x: cx - bw / 2, y: top, width: bw, height: h, rx: 3, style: `fill:var(${LEVEL_VAR[lvl]})` });
    const tt = svgEl('title');
    tt.textContent = `${r.name}: ${fmtSigned(Math.round(v * 10) / 10)}%`;
    bar.append(tt);
    svg.append(bar);
    if (i % labelStep === 0) {
      const t = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.7' });
      t.textContent = r.date.slice(5);
      svg.append(t);
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
    box.append(el('div', { class: 'empty small-empty' }, el('p', { text: '프로젝트 날짜가 쌓이면 월별 견적 금액과 목표선이 보여요.' })));
    return;
  }
  const W = 480, H = 200, L = 52, R = 10, T = 14, B = 28;
  const maxV = (Math.max(target, ...rows.map((r) => r.total)) * 1.1) || 1;
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const slot = (W - L - R) / rows.length;
  const bw = Math.max(6, Math.min(36, slot * 0.6));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '월별 견적 금액과 목표선' });
  for (let g = 0; g <= 4; g++) {
    const v = (maxV * g) / 4;
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': '.14' }));
    const t = svgEl('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.7' });
    t.textContent = Math.round(v / 10000) + '만';
    svg.append(t);
  }
  const labelStep = Math.ceil(rows.length / 8);
  rows.forEach((r, i) => {
    const cx = L + slot * (i + 0.5);
    const top = y(r.total);
    const bar = svgEl('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(0, T + (H - T - B) - top), rx: 4, style: 'fill:var(--accent)' });
    const tt = svgEl('title');
    tt.textContent = `${r.month}: ${fmtWon(r.total)}원`;
    bar.append(tt);
    svg.append(bar);
    if (i % labelStep === 0) {
      const t = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.7' });
      t.textContent = r.month.slice(2);
      svg.append(t);
    }
  });
  if (target > 0) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(target), y2: y(target), style: 'stroke:var(--warn)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
    const t = svgEl('text', { x: W - R, y: y(target) - 6, 'text-anchor': 'end', 'font-size': '11', style: 'fill:var(--warn)', 'font-weight': '700' });
    t.textContent = `목표 ${Math.round(target / 10000)}만`;
    svg.append(t);
  }
  box.append(svg);
  if (target > 0) {
    const hit = rows.filter((r) => r.total >= target).length;
    box.append(el('p', { class: 'legend', text: `목표 달성 ${hit}개월 / 전체 ${rows.length}개월` }));
  }
}
function renderScope() {
  const box = $('#scopeBox');
  box.replaceChildren();
  const s = scopeCreepSummary(records);
  if (!s.count) {
    box.append(emptyBlock('scope', '프로젝트 카드의 "변경 요청"에서 추가 요청과 추가 금액을 기록하면 여기서 한눈에 볼 수 있어요.'));
    return;
  }
  box.append(el('dl', { class: 'kvs' },
    kv('변경 요청', `${s.count}건 (${s.projects}개 프로젝트)`),
    kv('추가 금액', `${fmtWon(s.amount)}원`),
    kv('추가 시간', `${s.hours}h`),
    kv('견적 대비', s.ratioPct == null ? '-' : `+${s.ratioPct}%`)));
  box.append(el('h3', { class: 'sub-h', text: '추가 금액이 큰 프로젝트' }));
  for (const p of s.perRecord.slice(0, 5)) {
    box.append(el('div', { class: 'scope-row' },
      el('span', { class: 'nm', text: p.name }),
      el('span', { class: 'scope-amt', text: `+${fmtWon(p.amount)}원` })));
  }
}
function renderTemplates() {
  const box = $('#tplList');
  box.replaceChildren();
  if (!templates.length) {
    box.append(emptyBlock('template', '자주 쓰는 견적을 템플릿으로 저장하면 새 프로젝트에 한 번에 채울 수 있어요.'));
    return;
  }
  [...templates].sort((a, b) => a.name.localeCompare(b.name)).forEach((t) => {
    box.append(el('div', { class: 'tpl-item' },
      el('div', { class: 'tpl-main' },
        el('div', { class: 'nm', text: t.name }),
        el('div', { class: 'meta', text: `${t.category}${t.client ? ' · ' + t.client : ''} · ${fmtWon(t.quotedPrice)}원 · 예상 ${t.estimatedHours}h` })),
      el('div', { class: 'actions' },
        el('button', { class: 'btn sm primary', type: 'button', text: '추가', 'aria-label': `${t.name} 템플릿으로 프로젝트 추가`, onclick: () => openForm(null, t.id) }),
        el('button', { class: 'btn sm danger', type: 'button', text: '삭제', 'aria-label': `${t.name} 템플릿 삭제`,
          onclick: () => askConfirm('템플릿 삭제', `"${t.name}" 템플릿을 삭제할까요?`, '삭제', () => deleteTemplate(t.id)) }))));
  });
}
function renderAll() {
  renderStats();
  renderSuggestion();
  renderBars('#catBars',
    categoryBreakdown(records).map((r) => ({ label: r.category, finishedCount: r.finishedCount, avgOverrun: r.avgOverrun })),
    '완료된 프로젝트가 생기면 카테고리별 편차가 보여요.');
  renderBars('#clientBars',
    breakdownBy(records, 'client').map((r) => ({ label: r.label, finishedCount: r.finishedCount, avgOverrun: r.avgOverrun })),
    '고객 태그를 입력하면 고객별 편차를 볼 수 있어요.');
  renderTrend();
  renderVariance();
  renderMonthly();
  renderTemplates();
  renderScope();
  renderFilters();
  renderList();
}

// ---------- render: unit helper ----------
function renderUnit() {
  const uf = $('#unitForm');
  const f = (n) => uf.elements.namedItem(n);
  const out = $('#unitOut');
  out.replaceChildren();
  const h = Number(f('hours').value);
  if (!(h > 0)) {
    out.append(el('div', { class: 'empty small-empty' }, el('p', { text: '작업 시간을 입력하면 결과가 나와요.' })));
    return;
  }
  const step = Number(f('step').value);
  const pct = Number(f('pct').value) || 0;
  const price = f('price').value;
  const rows = [
    [`청구 단위 ${step}시간 기준 올림`, roundHoursUp(h, step), (v) => `${v}시간`],
    [`일 환산 (${HOURS_PER_DAY}시간 기준)`, hoursToDays(h), (v) => `${v}일`],
    [`가산 후 시간 (+${pct}%)`, withSurcharge(h, pct), (v) => `${v}시간`],
    ['시급 환산 (견적 금액 기준)', hourlyRate(price, h), (v) => `${fmtWon(v)}원/시간`],
  ];
  const dl = el('dl', { class: 'kvs' });
  for (const [k, v, fmt] of rows) dl.append(kv(k, v == null ? '-' : fmt(v)));
  out.append(dl);
}

// ---------- render: records list ----------
function renderFilters() {
  const catSel = $('#fCategory'), cliSel = $('#fClient'), sortSel = $('#sort'), dl = $('#clientList');
  const clients = clientList(records);
  if (view.category && !CATEGORIES.includes(view.category)) view.category = '';
  if (view.client && view.client !== NO_CLIENT && !clients.includes(view.client)) view.client = '';
  catSel.replaceChildren(el('option', { value: '', text: '전체 카테고리' }),
    ...CATEGORIES.map((c) => el('option', { value: c, text: c })));
  cliSel.replaceChildren(el('option', { value: '', text: '전체 고객' }),
    el('option', { value: NO_CLIENT, text: UNSET_LABEL }),
    ...clients.map((c) => el('option', { value: c, text: c })));
  if (!sortSel.options.length) {
    sortSel.replaceChildren(...SORT_MODES.map((m) => el('option', { value: m, text: SORT_LABELS[m] })));
  }
  dl.replaceChildren(...clients.map((c) => el('option', { value: c })));
  catSel.value = view.category;
  cliSel.value = view.client;
  sortSel.value = view.sort;
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
    box.append(emptyBlock('list', '아직 기록이 없어요. 프로젝트를 추가하거나 예시 데이터로 먼저 둘러보세요.',
      el('button', { class: 'btn primary sm', type: 'button', text: '예시 데이터 불러오기', onclick: loadDemo })));
    return;
  }
  const rows = sortRecords(filterRecords(records, view), view.sort);
  $('#countLine').textContent = `전체 ${records.length}건 · 표시 ${rows.length}건`;
  if (!rows.length) {
    box.append(emptyBlock('list', '조건에 맞는 기록이 없어요.',
      el('button', { class: 'btn ghost sm', type: 'button', text: '필터 초기화', onclick: resetView })));
    return;
  }
  rows.forEach((r, i) => box.append(recordItem(r, i)));
}
function recordItem(r, i) {
  const o = overrunPct(r);
  const level = accuracyLevel(o);
  const label = level === 'pending' ? '진행 중' : `${fmtSigned(Math.round(o * 10) / 10)}%`;
  const sug = recordSuggestion(r);
  const cs = changeSummary(r);
  return el('article', { class: 'item', style: `animation-delay:${Math.min(i, 8) * 40}ms` },
    el('div', { class: 'item-main' },
      el('div', { class: 'badges' },
        el('span', { class: 'badge', text: r.category }),
        r.client ? el('span', { class: 'badge client', text: r.client }) : null,
        r.demo ? el('span', { class: 'badge demo', text: '예시' }) : null,
        el('span', { class: 'badge acc ' + level, text: label })),
      el('h3', { class: 'nm', text: r.name }),
      el('div', { class: 'meta', text: `${r.date} · ${fmtWon(r.quotedPrice)}원 · 예상 ${r.estimatedHours}h / 실제 ${isFinished(r) ? r.actualHours + 'h' : '-'}` }),
      cs.count ? el('div', { class: 'meta change-line', text: `변경 요청 ${cs.count}건 · +${fmtWon(cs.amount)}원 · 조정 견적 ${fmtWon(adjustedQuote(r))}원` }) : null,
      sug ? el('p', { class: 'tip ' + sug.level, text: sug.text }) : null),
    el('div', { class: 'actions' },
      el('button', { class: 'btn sm', type: 'button', 'aria-label': `${r.name} 수정`, text: '수정', onclick: () => openForm(r.id) }),
      el('button', { class: 'btn sm', type: 'button', 'aria-label': `${r.name} 변경 요청`, text: '변경', onclick: () => openChanges(r.id) }),
      el('button', { class: 'btn sm', type: 'button', 'aria-label': `${r.name} 복제`, text: '복제', onclick: () => duplicateRecord(r.id) }),
      el('button', { class: 'btn sm danger', type: 'button', 'aria-label': `${r.name} 삭제`, text: '삭제',
        onclick: () => askConfirm('기록 삭제', `"${r.name}" 기록을 삭제할까요?`, '삭제', () => deleteRecord(r.id)) })));
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
  sel.replaceChildren(el('option', { value: '', text: '직접 입력' }),
    ...[...templates].sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => el('option', { value: t.id, text: `${t.name} (${t.category})` })));
}
function applyTemplate(id) {
  const t = templates.find((x) => x.id === id);
  if (!t) return;
  fld(form, 'client').value = t.client || '';
  fld(form, 'category').value = t.category;
  fld(form, 'quotedPrice').value = t.quotedPrice;
  fld(form, 'estimatedHours').value = t.estimatedHours;
}
function openForm(id = null, tplId = '') {
  editingId = id;
  const r = id ? records.find((x) => x.id === id) : null;
  $('#formTitle').textContent = r ? '프로젝트 수정' : '프로젝트 추가';
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
    toast('기록을 수정했어요.');
  } else {
    records.push({ id: newId(), changes: [], ...v.value });
    toast('프로젝트를 추가했어요.');
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
  toast('템플릿을 저장했어요.');
});
$('#tplAddBtn').addEventListener('click', () => {
  resetErrors(tplForm);
  tplForm.reset();
  openModal(tplModal);
  fld(tplForm, 'name').focus();
});
function deleteTemplate(id) {
  templates = templates.filter((t) => t.id !== id);
  persistTemplates();
  renderAll();
  toast('템플릿을 삭제했어요.');
}

// ---------- change requests (scope creep) ----------
function openChanges(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  changesFor = id;
  $('#chTitle').textContent = `변경 요청 · ${r.name}`;
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
    ? `${sum.count}건 · 추가 ${fmtWon(sum.amount)}원 · 추가 ${sum.hours}h · 조정 견적 ${fmtWon(adjustedQuote(r))}원`
    : `기준 견적 ${fmtWon(r.quotedPrice)}원 (변경 요청 없음)`;
  if (!r.changes.length) {
    list.append(emptyBlock('scope', '아직 변경 요청이 없어요. 아래에서 추가해 보세요.'));
    return;
  }
  [...r.changes].sort((a, b) => b.date.localeCompare(a.date)).forEach((c) => {
    const extra = [c.costHours ? `+${c.costHours}h` : '', c.costAmount ? `+${fmtWon(c.costAmount)}원` : ''].filter(Boolean).join(' · ');
    list.append(el('div', { class: 'ch-item' },
      el('div', { class: 'ch-main' },
        el('div', { class: 'nm', text: c.note }),
        el('div', { class: 'meta', text: `${c.date}${extra ? ' · ' + extra : ''}` })),
      el('button', { class: 'btn sm danger', type: 'button', text: '삭제', 'aria-label': `${c.note} 삭제`,
        onclick: () => askConfirm('변경 요청 삭제', `"${c.note}" 항목을 삭제할까요?`, '삭제', () => deleteChange(c.id)) })));
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
  toast('변경 요청을 삭제했어요.');
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
  toast('변경 요청을 추가했어요.');
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
  toast('기록을 삭제했어요.');
}
function demoData() {
  const d = (n) => {
    const t = new Date(Date.now() - n * 86400000);
    return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const mk =(i, name, client, category, quotedPrice, estimatedHours, actualHours, ago) =>
    ({ id: 'demo' + i, demo: true, name: `[예시] ${name}`, client, category, quotedPrice, estimatedHours, actualHours, date: d(ago), changes: [] });
  const list = [
    mk(1, '브랜드 로고 리뉴얼', 'A사', '디자인', 1200000, 20, 23, 150),
    mk(2, '쇼핑몰 프론트엔드', 'B몰', '개발', 3500000, 60, 88, 110),
    mk(3, '유튜브 편집 패키지', 'C채널', '영상', 900000, 16, 15, 80),
    mk(4, '회원 API 연동', 'B몰', '개발', 2400000, 40, 58, 50),
    mk(5, '블로그 원고 10편', '', '글쓰기', 600000, 12, 13, 25),
    mk(6, '랜딩 페이지 제작', 'A사', '개발', 1800000, 30, null, 5),
  ];
  list[1].changes = [{ id: 'democh1', note: '결제 모듈 추가', date: d(100), costHours: 8, costAmount: 400000 }];
  list[0].changes = [{ id: 'democh2', note: '시안 2개 추가', date: d(140), costHours: 2, costAmount: 150000 }];
  return list;
}
function loadDemo() {
  records = [...records.filter((r) => !r.demo), ...demoData()];
  persistRecords();
  renderAll();
  toast('예시 데이터 6건을 불러왔어요.');
}

// ---------- CSV / backup / summary ----------
function exportCSV() {
  if (!records.length) { toast('내보낼 기록이 없어요.'); return; }
  downloadFile(`estimate-check-${localToday()}.csv`, BOM + toCSV(records), 'text/csv;charset=utf-8');
  toast(`${records.length}건을 CSV로 내보냈어요.`);
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
  const copy = { ...r, id: newId(), name: `${r.name} (복사)`.slice(0, 60), date: localToday(),
    actualHours: null, demo: false, changes: [] };
  records = [...records, copy];
  persistRecords();
  renderAll();
  toast('프로젝트를 복제했어요. 실제 시간은 나중에 입력하세요.');
}
async function importCSVFile(file) {
  let text;
  try { text = await readText(file); } catch { toast('파일을 읽지 못했어요.'); return; }
  const { records: rows, errors } = importCSV(text);
  if (!rows.length) {
    toast(errors.length ? `가져올 수 없어요. ${errors[0].line}줄: ${errors[0].message}` : '가져올 기록이 없어요.');
    return;
  }
  records = [...records, ...rows.map((r) => ({ id: newId(), changes: [], ...r }))];
  persistRecords();
  renderAll();
  const skipped = errors.length ? ` (${errors.length}줄 건너뜀 · ${errors[0].line}줄: ${errors[0].message})` : '';
  toast(`${rows.length}건을 가져왔어요${skipped}`);
}
function backupJSON() {
  const text = JSON.stringify(buildBackup({ records, templates, settings }, new Date().toISOString()), null, 2);
  downloadFile(`estimate-check-backup-${localToday()}.json`, text, 'application/json');
  toast('백업 파일을 저장했어요.');
}
async function restoreFile(file) {
  let text;
  try { text = await readText(file); } catch { toast('파일을 읽지 못했어요.'); return; }
  const res = parseBackup(text);
  if (!res.ok) { toast(res.error); return; }
  askConfirm('백업 복원',
    `기록 ${res.records.length}건과 템플릿 ${res.templates.length}건으로 현재 데이터를 바꿀까요? 현재 데이터는 사라집니다.`,
    '복원', () => {
      const seen = new Set();
      records = res.records.map((r) => {
        const id = r.id && !seen.has(r.id) ? r.id : newId();
        seen.add(id);
        const changes = r.changes.map((c) => ({ ...c, id: c.id || newId() }));
        return { ...r, id, changes };
      });
      templates = res.templates.map((t) => ({ ...t, id: t.id || newId() }));
      settings = res.settings;
      writeJSON(SET_KEY, settings);
      $('#targetInput').value = settings.monthlyTarget || '';
      persistRecords();
      persistTemplates();
      renderAll();
      toast(`복원했어요.${res.skipped ? ` (잘못된 기록 ${res.skipped}건 제외)` : ''}`);
    });
}
async function copySummary() {
  const ok = await copyText(buildSummaryText(records, localToday()));
  toast(ok ? '요약을 클립보드에 복사했어요.' : '복사하지 못했어요. 브라우저 설정을 확인해 주세요.');
}

$('#demoBtn').addEventListener('click', loadDemo);
$('#addBtn').addEventListener('click', () => openForm());
$('#copySummary').addEventListener('click', copySummary);
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
$('#clearBtn').addEventListener('click', () => askConfirm('전체 삭제',
  `기록 ${records.length}건을 모두 삭제할까요? 되돌릴 수 없습니다.`, '전체 삭제', () => {
    records = [];
    persistRecords();
    renderAll();
    toast('모든 기록을 삭제했어요.');
  }));
$('#targetInput').addEventListener('change', (e) => {
  settings = sanitizeSettings({ monthlyTarget: e.target.value });
  writeJSON(SET_KEY, settings);
  renderMonthly();
  toast(settings.monthlyTarget ? '월 목표를 저장했어요.' : '월 목표를 지웠어요.');
});

// toolbar: search, filters, sort
$('#search').addEventListener('input', (e) => { view.query = e.target.value; renderList(); });
$('#fCategory').addEventListener('change', (e) => { view.category = e.target.value; renderList(); });
$('#fClient').addEventListener('change', (e) => { view.client = e.target.value; renderList(); });
$('#sort').addEventListener('change', (e) => { view.sort = e.target.value; renderList(); });

// unit helper
$('#unitForm').addEventListener('input', renderUnit);
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
  btn.textContent = dark ? '라이트 모드' : '다크 모드';
  btn.setAttribute('aria-pressed', String(dark));
}
$('#themeBtn').addEventListener('click', () => {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  syncThemeBtn();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeBtn);

// ---------- init ----------
const savedTheme = getTheme();
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
syncThemeBtn();
for (const f of [form, tplForm]) {
  fld(f, 'category').append(...CATEGORIES.map((c) => el('option', { value: c, text: c })));
}
{
  const raw = readJSON(KEY, []);
  // Malformed saved rows are dropped instead of crashing the charts.
  records = (Array.isArray(raw) ? raw : [])
    .map((r) => sanitizeRecord(r))
    .filter(Boolean)
    .map((r) => (r.id ? r : { ...r, id: newId() }));
  const tpl = readJSON(TPL_KEY, []);
  templates = (Array.isArray(tpl) ? tpl : []).map(sanitizeTemplate).filter(Boolean)
    .map((t) => (t.id ? t : { ...t, id: newId() }));
  settings = sanitizeSettings(readJSON(SET_KEY, {}));
  $('#targetInput').value = settings.monthlyTarget || '';
}
renderAll();
renderUnit();
syncSticky();
