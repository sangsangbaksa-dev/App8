import { CATEGORIES, computeStats, categoryBreakdown, suggestion, validateRecord, overrunPct, isFinished, fmtSigned } from './logic.js';

const KEY = 'estimate-check:v1';
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const won = new Intl.NumberFormat('ko-KR');
let records = [];
let editingId = null;
let lastFocus = null;

// ---------- storage ----------
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(records)); return true; } catch { return false; }
}
function getTheme() { try { return localStorage.getItem('estimate-check:theme'); } catch { return null; } }
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('estimate-check:theme', t); } catch { /* ignore */ }
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
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
function toast(msg) {
  const t = el('div', { class: 'toast', text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 2800);
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

// ---------- render ----------
function renderStats() {
  const s = computeStats(records);
  const defs = [
    ['총 견적 금액', s.totalQuoted, (n) => won.format(Math.round(n)), '원'],
    ['총 실제 시간', s.totalActualHours, (n) => (Math.round(n * 10) / 10).toString(), '시간'],
    ['실질 시급', s.effectiveRate, (n) => won.format(Math.round(n)), '원/시간'],
    ['적중률 (±10%)', s.hitRate, (n) => Math.round(n).toString(), '%'],
    ['평균 초과율', s.avgOverrun, (n) => fmtSigned(n), '%'],
  ];
  const box = $('#stats'); box.replaceChildren();
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
function renderBars() {
  const rows = categoryBreakdown(records);
  const box = $('#bars'); box.replaceChildren();
  const max = Math.max(50, ...rows.map((r) => Math.abs(r.avgOverrun ?? 0)));
  const fills = [];
  for (const r of rows) {
    const has = r.avgOverrun !== null;
    const pct = has ? Math.min(100, (Math.abs(r.avgOverrun) / max) * 100) : 0;
    const fill = el('div', { class: 'bar-fill ' + (has && r.avgOverrun < 0 ? 'neg' : 'pos') });
    fills.push([fill, pct]);
    box.append(el('div', { class: 'bar-row' },
      el('span', { text: r.category }),
      el('div', { class: 'bar-track', role: 'img', 'aria-label': `${r.category} ${has ? fmtSigned(r.avgOverrun) + '%' : '데이터 없음'}` }, fill),
      el('span', { class: 'bar-val' }, has ? fmtSigned(r.avgOverrun) + '%' : '-', el('div', { class: 'bar-sub', text: `${r.finishedCount}건` }))));
  }
  requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(([f, p]) => { f.style.width = p + '%'; })));
}
function renderTrend() {
  const box = $('#trend'); box.replaceChildren();
  const pts = [...records].filter((r) => r.estimatedHours > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) { box.append(el('div', { class: 'empty', text: '프로젝트가 2건 이상이면 추이 그래프가 표시돼요.' })); return; }
  const W = 480, H = 220, L = 38, R = 14, T = 14, B = 28;
  const maxV = Math.max(...pts.flatMap((r) => [r.estimatedHours, r.actualHours || 0])) * 1.1;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '프로젝트별 예상 시간과 실제 시간 추이' });
  for (let g = 0; g <= 4; g++) {
    const v = (maxV * g) / 4, yy = y(v);
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, stroke: 'currentColor', 'stroke-opacity': '.12' }));
    const t = svgEl('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.6' });
    t.textContent = Math.round(v); svg.append(t);
  }
  const line = (key, color, dash) => {
    const seg = pts.map((r, i) => [i, r[key]]).filter(([, v]) => v > 0);
    if (!seg.length) return;
    const p = svgEl('polyline', { points: seg.map(([i, v]) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (dash) p.setAttribute('stroke-dasharray', dash);
    svg.append(p);
    for (const [i, v] of seg) {
      const c = svgEl('circle', { cx: x(i), cy: y(v), r: '4', fill: color });
      const tt = svgEl('title'); tt.textContent = `${pts[i].name}: ${v}시간`; c.append(tt); svg.append(c);
    }
  };
  line('estimatedHours', '#18b4e8', '6 4');
  line('actualHours', '#e14eca');
  pts.forEach((r, i) => {
    if (pts.length > 8 && i % 2) return;
    const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '.6' });
    t.textContent = r.date.slice(5); svg.append(t);
  });
  box.append(svg, el('div', { class: 'legend' },
    el('span', {}, el('i', { class: 'dot', style: 'background:#18b4e8' }), '예상 시간'),
    el('span', {}, el('i', { class: 'dot', style: 'background:#e14eca' }), '실제 시간')));
}
function renderList() {
  const box = $('#list'); box.replaceChildren();
  $('#clearBtn').disabled = records.length === 0;
  if (!records.length) { box.append(el('div', { class: 'empty', text: '아직 기록이 없어요. 프로젝트를 추가하거나 예시 데이터를 불러와 보세요.' })); return; }
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach((r, i) => {
    const o = overrunPct(r);
    const badges = el('div', {}, el('span', { class: 'badge', text: r.category }));
    if (r.demo) badges.append(el('span', { class: 'badge demo', text: '예시 데이터' }));
    if (o === null) badges.append(el('span', { class: 'badge', text: '진행 중' }));
    else badges.append(el('span', { class: 'badge ' + (Math.abs(o) <= 10 ? 'good' : o > 0 ? 'warn' : 'good'), text: `${fmtSigned(Math.round(o * 10) / 10)}%` }));
    box.append(el('div', { class: 'item', style: `animation-delay:${Math.min(i, 8) * 40}ms` },
      el('div', {}, badges, el('div', { class: 'nm', text: r.name }),
        el('div', { class: 'meta', text: `${r.date} · ${won.format(r.quotedPrice)}원 · 예상 ${r.estimatedHours}h / 실제 ${isFinished(r) ? r.actualHours + 'h' : '-'}` })),
      el('div', { class: 'actions' },
        el('button', { class: 'btn sm', type: 'button', 'aria-label': `${r.name} 수정`, text: '수정', onclick: () => openForm(r.id) }),
        el('button', { class: 'btn sm danger', type: 'button', 'aria-label': `${r.name} 삭제`, text: '삭제', onclick: () => removeOne(r.id) }))));
  });
}
function renderAll() { renderStats(); renderSuggestion(); renderBars(); renderTrend(); renderList(); }

