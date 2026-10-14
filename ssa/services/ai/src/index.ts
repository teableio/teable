import { loadConfig, loadEnvFileIfPresent } from './config.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const config = loadConfig();
  const logger = createLogger(config.env.SSA_LOG_LEVEL, 'ssa-ai');

  logger.info('starting', {
    port: config.env.SSA_PORT,
    enabled: config.env.SSA_AI_ENABLED,
    model: config.env.SSA_AI_MODEL,
    endpoint: config.env.SSA_AI_BASE_URL,
    apiKeyConfigured: Boolean(config.env.SSA_AI_API_KEY),
    teable: config.env.SSA_TEABLE_BASE_URL,
    teableTokenConfigured: Boolean(config.env.SSA_TEABLE_API_TOKEN),
  });

  if (!config.env.SSA_INTERNAL_TOKEN) {
    logger.warn('SSA_INTERNAL_TOKEN is unset — /chat is disabled (fails closed)');
  }
  if (!config.env.SSA_AI_API_KEY) {
    logger.warn(
      'SSA_AI_API_KEY is unset — model calls will fail unless the endpoint is keyless (e.g. local Ollama)'
    );
  }

  const app = buildServer(config, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.env.SSA_PORT, host: config.env.SSA_BIND });
  logger.info(`listening on http://${config.env.SSA_BIND}:${config.env.SSA_PORT}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
