// Pure logic for 견적 정확도 체크 (no DOM).
export const CATEGORIES = ['디자인', '개발', '영상', '글쓰기', '기타'];
export const MIN_FINISHED = 3;
export const HIT_TOLERANCE = 10;

const round1 = (n) => Math.round(n * 10) / 10;

export function isFinished(r) {
  return !!r && Number.isFinite(r.actualHours) && r.actualHours > 0 &&
    Number.isFinite(r.estimatedHours) && r.estimatedHours > 0;
}

export function overrunPct(r) {
  if (!isFinished(r)) return null;
  return ((r.actualHours - r.estimatedHours) / r.estimatedHours) * 100;
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
  if (avg <= HIT_TOLERANCE) {
    return { kind: 'good', category, avgOverrun: avg, surcharge: 0,
      message: `${label} 평균 ${fmtSigned(avg)}% — 견적이 비교적 정확해요. 지금 방식을 유지하세요.` };
  }
  const surcharge = Math.round(avg / 5) * 5;
  return { kind: 'warn', category, avgOverrun: avg, surcharge,
    message: `${label} 평균 ${fmtSigned(avg)}% 초과 → 다음 견적에 시간 ${surcharge}% 가산을 권장해요.` };
}

export function fmtSigned(n) {
  const v = round1(n);
  return (v > 0 ? '+' : '') + v;
}

export function validateRecord(input) {
  const errors = {};
  const i = input || {};
  const name = String(i.name ?? '').trim();
  if (!name) errors.name = '프로젝트 이름을 입력하세요.';
  else if (name.length > 60) errors.name = '이름은 60자 이내로 입력하세요.';
  if (!CATEGORIES.includes(i.category)) errors.category = '카테고리를 선택하세요.';
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const price = num(i.quotedPrice);
  if (!Number.isFinite(price) || price <= 0) errors.quotedPrice = '견적 금액은 0보다 큰 숫자여야 해요.';
  const est = num(i.estimatedHours);
  if (!Number.isFinite(est) || est <= 0) errors.estimatedHours = '예상 시간은 0보다 큰 숫자여야 해요.';
  let actual = null;
  const rawActual = i.actualHours;
  if (!(rawActual === '' || rawActual === null || rawActual === undefined)) {
    actual = Number(rawActual);
    if (!Number.isFinite(actual) || actual <= 0) errors.actualHours = '실제 시간은 0보다 큰 숫자여야 해요 (진행 중이면 비워두세요).';
  }
  const date = String(i.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.date = '날짜를 선택하세요.';
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, value: valid ? { name, category: i.category, quotedPrice: price,
    estimatedHours: est, actualHours: actual, date } : null };
}