// ---------- modal / form ----------
const modal = $('#modal'), form = $('#form'), confirmM = $('#confirm');
function openModal(m) { lastFocus = document.activeElement; m.hidden = false; }
function closeModal(m) { m.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
function openForm(id = null) {
  editingId = id;
  const r = id ? records.find((x) => x.id === id) : null;
  $('#formTitle').textContent = r ? '프로젝트 수정' : '프로젝트 추가';
  form.reset();
  for (const e of form.querySelectorAll('[data-err]')) e.textContent = '';
  form.date.value = r ? r.date : new Date().toISOString().slice(0, 10);
  if (r) {
    form.name.value = r.name; form.category.value = r.category; form.quotedPrice.value = r.quotedPrice;
    form.estimatedHours.value = r.estimatedHours; form.actualHours.value = r.actualHours ?? '';
  }
  openModal(modal);
  form.name.focus();
}
for (const c of CATEGORIES) form.category.append(el('option', { value: c, text: c }));
form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = validateRecord(Object.fromEntries(new FormData(form)));
  for (const e of form.querySelectorAll('[data-err]')) e.textContent = v.errors[e.dataset.err] || '';
  if (!v.valid) { const first = Object.keys(v.errors)[0]; form[first]?.focus(); return; }
  if (editingId) {
    records = records.map((r) => (r.id === editingId ? { ...r, ...v.value } : r));
    toast('기록을 수정했어요.');
  } else {
    records.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...v.value });
    toast('프로젝트를 추가했어요.');
  }
  if (!save()) toast('저장소를 사용할 수 없어 새로고침 시 사라져요.');
  closeModal(modal); renderAll();
});
modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(modal); });
confirmM.addEventListener('click', (e) => { if (e.target.closest('[data-cclose]')) closeModal(confirmM); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!confirmM.hidden) closeModal(confirmM); else if (!modal.hidden) closeModal(modal);
});

function removeOne(id) {
  records = records.filter((r) => r.id !== id);
  save(); renderAll(); toast('기록을 삭제했어요.');
}

// ---------- demo / clear ----------
function demoData() {
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const mk = (i, name, category, quotedPrice, estimatedHours, actualHours, ago) =>
    ({ id: 'demo' + i, demo: true, name: `[예시] ${name}`, category, quotedPrice, estimatedHours, actualHours, date: d(ago) });
  return [
    mk(1, '브랜드 로고 리뉴얼', '디자인', 1200000, 20, 23, 150),
    mk(2, '쇼핑몰 프론트엔드', '개발', 3500000, 60, 88, 110),
    mk(3, '유튜브 편집 패키지', '영상', 900000, 16, 15, 80),
    mk(4, '회원 API 연동', '개발', 2400000, 40, 58, 50),
    mk(5, '블로그 원고 10편', '글쓰기', 600000, 12, 13, 25),
    mk(6, '랜딩 페이지 제작', '개발', 1800000, 30, null, 5),
  ];
}
$('#demoBtn').addEventListener('click', () => {
  records = [...records.filter((r) => !r.demo), ...demoData()];
  save(); renderAll(); toast('예시 데이터 6건을 불러왔어요.');
});
$('#clearBtn').addEventListener('click', () => openModal(confirmM));
$('#cOk').addEventListener('click', () => {
  records = []; save(); closeModal(confirmM); renderAll(); toast('모든 기록을 삭제했어요.');
});
$('#addBtn').addEventListener('click', () => openForm());
$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(cur === 'dark' ? 'light' : 'dark');
});

// ---------- init ----------
const savedTheme = getTheme();
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
records = load().filter((r) => r && typeof r === 'object' && typeof r.name === 'string');
renderAll();
