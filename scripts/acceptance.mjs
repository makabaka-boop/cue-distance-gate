#!/usr/bin node
/**
 * 一次性验收脚本（docker compose run --rm verify 入口）。
 *
 * 覆盖：
 *  1. 小规模参考结果（手工确定的精确距离，含替换计 2、空数组、重复 cue、
 *     首尾连续缺失、长度差超过 K）
 *  2. 五万项稀疏改动样本：数值、exceeded 结论、耗时
 *  3. 非法输入的稳定错误（非法 JSON、非整数、K 越界、超长数组）
 *  4. 页面联调：构建产物存在且引用 API，注入 Fastify 完成 HTTP 级联调
 *
 * 退出码非零即验收失败。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../dist/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'dist', 'public');

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

/** 小规模参考 DP（仅验收使用） */
function referenceIndel(a, b) {
  const m = b.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let curr = new Array(m + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : Math.min(prev[j] + 1, curr[j - 1] + 1);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

async function main() {
  console.log('== 1. 小规模参考结果 ==');
  const app = await buildApp({ staticRoot: publicDir });
  await app.ready();

  async function distance(a, b, k) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/distance',
      payload: JSON.stringify({ a, b, k }),
      headers: { 'content-type': 'application/json' },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  const referenceCases = [
    { name: '空数组对', a: [], b: [], k: 0, expect: 0 },
    { name: '单侧空，插入计数', a: [1, 2, 3], b: [], k: 3, expect: 3 },
    { name: '相同数组 K=0', a: [1, 1, 2, 3], b: [1, 1, 2, 3], k: 0, expect: 0 },
    { name: '单点替换计 2', a: [1], b: [2], k: 2, expect: 2 },
    { name: '重复 cue 替换', a: [1, 1, 1], b: [1, 2, 1], k: 2, expect: 2 },
    {
      name: '首尾连续缺失',
      a: [1, 2, 3, 4, 5, 6],
      b: [3, 4],
      k: 4,
      expect: 4,
    },
    {
      name: '首删尾插',
      a: [1, 2, 3],
      b: [2, 3, 4],
      k: 2,
      expect: 2,
    },
    {
      name: 'int32 极值相等',
      a: [-2147483648, 2147483647],
      b: [-2147483648, 2147483647],
      k: 0,
      expect: 0,
    },
  ];

  for (const c of referenceCases) {
    const { statusCode, body } = await distance(c.a, c.b, c.k);
    check(
      `${c.name}: HTTP 200 within distance=${c.expect}`,
      statusCode === 200 &&
        body.status === 'within' &&
        body.distance === c.expect,
      JSON.stringify(body),
    );
  }

  // 与参考 DP 对拍 50 组确定性随机小数组
  let seed = 4242;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  let crossOk = true;
  for (let round = 0; round < 50; round++) {
    const n = Math.floor(rng() * 40);
    const m = Math.floor(rng() * 40);
    const a = Array.from({ length: n }, () => Math.floor(rng() * 6) - 2);
    const b = Array.from({ length: m }, () => Math.floor(rng() * 6) - 2);
    const truth = referenceIndel(a, b);
    for (const k of [0, Math.max(0, truth - 1), truth, 50]) {
      const { body } = await distance(a, b, k);
      if (truth <= k) {
        if (body.status !== 'within' || body.distance !== truth) {
          crossOk = false;
          console.error(`    对拍失败 a=${a} b=${b} k=${k} truth=${truth}`);
          break;
        }
      } else if (body.status !== 'exceeded') {
        crossOk = false;
        console.error(`    对拍失败(应超限) a=${a} b=${b} k=${k}`);
        break;
      }
    }
  }
  check('50 组随机小数组与参考 DP 对拍一致', crossOk);

  console.log('== 2. exceeded 越界结论 ==');
  const exceededCases = [
    { name: '长度差超过 K', a: [1, 2, 3], b: [], k: 2 },
    { name: '替换计 2，K=1 超限', a: [1], b: [2], k: 1 },
    { name: '首删尾插 K=1', a: [1, 2, 3], b: [2, 3, 4], k: 1 },
    { name: '重复 cue K=1', a: [1, 1, 1], b: [1, 2, 1], k: 1 },
  ];
  for (const c of exceededCases) {
    const { statusCode, body } = await distance(c.a, c.b, c.k);
    check(
      `${c.name}: exceeded 且不含 distance`,
      statusCode === 200 &&
        body.status === 'exceeded' &&
        !('distance' in body),
      JSON.stringify(body),
    );
  }

  console.log('== 3. 五万项稀疏改动样本 ==');
  const N = 50_000;
  const base = Array.from({ length: N }, (_, i) => i);

  // 3a. 稀疏删除 500 项 => 距离 500
  const sparseDeleted = base.filter((_, i) => i % 100 !== 0);
  let t0 = Date.now();
  let r = await distance(base, sparseDeleted, 500);
  const deleteMs = Date.now() - t0;
  check(
    `五万项稀疏删除 500：distance=500（${deleteMs}ms）`,
    r.body.status === 'within' && r.body.distance === 500,
    JSON.stringify(r.body),
  );
  check('稀疏删除耗时 < 10s', deleteMs < 10_000, `${deleteMs}ms`);

  r = await distance(base, sparseDeleted, 499);
  check('同一组样本 K=499 判定 exceeded', r.body.status === 'exceeded');

  // 3b. 稀疏替换 250 处 => 距离 500
  const replaced = base.slice();
  for (let p = 0; p < 250; p++) replaced[p * 200 + 50] = -p - 1;
  t0 = Date.now();
  r = await distance(base, replaced, 500);
  const replaceMs = Date.now() - t0;
  check(
    `五万项稀疏替换 250 处：distance=500（${replaceMs}ms）`,
    r.body.status === 'within' && r.body.distance === 500,
    JSON.stringify(r.body),
  );
  r = await distance(base, replaced, 499);
  check('替换样本 K=499 判定 exceeded', r.body.status === 'exceeded');

  // 3c. 完全一致 K=0
  t0 = Date.now();
  r = await distance(base, base, 0);
  const sameMs = Date.now() - t0;
  check(
    `五万项完全一致：distance=0（${sameMs}ms）`,
    r.body.status === 'within' && r.body.distance === 0,
  );

  // 3d. 长度差 501：无需进入搜索
  t0 = Date.now();
  r = await distance(base, base.slice(0, N - 501), 500);
  const diffMs = Date.now() - t0;
  check(
    `五万项长度差 501：exceeded（${diffMs}ms）`,
    r.body.status === 'exceeded',
  );

  // 3e. 相距极远：真实距离 100000，搜索到 K=500 必须停止
  const evens = Array.from({ length: N }, (_, i) => 2 * i);
  const odds = Array.from({ length: N }, (_, i) => 2 * i + 1);
  t0 = Date.now();
  r = await distance(evens, odds, 500);
  const farMs = Date.now() - t0;
  check(
    `五万项无公共子序列：exceeded（${farMs}ms）`,
    r.body.status === 'exceeded',
  );
  check('无公共子序列样本耗时 < 15s', farMs < 15_000, `${farMs}ms`);

  console.log('== 4. 非法输入稳定错误 ==');
  async function raw(payload, contentType = 'application/json') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/distance',
      payload,
      headers: { 'content-type': contentType },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  let e = await raw('{not valid json');
  check('非法 JSON => 400 INVALID_JSON', e.statusCode === 400 && e.body.error?.code === 'INVALID_JSON');

  e = await raw(JSON.stringify({ a: [1.5], b: [], k: 0 }));
  check('小数元素 => 400 ELEMENT_NOT_INT32', e.statusCode === 400 && e.body.error?.code === 'ELEMENT_NOT_INT32');

  e = await raw(JSON.stringify({ a: [2147483648], b: [], k: 0 }));
  check('超出 int32 => 400 ELEMENT_NOT_INT32', e.statusCode === 400 && e.body.error?.code === 'ELEMENT_NOT_INT32');

  e = await raw(JSON.stringify({ a: ['GO'], b: [], k: 0 }));
  check('文本元素 => 400 ELEMENT_NOT_INT32', e.statusCode === 400 && e.body.error?.code === 'ELEMENT_NOT_INT32');

  e = await raw(JSON.stringify({ a: [], b: [], k: 501 }));
  check('K=501 => 400 K_OUT_OF_RANGE', e.statusCode === 400 && e.body.error?.code === 'K_OUT_OF_RANGE');

  e = await raw(JSON.stringify({ a: [], b: [], k: -1 }));
  check('K=-1 => 400 K_OUT_OF_RANGE', e.statusCode === 400 && e.body.error?.code === 'K_OUT_OF_RANGE');

  e = await raw(JSON.stringify({ a: new Array(50_001).fill(0), b: [], k: 500 }));
  check('50001 项数组 => 400 ARRAY_TOO_LONG', e.statusCode === 400 && e.body.error?.code === 'ARRAY_TOO_LONG');

  e = await raw(JSON.stringify({ b: [], k: 0 }));
  check('缺字段 => 400 MISSING_FIELD', e.statusCode === 400 && e.body.error?.code === 'MISSING_FIELD');

  console.log('== 5. 页面联调 ==');
  const indexPath = path.join(publicDir, 'index.html');
  let indexHtml = '';
  try {
    indexHtml = readFileSync(indexPath, 'utf8');
  } catch {
    check('构建产物 dist/public/index.html 存在', false, '文件缺失');
  }
  check('构建产物 dist/public/index.html 存在', indexHtml.includes('<div id="root">'));
  check('页面引用构建后的 JS 资源', /\/assets\/.*\.js/.test(indexHtml));

  // 页面静态资源经 Fastify 提供
  const assetMatch = indexHtml.match(/src="(\/assets\/[^"]+)"/);
  if (assetMatch) {
    const asset = await app.inject({ method: 'GET', url: assetMatch[1] });
    check(
      `页面 JS 资源 ${assetMatch[1]} 经服务可访问`,
      asset.statusCode === 200 && asset.rawPayload.length > 1000,
    );
  } else {
    check('页面 JS 资源经服务可访问', false, '未找到资源路径');
  }

  const rootPage = await app.inject({ method: 'GET', url: '/' });
  check('GET / 返回页面 HTML', rootPage.statusCode === 200 && rootPage.body.includes('Cue 偏差复核台'));

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  check('GET /api/health => { ok: true }', health.statusCode === 200 && health.json().ok === true);

  await app.close();

  console.log(`\n验收结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log('ACCEPTED');
  }
}

main().catch((err) => {
  console.error('验收脚本异常：', err);
  process.exit(1);
});
