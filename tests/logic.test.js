import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats, categoryBreakdown, suggestion, validateRecord, overrunPct,
  accuracyLevel, breakdownBy, clientList, recordSuggestion, filterRecords, sortRecords,
  normalizeRecord, roundHoursUp, hoursToDays, withSurcharge, hourlyRate,
  toCSV, parseCSV, importCSV, NO_CLIENT,
  fmtWon, monthlyTotals, validateChange, changeSummary, adjustedQuote, scopeCreepSummary,
  validateTemplate, buildSummaryText, sanitizeRecord, sanitizeTemplate, sanitizeSettings,
  buildBackup, parseBackup,
} from '../logic.js';

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

test('accuracyLevel: boundaries and pending', () => {
  assert.equal(accuracyLevel(10), 'good');
  assert.equal(accuracyLevel(-10), 'good');
  assert.equal(accuracyLevel(10.5), 'warn');
  assert.equal(accuracyLevel(25), 'warn');
  assert.equal(accuracyLevel(-25.5), 'bad');
  assert.equal(accuracyLevel(null), 'pending');
});

test('recordSuggestion: null while in progress, tiered messages otherwise', () => {
  assert.equal(recordSuggestion(rec('개발', 10, null)), null);
  const bad = recordSuggestion(rec('개발', 10, 15));
  assert.equal(bad.level, 'bad');
  assert.match(bad.text, /가산/);
  assert.equal(recordSuggestion(rec('개발', 10, 12)).level, 'warn');
  assert.equal(recordSuggestion(rec('개발', 10, 5)).level, 'warn');
  assert.equal(recordSuggestion(rec('개발', 10, 10.5)).level, 'good');
});

test('breakdownBy: groups clients, untagged as 미지정, sorted by finished count', () => {
  const withClient = (client, est, act) => ({ ...rec('개발', est, act), client });
  const b = breakdownBy([withClient('A', 10, 15), withClient('A', 10, 5), withClient('', 10, null)], 'client');
  assert.equal(b[0].label, 'A');
  assert.equal(b[0].finishedCount, 2);
  assert.equal(b[0].totalCount, 2);
  assert.equal(b[0].avgOverrun, 0);
  const none = b.find((x) => x.label === '미지정');
  assert.equal(none.finishedCount, 0);
  assert.equal(none.avgOverrun, null);
});
test('clientList: unique non-empty sorted', () => {
  assert.deepEqual(clientList([{ client: 'B' }, { client: '' }, { client: 'A' }, { client: 'B' }]), ['A', 'B']);
});

test('filterRecords: query is case-insensitive over name and client', () => {
  const recs = [
    { name: '로고 리뉴얼', client: 'A사', category: '디자인' },
    { name: '쇼핑몰', client: '', category: '개발' },
    { name: 'API', client: 'a사 본사', category: '개발' },
  ];
  assert.equal(filterRecords(recs, { query: 'a사' }).length, 2);
  assert.equal(filterRecords(recs, { category: '개발' }).length, 2);
  assert.equal(filterRecords(recs, { client: NO_CLIENT })[0].name, '쇼핑몰');
  assert.equal(filterRecords(recs, { client: 'A사', category: '개발' }).length, 0);
  assert.equal(filterRecords(recs, {}).length, 3);
});

test('sortRecords: date, variance (unfinished last), price', () => {
  const recs = [
    { date: '2026-01-01', name: 'b', quotedPrice: 1, estimatedHours: 10, actualHours: null },
    { date: '2026-03-01', name: 'a', quotedPrice: 5, estimatedHours: 10, actualHours: 20 },
    { date: '2026-02-01', name: 'c', quotedPrice: 3, estimatedHours: 10, actualHours: 5 },
  ];
  const names = (mode) => sortRecords(recs, mode).map((r) => r.name);
  assert.deepEqual(names('date-desc'), ['a', 'c', 'b']);
  assert.deepEqual(names('date-asc'), ['b', 'c', 'a']);
  assert.deepEqual(names('variance-desc'), ['a', 'c', 'b']);
  assert.deepEqual(names('variance-asc'), ['c', 'a', 'b']);
  assert.deepEqual(names('price-desc'), ['a', 'c', 'b']);
  assert.equal(recs[0].name, 'b'); // input not mutated
});

