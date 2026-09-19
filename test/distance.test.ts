import { describe, expect, it } from 'vitest';
import {
  boundedDistance,
  MAX_K,
  MAX_LENGTH,
} from '../src/distance.js';

/**
 * 参考实现：仅用于测试的小规模动态规划。
 * 只用两行（O(m) 空间），且只在数百项规模运行；
 * 生产代码不使用、也不构造任何 O(nm) 表。
 */
function referenceIndel(a: readonly number[], b: readonly number[]): number {
  const m = b.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        // 只有插入/删除两种操作，替换自然计为 2
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

function expectWithin(
  a: readonly number[],
  b: readonly number[],
  k: number,
  expected: number,
) {
  const result = boundedDistance(a, b, k);
  expect(result).toEqual({ status: 'within', distance: expected });
}

function expectExceeded(
  a: readonly number[],
  b: readonly number[],
  k: number,
) {
  expect(boundedDistance(a, b, k)).toEqual({ status: 'exceeded' });
}

describe('boundedDistance 基础边界', () => {
  it('两个空数组距离为 0，K=0 即容许', () => {
    expectWithin([], [], 0, 0);
  });

  it('一侧为空：插入/删除数量等于非空侧长度', () => {
    expectWithin([], [1, 2, 3], 3, 3);
    expectWithin([1, 2, 3], [], 3, 3);
    expectExceeded([], [1, 2, 3], 2);
    expectExceeded([1, 2, 3], [], 2);
    expectExceeded([1], [], 0);
    expectWithin([1], [], 1, 1);
  });

  it('完全相同的数组距离为 0，K=0 通过', () => {
    expectWithin([7], [7], 0, 0);
    expectWithin([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 0, 0);
    expectWithin([], [], 0, 0);
  });

  it('替换必须计 2：单点不同 K=1 超限，K=2 精确为 2', () => {
    expectExceeded([1], [2], 1);
    expectWithin([1], [2], 2, 2);
    expectWithin([1, 2, 3], [1, 9, 3], 2, 2);
    // 两个替换点 = 4
    expectExceeded([1, 2, 3, 4], [9, 2, 3, 8], 3);
    expectWithin([1, 2, 3, 4], [9, 2, 3, 8], 4, 4);
  });

  it('重复 cue 按整数相等逐对匹配，不能跨界抵消', () => {
    // [1,1,1] vs [1,2,1]：删一个 1 插一个 2 = 2
    expectWithin([1, 1, 1], [1, 2, 1], 2, 2);
    expectExceeded([1, 1, 1], [1, 2, 1], 1);
    // 不同重复次数
    expectWithin([5, 5, 5], [5, 5], 1, 1);
    expectWithin([5, 5], [5, 5, 5, 5], 2, 2);
    expectWithin([7, 7], [8, 8], 4, 4);
  });

  it('首尾连续缺失按删除/插入计数', () => {
    // 去掉首尾各两个：共缺 4
    expectWithin([1, 2, 3, 4, 5, 6], [3, 4], 4, 4);
    expectExceeded([1, 2, 3, 4, 5, 6], [3, 4], 3);
    // 首部删 1、尾部插 1 = 2
    expectWithin([1, 2, 3], [2, 3, 4], 2, 2);
    expectExceeded([1, 2, 3], [2, 3, 4], 1);
  });

  it('长度差超过 K 立即超限（距离下限即长度差）', () => {
    expectExceeded([1], [1, 2], 0);
    expectExceeded(new Array<number>(100).fill(1), [], 99);
    expectWithin(new Array<number>(100).fill(1), [], 100, 100);
  });

  it('真实距离恰为 K 时返回精确值，K-1 时超限', () => {
    const a = [10, 20, 30, 40, 50];
    const b = [10, 99, 30, 40]; // 替换 + 删除 = 3
    expectWithin(a, b, 3, 3);
    expectExceeded(a, b, 2);
  });

  it('32 位有符号整数边界值按相等比较', () => {
    expectWithin([-2147483648, 2147483647], [-2147483648, 2147483647], 0, 0);
    expectWithin([-2147483648], [2147483647], 2, 2);
    expectExceeded([-2147483648], [2147483647], 1);
    expectWithin([0, -0], [0, 0], 0, 0);
  });
});

describe('boundedDistance 与参考 DP 的小规模随机核对', () => {
  // 简单确定性 LCG，保证测试可复现
  function createRng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  const cases: Array<{ a: number[]; b: number[]; name: string }> = [];
  const rng = createRng(20260919);

  for (let round = 0; round < 200; round++) {
    const n = Math.floor(rng() * 30);
    const m = Math.floor(rng() * 30);
    // 小字母表制造大量相等元素，偶尔塞入 int32 极端值
    const alphabet = [0, 1, 2, 3, -1, -2147483648, 2147483647];
    const a = Array.from({ length: n }, () =>
      alphabet[Math.floor(rng() * alphabet.length)],
    );
    const b = Array.from({ length: m }, () =>
      alphabet[Math.floor(rng() * alphabet.length)],
    );
    cases.push({ a, b, name: `round ${round} (n=${n}, m=${m})` });
  }

  for (const { a, b, name } of cases) {
    it(name, () => {
      const trueDistance = referenceIndel(a, b);
      for (let k = 0; k <= trueDistance + 2 && k <= MAX_K; k++) {
        const result = boundedDistance(a, b, k);
        if (trueDistance <= k) {
          expect(result).toEqual({
            status: 'within',
            distance: trueDistance,
          });
        } else {
          expect(result).toEqual({ status: 'exceeded' });
        }
      }
    });
  }
});

describe('boundedDistance 五万项性能与稀疏改动', () => {
  it('五万项完全一致，K=0 立即返回 0', () => {
    const a = Array.from({ length: MAX_LENGTH }, (_, i) => i % 9973);
    const start = Date.now();
    expectWithin(a, a, 0, 0);
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it('稀疏删除 500 项：距离恰为 500，499 超限', () => {
    const a = Array.from({ length: MAX_LENGTH }, (_, i) => i);
    const b = a.filter((_, i) => i % 100 !== 0); // 删掉 500 项
    expect(b).toHaveLength(MAX_LENGTH - 500);

    const start = Date.now();
    expectWithin(a, b, MAX_K, 500);
    expectExceeded(a, b, MAX_K - 1);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('稀疏替换 250 处（每处计 2）：距离恰为 500', () => {
    const a = Array.from({ length: MAX_LENGTH }, (_, i) => i);
    const b = a.slice();
    for (let p = 0; p < 250; p++) {
      const idx = p * 200 + 50;
      b[idx] = -idx - 1;
    }

    const start = Date.now();
    expectWithin(a, b, MAX_K, 500);
    expectExceeded(a, b, 499);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('长度差 501 超过 K：五万项规模直接超限且极快', () => {
    const a = Array.from({ length: MAX_LENGTH }, (_, i) => i);
    const b = a.slice(0, MAX_LENGTH - 501);
    const start = Date.now();
    expectExceeded(a, b, MAX_K);
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it('五万项无公共子序列：距离远超 K，必须在 O((n+m)K) 内收敛超限', () => {
    // a 全偶数、b 全奇数，LCS=0，真实距离 100000，应在 d=500 处停止
    const a = Array.from({ length: MAX_LENGTH }, (_, i) => 2 * i);
    const b = Array.from({ length: MAX_LENGTH }, (_, i) => 2 * i + 1);
    const start = Date.now();
    expectExceeded(a, b, MAX_K);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
  });

  it('块反转造成 O((n+m)K) 最坏蛇行场景，仍需在时限内超限', () => {
    // a: 25000 个 1 后接 25000 个 2；b 顺序相反。
    // LCS=25000，真实距离 50000，而每条对角线蛇行很长，
    // 是 Myers 搜索的最坏形态；不得退化到全量矩阵耗时。
    const a = [
      ...new Array<number>(25_000).fill(1),
      ...new Array<number>(25_000).fill(2),
    ];
    const b = [
      ...new Array<number>(25_000).fill(2),
      ...new Array<number>(25_000).fill(1),
    ];
    const start = Date.now();
    expectExceeded(a, b, MAX_K);
    expect(Date.now() - start).toBeLessThan(15_000);
  });

  it('K=0 下五万项仅一处不同即超限', () => {
    const a = Array.from({ length: MAX_LENGTH }, (_, i) => i);
    const b = a.slice();
    b[49_999] = -1;
    const start = Date.now();
    expectExceeded(a, b, 0);
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
