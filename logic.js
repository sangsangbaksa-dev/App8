// Numeric form strings are supported; JSON booleans, arrays and objects are not numbers.
const inputNumber = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;

// Pure logic for 견적 정확도 체크 (no DOM).
export const CATEGORIES = ['디자인', '개발', '영상', '글쓰기', '기타'];
export const MIN_FINISHED = 3;
export const HIT_TOLERANCE = 10; // within ±10% counts as a hit
export const WARN_LIMIT = 25; // beyond ±25% is treated as a serious miss
export const NO_CLIENT = '__none__'; // filter value meaning "no client tag"
export const UNSET_LABEL = '미지정';
export const HOURS_PER_DAY = 8;
export const SORT_MODES = ['date-desc', 'date-asc', 'variance-desc', 'variance-asc', 'price-desc'];
export const CSV_COLUMNS = ['name', 'client', 'category', 'quotedPrice', 'estimatedHours', 'actualHours', 'date'];
const CSV_REQUIRED = ['name', 'category', 'quotedPrice', 'estimatedHours', 'date'];
export const BACKUP_FORMAT = 'estimate-check-backup';
export const BACKUP_VERSION = 2;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Strict: rejects impossible dates such as 2026-02-30 (Date.parse would roll them over).
const validDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

// Formats a number as Korean won digits, e.g. 1234567 -> "1,234,567".
export function fmtWon(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function isFinished(r) {
  return !!r && Number.isFinite(r.actualHours) && r.actualHours > 0 &&
    Number.isFinite(r.estimatedHours) && r.estimatedHours > 0;
}

export function overrunPct(r) {
  if (!isFinished(r)) return null;
  return ((r.actualHours - r.estimatedHours) / r.estimatedHours) * 100;
}

// 'good' within ±10%, 'warn' within ±25%, 'bad' beyond, 'pending' when unfinished.
export function accuracyLevel(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'pending';
  const a = Math.abs(pct);
  if (a <= HIT_TOLERANCE + 1e-9) return 'good';
  if (a <= WARN_LIMIT) return 'warn';
  return 'bad';
}

export function suggestedSurcharge(avg) {
  return Math.round(avg / 5) * 5;
}

export function computeStats(records) {
  const list = Array.isArray(records) ? records : [];
  const finished = list.filter(isFinished);
  const totalQuoted = list.reduce((s, r) => s + (Number(r.quotedPrice) || 0), 0);
  const totalActualHours = round1(finished.reduce((s, r) => s + r.actualHours, 0));
  const finishedQuoted = finished.reduce((s, r) => s + (Number(r.quotedPrice) || 0), 0);
  const effectiveRate = totalActualHours > 0 ? Math.round(finishedQuoted / totalActualHours) : null;
  const overruns = finished.map(overrunPct);
  const hits = overruns.filter((o) => Math.abs(o) <= HIT_TOLERANCE + 1e-9).length;
  return {
    count: list.length,
    finishedCount: finished.length,
    totalQuoted,
    totalActualHours,
    effectiveRate,
    hitRate: finished.length ? round1((hits / finished.length) * 100) : null,
    avgOverrun: finished.length ? round1(overruns.reduce((a, b) => a + b, 0) / finished.length) : null,
  };
}

export function categoryBreakdown(records) {
  const list = Array.isArray(records) ? records : [];
  return CATEGORIES.map((category) => {
    const fin = list.filter((r) => r.category === category && isFinished(r));
    const avg = fin.length ? fin.reduce((s, r) => s + overrunPct(r), 0) / fin.length : null;
    return { category, finishedCount: fin.length, avgOverrun: avg === null ? null : round1(avg) };
  });
}

// Groups records by a string field (e.g. 'client'). Empty values become UNSET_LABEL.
export function breakdownBy(records, field) {
  const list = Array.isArray(records) ? records : [];
  const groups = new Map();
  for (const r of list) {
    const k = String(r[field] ?? '');
    if (!groups.has(k)) groups.set(k, { label: k || UNSET_LABEL, total: 0, fin: [] });
    const g = groups.get(k);
    g.total += 1;
    if (isFinished(r)) g.fin.push(r);
  }
  return [...groups.entries()].map(([key, g]) => {
    const offs = g.fin.map(overrunPct);
    const avg = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : null;
    const hits = offs.filter((o) => Math.abs(o) <= HIT_TOLERANCE + 1e-9).length;
    return {
      key,
      label: g.label,
      totalCount: g.total,
      finishedCount: g.fin.length,
      avgOverrun: avg === null ? null : round1(avg),
      hitRate: offs.length ? round1((hits / offs.length) * 100) : null,
    };
  }).sort((a, b) => b.finishedCount - a.finishedCount || a.label.localeCompare(b.label));
}

export function clientList(records) {
  const set = new Set();
  for (const r of Array.isArray(records) ? records : []) if (r && r.client) set.add(r.client);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function suggestion(records) {
  const stats = computeStats(records);
  if (stats.finishedCount < MIN_FINISHED) {
    return { kind: 'neutral', category: null, avgOverrun: null, surcharge: null,
      message: `완료된 프로젝트가 ${stats.finishedCount}건이에요. 3건 이상 쌓이면 맞춤 제안을 드릴게요.` };
  }
  const cats = categoryBreakdown(records).filter((c) => c.finishedCount >= 2);
  let pick = null;
  for (const c of cats) if (!pick || c.avgOverrun > pick.avgOverrun) pick = c;
  const category = pick ? pick.category : null;
  const avg = pick ? pick.avgOverrun : stats.avgOverrun;
  const label = category ? `${category} 카테고리는` : '전체 프로젝트는';
  // Consistently finishing far under estimate is not "accurate"; say so instead of praising the quote.
  if (avg < -HIT_TOLERANCE) {
    return { kind: 'neutral', category, avgOverrun: avg, surcharge: 0,
      message: `${label} 평균 ${fmtSigned(avg)}% — 예상보다 일찍 끝나는 편이에요. 견적 시간이 넉넉했을 수 있으니 단가나 기간 조건을 점검해 보세요.` };
  }
  if (avg <= HIT_TOLERANCE) {
    return { kind: 'good', category, avgOverrun: avg, surcharge: 0,
      message: `${label} 평균 ${fmtSigned(avg)}% — 견적이 비교적 정확해요. 지금 방식을 유지하세요.` };
  }
  const surcharge = suggestedSurcharge(avg);
  return { kind: 'warn', category, avgOverrun: avg, surcharge,
    message: `${label} 평균 ${fmtSigned(avg)}% 초과 → 다음 견적에 시간 ${surcharge}% 가산을 권장해요.` };
}

// Per-record improvement tip. Returns null while the project is still in progress.
export function recordSuggestion(r) {
  const o = overrunPct(r);
  if (o === null) return null;
  const sign = `${fmtSigned(round1(o))}%`;
  if (o > WARN_LIMIT) {
    return { level: 'bad', text: `예상보다 ${sign} 걸렸어요. 비슷한 ${r.category} 작업은 범위와 수정 횟수를 계약에 미리 정하고, 시간 ${Math.max(5, suggestedSurcharge(o))}% 가산을 검토하세요.` };
  }
  if (o > HIT_TOLERANCE) {
    return { level: 'warn', text: `예상보다 ${sign} 걸렸어요. 다음 견적에는 시간에 ${Math.max(5, suggestedSurcharge(o))}% 여유를 두면 좋아요.` };
  }
  if (o < -WARN_LIMIT) {
    return { level: 'warn', text: `예상보다 ${Math.abs(round1(o))}% 일찍 끝났어요. 견적 시간이 넉넉했을 수 있으니 단가나 기간 조건을 점검해 보세요.` };
  }
  return { level: 'good', text: `예상과 ${sign} 차이로 거의 맞아요. 지금 방식을 유지하세요.` };
}

export function fmtSigned(n) {
  const v = round1(n);
  return (v > 0 ? '+' : '') + v;
}

// opts: { query, category, client } — empty values mean "all". client === NO_CLIENT matches untagged records.
export function filterRecords(records, opts = {}) {
  const list = Array.isArray(records) ? records : [];
  const searchText = (value) => String(value ?? '').normalize('NFKC').toLowerCase();
  const q = searchText(opts.query).trim();
  const cat = opts.category || '';
  const cli = opts.client || '';
  return list.filter((r) => {
    if (cat && r.category !== cat) return false;
    if (cli === NO_CLIENT && r.client) return false;
    if (cli && cli !== NO_CLIENT && (r.client || '') !== cli) return false;
    if (q && !searchText(`${r.name} ${r.client || ''}`).includes(q)) return false;
    return true;
  });
}

// Returns a new sorted array. Unfinished records always sort last in variance modes.
export function sortRecords(records, mode = 'date-desc') {
  const list = [...(Array.isArray(records) ? records : [])];
  const byDate = (a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''));
  const nullLast = (x, y, dir) => {
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return dir * (x - y);
  };
  switch (mode) {
    case 'date-asc':
      return list.sort((a, b) => byDate(a, b) || String(a.name).localeCompare(String(b.name)));
    case 'variance-desc':
      return list.sort((a, b) => nullLast(overrunPct(a), overrunPct(b), -1));
    case 'variance-asc':
      return list.sort((a, b) => nullLast(overrunPct(a), overrunPct(b), 1));
    case 'price-desc':
      return list.sort((a, b) => (Number(b.quotedPrice) || 0) - (Number(a.quotedPrice) || 0));
    default:
      return list.sort((a, b) => byDate(b, a));
  }
}

// Adds optional fields with defaults so older saved records keep working.
export function normalizeRecord(r) {
  return {
    ...r,
    client: typeof r.client === 'string' ? r.client : '',
    changes: Array.isArray(r.changes) ? r.changes : [],
  };
}

// Monthly totals -------------------------------------------------------------
// Sums quoted price per YYYY-MM and fills empty months between the first and last one.
export function monthlyTotals(records, target = 0) {
  const list = Array.isArray(records) ? records : [];
  const map = new Map();
  for (const r of list) {
    const m = String(r.date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    map.set(m, (map.get(m) || 0) + (Number(r.quotedPrice) || 0));
  }
  const keys = [...map.keys()].sort();
  if (!keys.length) return [];
  const [sy, sm] = keys[0].split('-').map(Number);
  const [ey, em] = keys[keys.length - 1].split('-').map(Number);
  const out = [];
  let y = sy, mo = sm;
  while (y < ey || (y === ey && mo <= em)) {
    const month = `${y}-${String(mo).padStart(2, '0')}`;
    out.push({ month, total: map.get(month) || 0, target: Number(target) || 0 });
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return out;
}

// Scope creep (change requests) -----------------------------------------------
export function validateChange(input) {
  const errors = {};
  const i = input || {};
  const note = String(i.note ?? '').trim();
  if (!note) errors.note = '변경 내용을 입력하세요.';
  else if (note.length > 120) errors.note = '변경 내용은 120자 이내로 입력하세요.';
  const date = String(i.date ?? '');
  if (!validDate(date)) errors.date = '날짜를 선택하세요.';
  const blankOr = (v) => (v === '' || v === null || v === undefined);
  const hours = blankOr(i.costHours) ? 0 : inputNumber(i.costHours);
  if (!Number.isFinite(hours) || hours < 0) errors.costHours = '추가 시간은 0 이상의 숫자여야 해요.';
  const amount = blankOr(i.costAmount) ? 0 : inputNumber(i.costAmount);
  if (!Number.isFinite(amount) || amount < 0) errors.costAmount = '추가 금액은 0 이상의 숫자여야 해요.';
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, value: valid ? { note, date, costHours: hours, costAmount: amount } : null };
}

export function changeSummary(record) {
  const list = Array.isArray(record?.changes) ? record.changes : [];
  const acc = list.reduce((a, c) => ({
    count: a.count + 1,
    hours: a.hours + (Number(c.costHours) || 0),
    amount: a.amount + (Number(c.costAmount) || 0),
  }), { count: 0, hours: 0, amount: 0 });
  return { count: acc.count, hours: round1(acc.hours), amount: Math.round(acc.amount) };
}

export function adjustedQuote(record) {
  return (Number(record?.quotedPrice) || 0) + changeSummary(record).amount;
}

export function scopeCreepSummary(records) {
  const list = Array.isArray(records) ? records : [];
  let count = 0, amount = 0, hours = 0, quoted = 0;
  const perRecord = [];
  for (const r of list) {
    const s = changeSummary(r);
    count += s.count;
    amount += s.amount;
    hours += s.hours;
    quoted += Number(r.quotedPrice) || 0;
    if (s.count) perRecord.push({ id: r.id, name: r.name, ...s });
  }
  perRecord.sort((a, b) => b.amount - a.amount || b.count - a.count);
  return {
    count,
    amount,
    hours: round1(hours),
    ratioPct: quoted > 0 ? round1((amount / quoted) * 100) : null,
    projects: perRecord.length,
    perRecord,
  };
}

// Quote templates ------------------------------------------------------------
export function validateTemplate(input) {
  const errors = {};
  const i = input || {};
  const name = String(i.name ?? '').trim();
  if (!name) errors.name = '템플릿 이름을 입력하세요.';
  else if (name.length > 40) errors.name = '템플릿 이름은 40자 이내로 입력하세요.';
  const client = String(i.client ?? '').trim();
  if (client.length > 40) errors.client = '고객 태그는 40자 이내로 입력하세요.';
  if (!CATEGORIES.includes(i.category)) errors.category = '카테고리를 선택하세요.';
  const num = inputNumber;
  const price = num(i.quotedPrice);
  if (!Number.isFinite(price) || price <= 0) errors.quotedPrice = '견적 금액은 0보다 큰 숫자여야 해요.';
  const est = num(i.estimatedHours);
  if (!Number.isFinite(est) || est <= 0) errors.estimatedHours = '예상 시간은 0보다 큰 숫자여야 해요.';
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, value: valid ? { name, client, category: i.category, quotedPrice: price, estimatedHours: est } : null };
}

// Summary text ---------------------------------------------------------------
export function buildSummaryText(records, today = '') {
  const s = computeStats(records);
  const sc = scopeCreepSummary(records);
  const lines = [`[견적 정확도 요약]${today ? ' ' + today : ''}`,
    `- 프로젝트: ${s.count}건 (완료 ${s.finishedCount}건)`,
    `- 총 견적 금액: ${fmtWon(s.totalQuoted)}원`,
    `- 실질 시급: ${s.effectiveRate == null ? '-' : fmtWon(s.effectiveRate) + '원/시간'}`,
    `- 적중률 (±10%): ${s.hitRate == null ? '-' : Math.round(s.hitRate) + '%'}`,
    `- 평균 편차율: ${s.avgOverrun == null ? '-' : fmtSigned(s.avgOverrun) + '%'}`];
  if (sc.count) lines.push(`- 범위 변경: ${sc.count}건, 추가 ${fmtWon(sc.amount)}원`);
  lines.push(`- 제안: ${suggestion(records).message}`);
  return lines.join('\n');
}

// Validation --------------------------------------------------------------
export function validateRecord(input) {
  const errors = {};
  const i = input || {};
  const name = String(i.name ?? '').trim();
  if (!name) errors.name = '프로젝트 이름을 입력하세요.';
  else if (name.length > 60) errors.name = '이름은 60자 이내로 입력하세요.';
  const client = String(i.client ?? '').trim();
  if (client.length > 40) errors.client = '고객 태그는 40자 이내로 입력하세요.';
  if (!CATEGORIES.includes(i.category)) errors.category = '카테고리를 선택하세요.';
  const num = inputNumber;
  const price = num(i.quotedPrice);
  if (!Number.isFinite(price) || price <= 0) errors.quotedPrice = '견적 금액은 0보다 큰 숫자여야 해요.';
  const est = num(i.estimatedHours);
  if (!Number.isFinite(est) || est <= 0) errors.estimatedHours = '예상 시간은 0보다 큰 숫자여야 해요.';
  let actual = null;
  const rawActual = i.actualHours;
  if (!(rawActual === '' || rawActual === null || rawActual === undefined)) {
    actual = inputNumber(rawActual);
    if (!Number.isFinite(actual) || actual <= 0) errors.actualHours = '실제 시간은 0보다 큰 숫자여야 해요 (진행 중이면 비워두세요).';
  }
  const date = String(i.date ?? '');
  if (!validDate(date)) errors.date = '날짜를 선택하세요.';
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, value: valid ? { name, client, category: i.category, quotedPrice: price,
    estimatedHours: est, actualHours: actual, date } : null };
}

