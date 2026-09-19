import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('POST /api/distance', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(body: unknown, raw = false) {
    return app.inject({
      method: 'POST',
      url: '/api/distance',
      payload: (raw ? body : JSON.stringify(body)) as string,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('返回精确距离：替换计 2', async () => {
    const res = await post({ a: [1, 2, 3], b: [1, 9, 3], k: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'within', distance: 2, k: 2 });
  });

  it('超过 K 仅返回 exceeded，不带距离', async () => {
    const res = await post({ a: [1, 2, 3], b: [1, 9, 3], k: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'exceeded',
      k: 1,
      lengths: { a: 3, b: 3 },
    });
    expect(res.json()).not.toHaveProperty('distance');
  });

  it('空数组对返回距离 0', async () => {
    const res = await post({ a: [], b: [], k: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'within', distance: 0 });
  });

  it('一侧空数组且长度差超过 K', async () => {
    const res = await post({ a: [1, 2], b: [], k: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'exceeded' });
  });

  it('接受 int32 边界整数', async () => {
    const res = await post({
      a: [-2147483648, 2147483647],
      b: [-2147483648, 2147483647],
      k: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'within', distance: 0 });
  });

  it('非法 JSON 返回稳定 INVALID_JSON 错误', async () => {
    const res = await post('{"a": [1, 2], broken', true);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: 'error',
      error: {
        code: 'INVALID_JSON',
        message: '请求体不是合法 JSON',
      },
    });
  });

  it('请求体不是对象', async () => {
    const res = await post([1, 2, 3]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_BODY');
  });

  it('缺少字段报告 MISSING_FIELD 与字段名', async () => {
    const res = await post({ a: [1], b: [1] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'MISSING_FIELD',
      details: { field: 'k' },
    });
  });

  it('数组字段不是数组', async () => {
    const res = await post({ a: '1,2,3', b: [], k: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'NOT_ARRAY',
      details: { field: 'a' },
    });
  });

  it('元素不是整数（字符串 / 小数 / null / 越界整数）', async () => {
    for (const bad of ['1', 1.5, null, true, 2147483648, -2147483649, 1e30]) {
      const res = await post({ a: [1, bad as unknown], b: [], k: 5 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('ELEMENT_NOT_INT32');
    }
  });

  it('元素必须是 int32：错误响应带定位索引', async () => {
    const res = await post({ a: [1, 2, 3.5], b: [1], k: 2 });
    expect(res.json().error.details).toMatchObject({ field: 'a', index: 2 });
  });

  it('数组长度超限（>50000）被拒绝', async () => {
    const long = new Array<number>(50_001).fill(0);
    const res = await post({ a: long, b: [], k: 500 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ARRAY_TOO_LONG');
  });

  it('50000 项整好允许', async () => {
    const exact = new Array<number>(50_000).fill(0);
    const res = await post({ a: exact, b: exact, k: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'within', distance: 0 });
  });

  it('K 非整数 / 越界 / 类型错误', async () => {
    for (const bad of [1.5, '0', null, -1, 501, true, []]) {
      const res = await post({ a: [], b: [], k: bad as unknown });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(['K_NOT_INTEGER', 'K_OUT_OF_RANGE']).toContain(
        body.error.code,
      );
    }
  });

  it('K=500 允许，K=501 拒绝', async () => {
    expect((await post({ a: [], b: [], k: 500 })).statusCode).toBe(200);
    const res = await post({ a: [], b: [], k: 501 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('K_OUT_OF_RANGE');
  });

  it('不接受文本格式（字符串数组），仅按 JSON 基础类型处理', async () => {
    const res = await post({ a: ['LQ', 'GO'], b: ['LQ'], k: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ELEMENT_NOT_INT32');
  });

  it('GET /api/health 存活探针', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('未知 /api 路由返回稳定 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