test('normalizeRecord: adds empty client to older records', () => {
  assert.equal(normalizeRecord({ name: 'x' }).client, '');
  assert.equal(normalizeRecord({ name: 'x', client: 'A' }).client, 'A');
});

test('unit helpers: rounding up, day conversion, surcharge, hourly rate', () => {
  assert.equal(roundHoursUp(7.2, 0.5), 7.5);
  assert.equal(roundHoursUp(8, 4), 8);
  assert.equal(roundHoursUp(0, 1), null);
  assert.equal(hoursToDays(20), 2.5);
  assert.equal(withSurcharge(10, 15), 11.5);
  assert.equal(withSurcharge(0, 15), null);
  assert.equal(hourlyRate(1200000, 20), 60000);
  assert.equal(hourlyRate(1200000, 0), null);
});

const ok = { name: ' 로고 ', category: '디자인', quotedPrice: '500000', estimatedHours: '10', actualHours: '', date: '2026-02-03' };
test('validateRecord: valid with empty actual (in progress)', () => {
  const v = validateRecord(ok);
  assert.equal(v.valid, true);
  assert.equal(v.value.actualHours, null);
  assert.equal(v.value.name, '로고');
  assert.equal(v.value.quotedPrice, 500000);
  assert.equal(v.value.client, '');
});
test('validateRecord: client is trimmed and length-limited', () => {
  assert.equal(validateRecord({ ...ok, client: ' A사 ' }).value.client, 'A사');
  assert.ok(validateRecord({ ...ok, client: 'x'.repeat(41) }).errors.client);
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

test('parseCSV: BOM, CRLF, quoted commas, doubled quotes, embedded newline', () => {
  assert.deepEqual(parseCSV(String.fromCharCode(0xfeff) + 'a,b\r\n"x,1","y""z"\r\n'), [['a', 'b'], ['x,1', 'y"z']]);
  assert.deepEqual(parseCSV('"line1\nline2",2'), [['line1\nline2', '2']]);
  assert.deepEqual(parseCSV(''), []);
});

test('parseCSV: mid-field quote is literal, only a leading quote opens quoting', () => {
  assert.deepEqual(parseCSV('ab"cd,2\n"x,y",3'), [['ab"cd', '2'], ['x,y', '3']]);
});

test('toCSV + importCSV round trip keeps tricky names and null actual hours', () => {
  const src = [{ name: 'A, "B"\n줄', client: '', category: '디자인', quotedPrice: 1000, estimatedHours: 10, actualHours: null, date: '2026-01-02' }];
  const text = toCSV(src);
  assert.equal(text.split('\r\n')[0], 'name,client,category,quotedPrice,estimatedHours,actualHours,date');
  const back = importCSV(text);
  assert.equal(back.errors.length, 0);
  assert.equal(back.records[0].name, 'A, "B"\n줄');
  assert.equal(back.records[0].actualHours, null);
});

test('importCSV: missing required column fails with line 1', () => {
  const r = importCSV('name,category\nA,디자인');
  assert.equal(r.records.length, 0);
  assert.equal(r.errors[0].line, 1);
});
test('importCSV: keeps valid rows, reports invalid row with its line number', () => {
  const text = 'name,category,quotedPrice,estimatedHours,actualHours,date\n로고,디자인,500000,10,,2026-02-03\n,개발,1000,5,,2026-02-03\n';
  const r = importCSV(text);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].client, '');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 3);
});

test('fmtWon: thousands separators', () => {
  assert.equal(fmtWon(1234567), '1,234,567');
  assert.equal(fmtWon(999), '999');
  assert.equal(fmtWon(0), '0');
});