// Unit helpers ------------------------------------------------------------
// Rounds hours UP to a billing unit, e.g. 7.2h with 0.5h step -> 7.5h.
export function roundHoursUp(hours, step = 0.5) {
  const h = Number(hours);
  const s = Number(step);
  if (!Number.isFinite(h) || h <= 0 || !(s > 0)) return null;
  return round2(Math.ceil(h / s - 1e-9) * s);
}

export function hoursToDays(hours, dayHours = HOURS_PER_DAY) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || !(dayHours > 0)) return null;
  return round1(h / dayHours);
}

export function withSurcharge(hours, pct) {
  const h = Number(hours);
  const p = Number(pct);
  if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(p)) return null;
  return round2(h * (1 + p / 100));
}

export function hourlyRate(price, hours) {
  const p = Number(price);
  const h = Number(hours);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(h) || h <= 0) return null;
  return Math.round(p / h);
}

// Backup / restore ------------------------------------------------------------
export function sanitizeChanges(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    if (!c || typeof c !== 'object') return null;
    const v = validateChange(c);
    return v.valid ? { id: typeof c.id === 'string' ? c.id : '', ...v.value } : null;
  }).filter(Boolean);
}

// Returns a validated record (id may be '' and should be assigned by the caller) or null.
export function sanitizeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const v = validateRecord(r);
  if (!v.valid) return null;
  return normalizeRecord({
    ...v.value,
    id: typeof r.id === 'string' ? r.id : '',
    ...(r.demo ? { demo: true } : {}),
    changes: sanitizeChanges(r.changes),
  });
}

