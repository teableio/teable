import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cron from 'node-cron';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createMailer } from './mail.js';
import { buildServer } from './server.js';
import { createTeableClient } from './teable.js';

const main = async (): Promise<void> => {
  // Dev convenience: load a local `.env` when present (production supplies real
  // environment variables; the file is git-ignored and optional).
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const config = loadConfig();
  const logger = createLogger(config.env.SSA_LOG_LEVEL, 'ssa-notify');
  const mailer = createMailer(config.env, logger);
  const teable = createTeableClient(config.env, logger);

  logger.info('starting', {
    port: config.env.SSA_PORT,
    rules: config.rules.length,
    digestSections: config.digest.sections.length,
    digestCron: config.env.SSA_DIGEST_CRON,
    digestTz: config.env.SSA_DIGEST_TZ,
    mailConfigured: mailer.isConfigured(),
    dryRun: config.env.SSA_DRY_RUN,
  });

  if (!config.env.SSA_EVENTS_WEBHOOK_SECRET) {
    logger.warn('SSA_EVENTS_WEBHOOK_SECRET is unset — /events will reject everything');
  }
  if (!config.env.SSA_INTERNAL_TOKEN) {
    logger.warn('SSA_INTERNAL_TOKEN is unset — in-app notifications and /digest/run are disabled');
  }
  if (config.env.SSA_DIGEST_RECIPIENTS.length === 0 && config.digest.sections.length > 0) {
    logger.warn('digest sections are configured but SSA_DIGEST_RECIPIENTS is empty');
  }

  const { app, runDigestNow } = buildServer({ config, logger, teable, mailer });

  const digestTask = cron.schedule(
    config.env.SSA_DIGEST_CRON,
    () => {
      void runDigestNow('schedule').catch(() => {
        // runDigestNow already logged the failure.
      });
    },
    { timezone: config.env.SSA_DIGEST_TZ, scheduled: false }
  );

  if (config.digest.sections.length > 0) {
    digestTask.start();
    logger.info('digest scheduled', {
      cron: config.env.SSA_DIGEST_CRON,
      timezone: config.env.SSA_DIGEST_TZ,
    });
  } else {
    logger.info('digest scheduling skipped (no sections configured)');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    digestTask.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.env.SSA_PORT, host: config.env.SSA_BIND });
  logger.info(`listening on http://${config.env.SSA_BIND}:${config.env.SSA_PORT}`);
};

main().catch((error) => {
  // Boot failures must be loud and exit non-zero.
  console.error(error);
  process.exit(1);
});