test('monthlyTotals: sums per month, fills empty months, carries target', () => {
  const rows = monthlyTotals([
    { date: '2026-01-05', quotedPrice: 100 },
    { date: '2026-01-20', quotedPrice: 20 },
    { date: '2026-03-02', quotedPrice: 50 },
  ], 70);
  assert.deepEqual(rows.map((r) => r.month), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(rows.map((r) => r.total), [120, 0, 50]);
  assert.equal(rows[1].target, 70);
  assert.deepEqual(monthlyTotals([]), []);
});

test('validateChange: note required, costs default to 0, negatives rejected', () => {
  const ok = validateChange({ note: ' 로고 추가 ', date: '2026-02-01' });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.note, '로고 추가');
  assert.equal(ok.value.costHours, 0);
  assert.equal(ok.value.costAmount, 0);
  assert.ok(validateChange({ note: '', date: '2026-02-01' }).errors.note);
  assert.ok(validateChange({ note: 'x', date: '2026-02-01', costHours: '-1' }).errors.costHours);
});

test('changeSummary and adjustedQuote', () => {
  const r = { quotedPrice: 1000000, changes: [
    { costHours: 2, costAmount: 50000 }, { costHours: 1.5, costAmount: 0 },
  ] };
  const s = changeSummary(r);
  assert.equal(s.count, 2);
  assert.equal(s.hours, 3.5);
  assert.equal(s.amount, 50000);
  assert.equal(adjustedQuote(r), 1050000);
  assert.equal(changeSummary({}).count, 0);
});

test('scopeCreepSummary: ratio over quoted total, projects sorted by amount', () => {
  const s = scopeCreepSummary([
    { id: 'a', name: 'A', quotedPrice: 1000000, changes: [{ costHours: 1, costAmount: 100000 }] },
    { id: 'b', name: 'B', quotedPrice: 1000000, changes: [] },
  ]);
  assert.equal(s.count, 1);
  assert.equal(s.amount, 100000);
  assert.equal(s.ratioPct, 5);
  assert.equal(s.projects, 1);
  assert.equal(s.perRecord[0].name, 'A');
  assert.equal(scopeCreepSummary([]).ratioPct, null);
});

test('validateTemplate: required fields and length limits', () => {
  const ok = validateTemplate({ name: '기본 블로그', category: '글쓰기', quotedPrice: '600000', estimatedHours: '12' });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.quotedPrice, 600000);
  assert.ok(validateTemplate({ name: '', category: '없음', quotedPrice: '0', estimatedHours: '' }).errors.name);
  assert.ok(validateTemplate({ name: 'x'.repeat(41), category: '개발', quotedPrice: '1', estimatedHours: '1' }).errors.name);
});

test('buildSummaryText: includes counts and scope line when changes exist', () => {
  const text = buildSummaryText([
    { id: 'a', name: 'A', category: '개발', quotedPrice: 1000000, estimatedHours: 10, actualHours: 15, date: '2026-01-01', changes: [{ costHours: 0, costAmount: 200000 }] },
    { id: 'b', name: 'B', category: '개발', quotedPrice: 1000000, estimatedHours: 10, actualHours: null, date: '2026-01-02' },
  ], '2026-02-01');
  assert.match(text, /프로젝트: 2건 \(완료 1건\)/);
  assert.match(text, /총 견적 금액: 2,000,000원/);
  assert.match(text, /범위 변경: 1건, 추가 200,000원/);
});

test('sanitizeRecord: drops invalid rows, keeps id, sanitizes changes', () => {
  assert.equal(sanitizeRecord({ name: '' }), null);
  assert.equal(sanitizeRecord(null), null);
  const r = sanitizeRecord({ id: 'r1', name: 'A', category: '개발', quotedPrice: 1000, estimatedHours: 5,
    actualHours: null, date: '2026-01-01', changes: [{ note: '', date: '2026-01-02' }, { note: 'ok', date: '2026-01-03', costAmount: 5 }] });
  assert.equal(r.id, 'r1');
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].note, 'ok');
  assert.equal(sanitizeRecord({ name: 'x', category: '개발', quotedPrice: 1, estimatedHours: 1, date: '2026-01-01' }).changes.length, 0);
});

test('sanitizeTemplate and sanitizeSettings defaults', () => {
  assert.equal(sanitizeTemplate({ name: '' }), null);
  assert.equal(sanitizeSettings({}).monthlyTarget, 0);
  assert.equal(sanitizeSettings({ monthlyTarget: '-5' }).monthlyTarget, 0);
  assert.equal(sanitizeSettings({ monthlyTarget: '1500000.4' }).monthlyTarget, 1500000);
});