export function sanitizeTemplate(t) {
  if (!t || typeof t !== 'object') return null;
  const v = validateTemplate(t);
  if (!v.valid) return null;
  return { id: typeof t.id === 'string' ? t.id : '', ...v.value };
}

export function sanitizeSettings(s) {
  const n = inputNumber(s && s.monthlyTarget);
  return { monthlyTarget: Number.isFinite(n) && n > 0 ? Math.round(n) : 0 };
}

export function buildBackup({ records, templates, settings } = {}, exportedAt = '') {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    records: Array.isArray(records) ? records : [],
    templates: Array.isArray(templates) ? templates : [],
    settings: settings && typeof settings === 'object' ? settings : {},
  };
}

// Accepts a bundle from buildBackup or a plain record array (format v1 export).
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(String(text ?? '').replace(/^\uFEFF/, '')); } catch { return { ok: false, error: 'JSON 형식이 올바르지 않아요.' }; }
  let recs;
  let tpls = [];
  let settings = {};
  if (Array.isArray(data)) {
    recs = data;
  } else if (data && typeof data === 'object' && data.format === BACKUP_FORMAT) {
    recs = data.records;
    tpls = Array.isArray(data.templates) ? data.templates : [];
    settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  } else {
    return { ok: false, error: '이 앱에서 만든 백업 파일이 아니에요.' };
  }
  if (!Array.isArray(recs)) return { ok: false, error: '기록 목록이 없어요.' };
  const records = recs.map(sanitizeRecord).filter(Boolean);
  const templates = tpls.map(sanitizeTemplate).filter(Boolean);
  return { ok: true, records, templates, settings: sanitizeSettings(settings), skipped: recs.length - records.length };
}

