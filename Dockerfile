# syntax=docker/dockerfile:1

# ---- 构建阶段：安装全量依赖，编译前端与服务端 ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json vite.config.ts vitest.config.ts index.html ./
COPY src ./src
COPY web ./web
RUN npm run build

# ---- 验收阶段：带测试依赖，verify 一次性服务使用 ----
FROM build AS verify
COPY test ./test
COPY scripts ./scripts
# verify 服务入口在 compose 中指定为 npm run acceptance；
# 同时保留 vitest 单元测试能力
CMD ["npm", "run", "acceptance"]

# ---- 运行阶段：仅生产依赖 + 编译产物 ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.js"]
