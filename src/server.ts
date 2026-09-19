import { buildApp } from './app.js';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`cue-deviation 服务监听于 http://${HOST}:${PORT}`);
    console.log(`cue-deviation 服务监听于 http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exitCode = 1;
  }
}

void main();
