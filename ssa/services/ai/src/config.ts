import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 'yes'
  );

export const envSchema = z.object({
  SSA_PORT: z.coerce.number().int().positive().default(4700),
  SSA_BIND: z.string().default('127.0.0.1'),
  SSA_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SSA_INTERNAL_TOKEN: z.string().default(''),
  SSA_TEABLE_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  SSA_TEABLE_API_TOKEN: z.string().default(''),
  /** OpenAI-compatible endpoint, including the `/v1` suffix. */
  SSA_AI_BASE_URL: z.string().url().default('https://opencode.ai/zen/v1'),
  SSA_AI_API_KEY: z.string().default(''),
  SSA_AI_MODEL: z.string().default('deepseek-v4.1-flash'),
  SSA_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  SSA_AI_MAX_STEPS: z.coerce.number().int().positive().max(20).default(8),
  SSA_AI_MAX_HISTORY: z.coerce.number().int().positive().max(50).default(20),
  SSA_AI_SYSTEM_PROMPT: z.string().default(''),
  SSA_AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  SSA_AI_ENABLED: booleanish.default(true),
});

export type IEnv = z.infer<typeof envSchema>;

export interface IConfig {
  env: IEnv;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): IConfig => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return { env: parsed.data };
};

/** Dev convenience: load a local `.env` when present. */
export const loadEnvFileIfPresent = (cwd = process.cwd()): void => {
  const envFile = `${cwd}/.env`;
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
};

/** Config file for the assistant service (optional). */
export const readOptionalJson = (path: string): unknown => {
  if (!existsSync(path)) {
    return undefined;
  }
  const content = readFileSync(path, 'utf8');
  return content.trim() ? JSON.parse(content) : undefined;
};
