import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, categoryBreakdown, suggestion, validateRecord, overrunPct } from '../logic.js';

const rec = (category, est, actual, price = 1000000) => ({ category, estimatedHours: est, actualHours: actual, quotedPrice: price, date: '2026-01-01', name: 'x' });

test('computeStats: empty list', () => {
  const s = computeStats([]);
  assert.equal(s.totalQuoted, 0);
  assert.equal(s.effectiveRate, null);
  assert.equal(s.hitRate, null);
  assert.equal(s.avgOverrun, null);
});
test('computeStats: non-array input', () => {
  assert.equal(computeStats(undefined).count, 0);
});
test('computeStats: in-progress records excluded from hours/rate', () => {
  const s = computeStats([rec('개발', 10, 20, 2000000), rec('개발', 10, null, 500000)]);
  assert.equal(s.totalQuoted, 2500000);
  assert.equal(s.totalActualHours, 20);
  assert.equal(s.effectiveRate, 100000);
  assert.equal(s.finishedCount, 1);
});
test('computeStats: zero actual hours treated as unfinished (no divide by zero)', () => {
  const s = computeStats([rec('개발', 10, 0)]);
  assert.equal(s.finishedCount, 0);
  assert.equal(s.effectiveRate, null);
});
test('computeStats: hit rate boundary +-10% inclusive', () => {
  const s = computeStats([rec('기타', 10, 11), rec('기타', 10, 9), rec('기타', 10, 11.1), rec('기타', 10, 8.9)]);
  assert.equal(s.hitRate, 50);
});
test('computeStats: avg overrun rounding to 1 decimal', () => {
  const s = computeStats([rec('개발', 3, 4), rec('개발', 3, 3)]); // 33.333, 0 -> 16.667
  assert.equal(s.avgOverrun, 16.7);
});
test('computeStats: negative overrun averages', () => {
  const s = computeStats([rec('영상', 10, 5), rec('영상', 10, 10)]);
  assert.equal(s.avgOverrun, -25);
});
test('overrunPct null when unfinished', () => {
  assert.equal(overrunPct(rec('개발', 10, null)), null);
  assert.equal(overrunPct(rec('개발', 10, 15)), 50);
});
test('categoryBreakdown: all 5 categories, null when empty', () => {
  const b = categoryBreakdown([rec('개발', 10, 14)]);
  assert.equal(b.length, 5);
  assert.equal(b.find((c) => c.category === '개발').avgOverrun, 40);
  assert.equal(b.find((c) => c.category === '디자인').avgOverrun, null);
});
test('suggestion: neutral with fewer than 3 finished', () => {
  const s = suggestion([rec('개발', 10, 20), rec('개발', 10, 20), rec('개발', 10, null)]);
  assert.equal(s.kind, 'neutral');
  assert.match(s.message, /2건/);
});
test('suggestion: warn with surcharge rounded to 5', () => {
  const s = suggestion([rec('개발', 100, 138), rec('개발', 100, 138), rec('개발', 100, 138)]);
  assert.equal(s.kind, 'warn');
  assert.equal(s.category, '개발');
  assert.equal(s.avgOverrun, 38);
  assert.equal(s.surcharge, 40);
  assert.match(s.message, /\+38%/);
});
test('suggestion: good when within tolerance', () => {
  const s = suggestion([rec('개발', 10, 10), rec('개발', 10, 10.5), rec('개발', 10, 9.8)]);
  assert.equal(s.kind, 'good');
  assert.equal(s.surcharge, 0);
});
test('suggestion: picks worst category with >=2 finished', () => {
  const s = suggestion([rec('디자인', 10, 12), rec('디자인', 10, 12), rec('영상', 10, 30), rec('개발', 10, 15), rec('개발', 10, 15)]);
  assert.equal(s.category, '개발');
});
const ok = { name: ' 로고 ', category: '디자인', quotedPrice: '500000', estimatedHours: '10', actualHours: '', date: '2026-02-03' };
test('validateRecord: valid with empty actual (in progress)', () => {
  const v = validateRecord(ok);
  assert.equal(v.valid, true);
  assert.equal(v.value.actualHours, null);
  assert.equal(v.value.name, '로고');
  assert.equal(v.value.quotedPrice, 500000);
});
test('validateRecord: rejects bad values', () => {
  const v = validateRecord({ name: '', category: '없음', quotedPrice: '-1', estimatedHours: '0', actualHours: 'abc', date: 'x' });
  assert.equal(v.valid, false);
  for (const k of ['name', 'category', 'quotedPrice', 'estimatedHours', 'actualHours', 'date']) assert.ok(v.errors[k], k);
  assert.equal(v.value, null);
});
test('validateRecord: actual hours 0 rejected, NaN price rejected, null input safe', () => {
  assert.ok(validateRecord({ ...ok, actualHours: '0' }).errors.actualHours);
  assert.ok(validateRecord({ ...ok, quotedPrice: '' }).errors.quotedPrice);
  assert.equal(validateRecord(null).valid, false);
});
