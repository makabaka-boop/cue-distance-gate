/**
 * One-shot acceptance suite for the cue-deviation service.
 *
 * Runs against the compose network (API_URL / WEB_URL) and verifies:
 *   1. small reference cases with known exact distances,
 *   2. 50_000-item sparse-edit samples (exact value / exceeded signal),
 *   3. stable error codes for invalid JSON, non-integers and out-of-range input,
 *   4. the web page and its /api proxy integration.
 *
 * Exits 0 when every check passes, 1 otherwise.
 */

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WEB_URL = (process.env.WEB_URL ?? 'http://localhost:4173').replace(/\/$/, '');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function waitFor(name, url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`Service not ready: ${name} (${url})`);
  return false;
}

async function postDistance(base, payload) {
  const res = await fetch(`${base}/api/distance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function postRaw(base, raw) {
  const res = await fetch(`${base}/api/distance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* keep null */
  }
  return { status: res.status, body };
}

function expectExact(name, response, distance, k) {
  check(
    name,
    response.status === 200 &&
      response.body?.status === 'ok' &&
      response.body?.distance === distance &&
      response.body?.k === k,
    `got ${response.status} ${JSON.stringify(response.body)}`,
  );
}

function expectExceeded(name, response, k) {
  check(
    name,
    response.status === 200 &&
      response.body?.status === 'exceeded' &&
      response.body?.k === k &&
      !('distance' in (response.body ?? {})),
    `got ${response.status} ${JSON.stringify(response.body)}`,
  );
}

function expectError(name, response, status, code) {
  check(
    name,
    response.status === status && response.body?.error?.code === code,
    `got ${response.status} ${JSON.stringify(response.body)}`,
  );
}

// ---------------------------------------------------------------- 50k samples

function buildSparseSample() {
  // 100 deletions + 100 insertions + 50 substitutions (x2) => distance 300.
  const N = 50_000;
  const a = Array.from({ length: N }, (_, i) => i + 1);
  const del = new Set();
  for (let d = 0; d < 100; d++) del.add(499 + d * 500);
  const sub = new Map();
  for (let s = 0; s < 50; s++) sub.set(250 + s * 500, 2_000_000 + s);
  const insAfter = new Map();
  for (let t = 0; t < 100; t++) insAfter.set(374 + t * 500, 1_000_000 + t);
  const b = [];
  for (let i = 0; i < N; i++) {
    if (del.has(i)) continue;
    b.push(sub.has(i) ? sub.get(i) : a[i]);
    if (insAfter.has(i)) b.push(insAfter.get(i));
  }
  return { a, b };
}

function buildSubstitutionSample(count, seedOffset, valueBase) {
  const N = 50_000;
  const a = Array.from({ length: N }, (_, i) => i + 1);
  const b = a.slice();
  for (let s = 0; s < count; s++) b[seedOffset + s * 199] = valueBase + s;
  return { a, b };
}

// ---------------------------------------------------------------------- main

console.log(`verify: API_URL=${API_URL} WEB_URL=${WEB_URL}`);

const ready =
  (await waitFor('api', `${API_URL}/api/health`)) && (await waitFor('web', `${WEB_URL}/`));
if (!ready) process.exit(1);

console.log('\n[1] small reference cases');
const smallCases = [
  // [a, b, k, expected ('exceeded' or exact distance)]
  [[], [], 0, 0],
  [[], [1, 2, 3], 3, 3],
  [[], [1, 2, 3], 2, 'exceeded'],
  [[7, 8, 9], [], 3, 3],
  [[1, 2, 3], [1, 2, 3], 0, 0],
  [[1], [2], 2, 2],
  [[1], [2], 1, 'exceeded'],
  [[1, 2, 3], [1, 3], 1, 1],
  [[1, 3], [1, 2, 3], 1, 1],
  [[7, 7, 7], [7, 7], 1, 1],
  [[1, 2, 1, 2], [2, 1, 2, 1], 2, 2],
  [[1, 2, 3, 4, 5], [4, 5], 3, 3],
  [[1, 2, 3, 4, 5], [1, 2], 3, 3],
  [[1, 2, 3, 4, 5], [1, 2], 2, 'exceeded'],
  [[1, 2, 3], [4, 5, 6], 6, 6],
  [[1, 2, 3], [4, 5, 6], 5, 'exceeded'],
  [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], 8, 8],
  [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], 7, 'exceeded'],
  [[-2147483648, 2147483647], [-2147483648, 2147483647], 0, 0],
  [[-2147483648], [2147483647], 2, 2],
  [[10, 20, 30], [10, 20, 30, 40, 50], 2, 2],
  [[10, 20, 30], [10, 20, 30, 40, 50], 1, 'exceeded'],
];
for (const [i, [a, b, k, expected]] of smallCases.entries()) {
  const res = await postDistance(API_URL, { a, b, k });
  const name = `case #${i + 1} (|a|=${a.length}, |b|=${b.length}, k=${k})`;
  if (expected === 'exceeded') expectExceeded(name, res, k);
  else expectExact(name, res, expected, k);
}

