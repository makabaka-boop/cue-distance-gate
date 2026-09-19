# Cue 偏差复核台

舞台监督在开演间隙核对**计划 cue 序列**与**现场触发序列**的偏差：
两边均为 32 位有符号整数的 JSON 数组，给出阈值 K（0–500），
服务端在受限于 K 的前提下返回**精确插入/删除距离**，或仅返回 `exceeded`。

- 元素只按整数相等比较，**插入、删除各计 1，替换计 2**
- 数组各不超过 50000 项；真实距离 ≤ K 时返回精确整数，否则只返回 `exceeded`
- 算法：Myers O(ND) 对角线路搜索，受 K 截断，**时间 O((n+m)·K)、空间 O(K)**
- 不调用任何差异库，不构造 O(nm) 动态规划矩阵（测试目录中的参考 DP 仅用于小规模对拍）

## 目录结构

```
src/
  distance.ts    有界插入/删除距离（算法核心）
  validation.ts  JSON 基础类型 / int32 / 长度 / K 校验，稳定错误码
  app.ts         Fastify 应用工厂（/api/health、/api/distance、静态页面）
  server.ts      服务入口
web/             React 编辑区（左右 JSON 数组 + K 输入 + 结论面板）
test/            Vitest：算法边界、参考 DP 对拍、五万项性能、API 联调
scripts/
  acceptance.mjs 一次性验收脚本（小规模参考 + 五万项稀疏样本 + 页面联调）
Dockerfile       多阶段：build / verify / runtime
docker-compose.yml  web 常驻服务 + verify 一次性验收服务
```

## API

`POST /api/distance`，`Content-Type: application/json`：

```json
{ "a": [1, 2, 3], "b": [1, 3, 4], "k": 2 }
```

真实距离不大于 K：

```json
{ "status": "within", "distance": 2, "k": 2, "lengths": { "a": 3, "b": 3 } }
```

超过 K（不携带距离）：

```json
{ "status": "exceeded", "k": 1, "lengths": { "a": 3, "b": 3 } }
```

非法 JSON、非 int32 元素、数组超 50000 项、K 越界等返回 HTTP 400 与稳定错误码，
如 `INVALID_JSON` / `ELEMENT_NOT_INT32` / `ARRAY_TOO_LONG` / `K_OUT_OF_RANGE`。

## 本地开发

```bash
npm install
npm run dev:server   # Fastify  http://127.0.0.1:8080
npm run dev:web      # Vite     http://127.0.0.1:5173 （/api 代理到 8080）
npm test             # Vitest 算法边界与 API 联调
```

## 构建与运行

```bash
npm run build        # vite build -> dist/public；tsc -> dist/*.js
npm start            # node dist/server.js，页面与 API 同源
```

## Docker Compose

```bash
# 常驻服务，宿主端口由 WEB_PORT 覆盖（默认 8080）
WEB_PORT=9090 docker compose up --build web

# 一次性验收：Vitest + 五万项稀疏样本数值/越界核对 + 页面联调，结束即退出
docker compose run --rm verify
```

验收脚本输出 `ACCEPTED` 且退出码为 0 即通过。
