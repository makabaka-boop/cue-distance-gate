# Cue 序列偏差校验

舞台监督在开演间隙核对**计划 cue 序列**与**现场触发序列**的偏差是否在容许阈值内。
序列为 32 位有符号整数数组（各 ≤ 50000 项），阈值 K 为 0–500 的整数。

## 距离定义与算法

- 元素仅按**整数相等**比较；插入、删除各计 1，**替换计 2**（等价于删除+插入）。
- 真实距离 ≤ K 时返回**精确整数**；超过 K 时只返回 `exceeded` 信号。
- 核心实现（`server/src/distance.ts`）是**对角带有界动态规划**：任何满足
  |i − j| > K 的格子距离必然大于 K，不可能出现在预算内的最优路径上，
  因此只计算 |i − j| ≤ K 的带状区域。
  - 时间 O((n + m) · K)：50000 项、K = 500 时约 5×10⁷ 次基本操作；
  - 内存 O(m)：两行滚动数组（约 400 KB），**不构造 O(nm) 矩阵**；
  - 长度差 |n − m| > K 时直接判定超限；
  - 不调用任何差异比较库。

## 服务组成

| 服务     | 说明 |
| -------- | ---- |
| `server` | Fastify API（容器内 3000 端口） |
| `web`    | React 静态页 + nginx `/api` 反向代理，宿主端口由 `WEB_PORT` 覆盖（默认 8080） |
| `verify` | 一次性验收服务：核对小规模参考值、5 万项稀疏样本、越界结论与页面联调后退出 |

## 运行（Docker Compose）

```bash
# 启动 Web 与 API（宿主端口默认 8080，可用 WEB_PORT 覆盖）
WEB_PORT=9000 docker compose up --build web

# 跑一次性验收（自动拉起依赖，退出码即验收结果）
docker compose up --build --exit-code-from verify verify
```

浏览器访问 `http://localhost:${WEB_PORT:-8080}`：左右两个 JSON 数组编辑区 +
阈值 K 输入，点击「比较」后显示精确偏差距离（在容许范围内）或超限信号，
并附长度、K 与原始响应供复核。

## API

### `POST /api/distance`

请求体（标准 JSON 基础类型，不解释文本格式）：

```json
{ "a": [101, 102, 103], "b": [101, 103], "k": 3 }
```

- `a` / `b`：32 位有符号整数数组，长度各 ≤ 50000；
- `k`：整数，0 ≤ k ≤ 500。

响应（200）：

```json
{ "status": "ok", "distance": 1, "k": 3, "lengths": { "a": 3, "b": 2 } }
{ "status": "exceeded", "k": 3, "lengths": { "a": 3, "b": 2 } }
```

错误响应（稳定错误码，4xx）：

```json
{ "error": { "code": "INVALID_ELEMENT", "message": "..." } }
```

| 状态码 | code | 含义 |
| ------ | ---- | ---- |
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 400 | `INVALID_BODY` | 顶层不是对象或字段缺失/类型不符 |
| 400 | `INVALID_ELEMENT` | 元素非 32 位有符号整数 |
| 400 | `ARRAY_TOO_LONG` | 数组超过 50000 项 |
| 400 | `INVALID_K` | K 非 0–500 整数 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体过大 |

另有 `GET /api/health` 返回 `{ "status": "ok" }`。

## 本地开发

```bash
# 服务端：类型检查 + Vitest（算法边界、随机对拍、5 万项样本、API 校验）
cd server && npm install && npm test

# 前端（开发服务器代理 /api 到 localhost:3000）
cd web && npm install && npm run dev
```