test('backup: bundle round trip and plain-array (v1) import', () => {
  const rec = { id: 'r1', name: 'A', category: '개발', quotedPrice: 1000, estimatedHours: 5, actualHours: 6, date: '2026-01-01', client: 'X', changes: [] };
  const text = JSON.stringify(buildBackup({ records: [rec], templates: [{ id: 't1', name: 'T', category: '개발', quotedPrice: 5, estimatedHours: 1 }], settings: { monthlyTarget: 900000 } }, '2026-02-01'));
  const back = parseBackup(text);
  assert.equal(back.ok, true);
  assert.equal(back.records[0].id, 'r1');
  assert.equal(back.templates[0].id, 't1');
  assert.equal(back.settings.monthlyTarget, 900000);
  const old = parseBackup(JSON.stringify([rec]));
  assert.equal(old.ok, true);
  assert.equal(old.records.length, 1);
  assert.equal(old.templates.length, 0);
});

test('validateRecord: rejects impossible calendar dates', () => {
  assert.ok(validateRecord({ ...ok, date: '2026-02-30' }).errors.date);
  assert.equal(validateRecord({ ...ok, date: '2024-02-29' }).valid, true);
});

test('CSV: formula-like cells are guarded on export and restored on import', () => {
  const src = [{ name: '=HYPERLINK("x")', client: '+A', category: '개발', quotedPrice: 1000, estimatedHours: 5, actualHours: null, date: '2026-01-02' }];
  const text = toCSV(src);
  assert.match(text, /'=HYPERLINK/);
  const back = importCSV(text);
  assert.equal(back.errors.length, 0);
  assert.equal(back.records[0].name, '=HYPERLINK("x")');
  assert.equal(back.records[0].client, '+A');
});

test('parseBackup: rejects bad JSON and foreign files', () => {
  assert.equal(parseBackup('{not json').ok, false);
  assert.equal(parseBackup(JSON.stringify({ hello: 1 })).ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: 'estimate-check-backup', records: 'x' })).ok, false);
});

test('search matches canonically equivalent Korean and full-width text without changing records', () => {
  const records = [{ ...ok, name: '한글 ＡＰＰ', client: '고객' }];
  assert.equal(filterRecords(records, { query: '한글'.normalize('NFD') }).length, 1);
  assert.equal(filterRecords(records, { query: 'app' }).length, 1);
  assert.equal(records[0].name, '한글 ＡＰＰ');
});

test('CSV import rejects unclosed quoted fields, duplicate headers and extra columns', () => {
  const header = 'name,category,quotedPrice,estimatedHours,date';
  const broken = importCSV(header + '\n"프로젝트,개발,1000,2,2026-01-01');
  assert.equal(broken.records.length, 0);
  assert.match(broken.errors[0].message, /따옴표/);
  assert.equal(importCSV(header + ',name\nA,개발,1000,2,2026-01-01,B').records.length, 0);
  const excess = importCSV(header + '\nA,개발,1000,2,2026-01-01,unexpected');
  assert.equal(excess.records.length, 0);
  assert.match(excess.errors[0].message, /열 개수/);
});

test('CSV retains BOM, multiline Korean and escaped quotes in valid exports', () => {
  const record = { ...ok, name: '한글\n"프로젝트"', client: '고객,팀' };
  const parsed = importCSV('\uFEFF' + toCSV([record]));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.records[0].name, record.name);
  assert.equal(parsed.records[0].client, record.client);
});

test('backup accepts an optional UTF-8 BOM', () => {
  const back = parseBackup('\uFEFF' + JSON.stringify([ok]));
  assert.equal(back.ok, true);
  assert.equal(back.records.length, 1);
});


test('CSV rejects stray text after a closing quote without changing valid quoted fields', () => {
  assert.throws(() => parseCSV('"고객"oops,1'), SyntaxError);
  assert.throws(() => parseCSV('"고객""oops,1'), SyntaxError);
  assert.deepEqual(parseCSV('"고객"  ,"팀"\r\n"다음",2'), [['고객', '팀'], ['다음', '2']]);
});
