import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedDistance } from './distance.js';
import { errorPayload, validateRequest } from './validation.js';

export interface BuildAppOptions {
  /** 构建后静态资源目录（dist/public）；不存在时仅提供 API，便于测试 */
  staticRoot?: string;
}

/**
 * 构造 Fastify 应用（导出以便 Vitest / 验收脚本直接注入测试）。
 *
 * 路由：
 *  GET  /api/health    存活探针
 *  POST /api/distance  计算有界插入/删除距离
 */
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: false,
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/distance', async (request, reply) => {
    const result = validateRequest(request.body);

    if (!result.ok) {
      return reply.status(400).send({
        status: 'error',
        error: errorPayload(result),
      });
    }

    const outcome = boundedDistance(result.a, result.b, result.k);

    if (outcome.status === 'exceeded') {
      return {
        status: 'exceeded',
        k: result.k,
        lengths: { a: result.a.length, b: result.b.length },
      };
    }

    return {
      status: 'within',
      distance: outcome.distance,
      k: result.k,
      lengths: { a: result.a.length, b: result.b.length },
    };
  });

  // Fastify 默认 Content-Type 为 application/json 时解析，
  // 非法 JSON / 错误类型会抛 FST_ERR_CTP_INVALID_MEDIA_TYPE 或语法错误，
  // 统一收敛为稳定的 INVALID_JSON / INVALID_CONTENT_TYPE 响应。
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.status(400).send({
        status: 'error',
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Content-Type 必须是 application/json',
        },
      });
    }

    if (
      statusCode === 400 &&
      (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
        error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
        error.message.includes('JSON'))
    ) {
      return reply.status(400).send({
        status: 'error',
        error: {
          code: 'INVALID_JSON',
          message: '请求体不是合法 JSON',
        },
      });
    }

    return reply.status(statusCode).send({
      status: 'error',
      error: {
        code: error.code ?? 'INTERNAL',
        message: error.message,
      },
    });
  });

  // API 未知路由给出稳定 404，其余路径交给 SPA 静态资源
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({
        status: 'error',
        error: { code: 'NOT_FOUND', message: '接口不存在' },
      });
    }
    return reply.status(404).send({
      status: 'error',
      error: { code: 'NOT_FOUND', message: '资源不存在' },
    });
  });

  // 编译产物中 app.js 位于 dist/app.js，静态资源位于 dist/public
  const staticRoot =
    options.staticRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public');

  if (existsSync(staticRoot)) {
    // 注册后插件自动提供 GET /（index.html）及 /assets/* 静态资源
    await app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
    });
  }

  return app;
}
