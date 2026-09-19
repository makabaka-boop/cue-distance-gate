/**
 * 有界插入/删除距离（bounded indel distance）
 *
 * 规则：
 *  - 元素仅按整数（这里是 number）严格相等比较
 *  - 插入、删除各计 1
 *  - 替换 = 删除 + 插入，计 2
 *  - 真实距离 <= K 时返回精确距离；超过 K 时返回 "exceeded"
 *
 * 实现采用 Myers《An O(ND) Difference Algorithm》的对角线路搜索：
 *  - 横轴删除 a 中元素、纵轴插入 b 中元素，相等元素沿对角线“蛇行”免费延伸
 *  - 每条对角线只保留当前最小 x，编辑次数 d 从 0 向上迭代，首次到达
 *    (n, m) 的 d 即真实 indel 距离（等价于 n + m - 2 * LCS）
 *  - d 只迭代到 K，因此时间 O((n + m) * K)，空间 O(K)
 *  - 不构造 O(nm) 矩阵，也不调用任何差异库
 */

export type BoundedDistanceResult =
  | { status: 'within'; distance: number }
  | { status: 'exceeded' };

export const MAX_LENGTH = 50_000;
export const MAX_K = 500;

/**
 * 计算受 K 限制的精确插入/删除距离。
 *
 * @param a 计划 cue 序列（调用方负责合法性校验）
 * @param b 现场触发序列
 * @param k 容许偏差上限，0 <= k <= 500
 */
export function boundedDistance(
  a: readonly number[],
  b: readonly number[],
  k: number,
): BoundedDistanceResult {
  const n = a.length;
  const m = b.length;

  // 长度差本身至少需要 |n-m| 次插入/删除，超过 K 立即判定（也覆盖空数组情形）
  if (Math.abs(n - m) > k) {
    return { status: 'exceeded' };
  }

  if (n === 0 && m === 0) {
    return { status: 'within', distance: 0 };
  }

  // V[d]：编辑次数恰为 d 时各对角线上可达的最大 x。
  // k 为偶数时 d 与 k 同奇偶才会用到端点对角线 ±k，
  // 多开两格保证 [-k, k] 全部落在数组内，无需逐处取 min/max。
  const v = new Int32Array(2 * k + 4);
  const offset = k + 2;
  const NEG = -1;
  v.fill(NEG);

  // d = 0：从 (0,0) 起沿相等元素蛇行
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[x] === b[y]) {
    x++;
    y++;
  }
  v[offset] = x;
  if (x === n && y === m) {
    return { status: 'within', distance: 0 };
  }

  for (let d = 1; d <= k; d++) {
    // d 次编辑后可达的对角线 kLine ∈ [-d, d] 且与 d 同奇偶
    for (let kLine = -d; kLine <= d; kLine += 2) {
      let nextX: number;
      if (kLine === -d) {
        // 只能从 kLine+1 向下走（插入 b 元素）
        nextX = v[offset + kLine + 1];
      } else if (kLine === d) {
        // 只能从 kLine-1 向右走（删除 a 元素）
        nextX = v[offset + kLine - 1] + 1;
      } else {
        // 取向右（删除）或向下（插入）中走得更远的一条
        const fromDown = v[offset + kLine + 1];
        const fromRight = v[offset + kLine - 1] + 1;
        nextX = fromRight >= fromDown ? fromRight : fromDown;
      }

      let nextY = nextX - kLine;

      // 蛇行：免费吞掉连续相等元素（含重复 cue）
      while (
        nextX < n &&
        nextY < m &&
        a[nextX] === b[nextY]
      ) {
        nextX++;
        nextY++;
      }

      v[offset + kLine] = nextX;

      if (nextX === n && nextY === m) {
        return { status: 'within', distance: d };
      }
    }
    // 奇偶性与 d 不同的槽属于上一轮，而本轮读取的 kLine±1
    // 全部落在上一轮写入范围 [-(d-1), d-1] 内，故无陈旧值问题。
  }

  return { status: 'exceeded' };
}