// CSV ---------------------------------------------------------------------
// Cells starting with = + - @ are prefixed with ' so spreadsheets do not run them as formulas.
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(records) {
  const list = Array.isArray(records) ? records : [];
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of list) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

// RFC 4180-style parser: quoted fields, doubled quotes, CRLF/LF, optional BOM.
export function parseCSV(text) {
  const s = String(text ?? '').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    started = true;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closedQuote = true; }
      } else field += c;
    } else if (closedQuote && c !== ',' && c !== '\n' && c !== '\r') {
      if (c !== ' ' && c !== '\t') throw new SyntaxError('CSV의 닫는 따옴표 뒤에 잘못된 문자가 있어요.');
    } else if (c === '"' && field === '') {
      // Only a quote at the start of a field opens quoted mode; mid-field quotes are literal.
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = ''; closedQuote = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = ''; started = false; closedQuote = false;
    } else {
      field += c;
    }
  }
  if (quoted) throw new SyntaxError('CSV의 닫는 따옴표가 없어요.');
  if (started) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Returns { records, errors } where records are validated values (no id yet).
export function importCSV(text) {
  let rows;
  try { rows = parseCSV(text); } catch (error) {
    return { records: [], errors: [{ line: 0, message: error.message }] };
  }
  if (!rows.length) return { records: [], errors: [{ line: 0, message: '데이터가 없어요.' }] };
  const header = rows[0].map((h) => h.trim());
  if (new Set(header).size !== header.length) return { records: [], errors: [{ line: 1, message: '중복된 열 이름이 있어요.' }] };
  const missing = CSV_REQUIRED.filter((k) => !header.includes(k));
  if (missing.length) return { records: [], errors: [{ line: 1, message: `필수 열이 없어요: ${missing.join(', ')}` }] };
  const records = [];
  const errors = [];
  rows.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    if (cells.length > header.length) {
      errors.push({ line, message: '열 개수가 머리글보다 많아요. 쉼표가 들어간 값은 따옴표로 감싸 주세요.' });
      return;
    }
    const obj = {};
    header.forEach((h, j) => {
      let v = (cells[j] ?? '').trim();
      if (/^'[=+\-@]/.test(v)) v = v.slice(1); // undo the export guard
      obj[h] = v;
    });
    const v = validateRecord(obj);
    if (v.valid) records.push(v.value);
    else errors.push({ line, message: Object.values(v.errors).join(' ') });
  });
  return { records, errors };
}