console.log('\n[2] 50k sparse-edit samples');
{
  const { a, b } = buildSparseSample();
  expectExact('50k sparse edits, k=500 -> 300', await postDistance(API_URL, { a, b, k: 500 }), 300, 500);
  expectExact('50k sparse edits, k=300 -> 300', await postDistance(API_URL, { a, b, k: 300 }), 300, 300);
  expectExceeded('50k sparse edits, k=299 -> exceeded', await postDistance(API_URL, { a, b, k: 299 }), 299);
}
{
  const { a, b } = buildSubstitutionSample(250, 100, 3_000_000);
  expectExact('50k with 250 substitutions, k=500 -> 500', await postDistance(API_URL, { a, b, k: 500 }), 500, 500);
}
{
  const { a, b } = buildSubstitutionSample(251, 50, 4_000_000);
  expectExceeded('50k with 251 substitutions, k=500 -> exceeded', await postDistance(API_URL, { a, b, k: 500 }), 500);
}
{
  const a = Array.from({ length: 50_000 }, (_, i) => i + 1);
  const b = a.slice(0, 49_499); // length gap 501 > k
  expectExceeded('length gap 501 > k=500 -> exceeded', await postDistance(API_URL, { a, b, k: 500 }), 500);
}

console.log('\n[3] stable validation errors');
expectError('malformed JSON', await postRaw(API_URL, '{"a": [1, 2],'), 400, 'INVALID_JSON');
expectError('empty body', await postRaw(API_URL, ''), 400, 'INVALID_JSON');
expectError('non-object body', await postDistance(API_URL, [1, 2, 3]), 400, 'INVALID_BODY');
expectError('missing k', await postDistance(API_URL, { a: [1], b: [1] }), 400, 'INVALID_K');
expectError('non-integer element', await postDistance(API_URL, { a: [1.5], b: [], k: 0 }), 400, 'INVALID_ELEMENT');
expectError('string element', await postDistance(API_URL, { a: ['1'], b: [], k: 0 }), 400, 'INVALID_ELEMENT');
expectError('element above int32', await postDistance(API_URL, { a: [2147483648], b: [], k: 0 }), 400, 'INVALID_ELEMENT');
expectError('element below int32', await postDistance(API_URL, { a: [-2147483649], b: [], k: 0 }), 400, 'INVALID_ELEMENT');
expectError('k = 501', await postDistance(API_URL, { a: [], b: [], k: 501 }), 400, 'INVALID_K');
expectError('k = -1', await postDistance(API_URL, { a: [], b: [], k: -1 }), 400, 'INVALID_K');
expectError('k = 1.5', await postDistance(API_URL, { a: [], b: [], k: 1.5 }), 400, 'INVALID_K');
expectError('k as string', await postDistance(API_URL, { a: [], b: [], k: '3' }), 400, 'INVALID_K');
expectError(
  'array too long',
  await postDistance(API_URL, { a: new Array(50_001).fill(0), b: [], k: 0 }),
  400,
  'ARRAY_TOO_LONG',
);

console.log('\n[4] web page integration');
{
  const res = await fetch(`${WEB_URL}/`);
  const html = await res.text();
  check(
    'web page serves the app shell',
    res.ok && html.includes('id="root"') && html.includes('Cue'),
    `got ${res.status}`,
  );
}
{
  const res = await fetch(`${WEB_URL}/api/health`);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* keep null */
  }
  check('web proxy reaches the API', res.ok && body?.status === 'ok', `got ${res.status}`);
}
{
  const res = await postDistance(WEB_URL, { a: [1, 2, 3], b: [1, 3, 4], k: 5 });
  expectExact('distance request through the web proxy', res, 2, 5);
}

console.log(`\nverify: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
