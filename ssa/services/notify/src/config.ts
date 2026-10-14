import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { compileRules, rulesFileSchema } from './rules.js';
import type { IRule } from './rules.js';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 'yes'
  );

const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );

export const envSchema = z.object({
  SSA_PORT: z.coerce.number().int().positive().default(4600),
  SSA_BIND: z.string().default('127.0.0.1'),
  SSA_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SSA_INTERNAL_TOKEN: z.string().default(''),
  SSA_EVENTS_WEBHOOK_SECRET: z.string().default(''),
  SSA_TEABLE_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  SSA_TEABLE_API_TOKEN: z.string().default(''),
  GMAIL_USER: z.string().default(''),
  GMAIL_APP_PASSWORD: z.string().default(''),
  GMAIL_SENDER_NAME: z.string().default('SSA'),
  SSA_DIGEST_CRON: z.string().default('0 8 * * *'),
  SSA_DIGEST_TZ: z.string().default('UTC'),
  SSA_DIGEST_RECIPIENTS: commaList,
  SSA_DRY_RUN: booleanish.default(false),
  SSA_RULES_FILE: z.string().default('notify.rules.json'),
  SSA_DIGEST_FILE: z.string().default('notify.digest.json'),
});

export type IEnv = z.infer<typeof envSchema>;

export const digestSectionSchema = z.object({
  name: z.string().min(1),
  baseId: z.string().optional(),
  tableId: z.string().min(1),
  viewId: z.string().optional(),
  take: z.number().int().positive().max(100).default(10),
  /** Field names (as shown in the UI) to include; default: primary field only. */
  columns: z.array(z.string()).optional(),
  /** Per-section recipient override; default: SSA_DIGEST_RECIPIENTS. */
  recipients: z.array(z.string()).optional(),
});

export const digestFileSchema = z.object({
  subject: z.string().default('SSA daily digest — {{date}}'),
  intro: z.string().optional(),
  sections: z.array(digestSectionSchema).default([]),
});

export type IDigestSection = z.infer<typeof digestSectionSchema>;
export type IDigestConfig = z.infer<typeof digestFileSchema>;

export interface IConfig {
  env: IEnv;
  rules: IRule[];
  digest: IDigestConfig;
}

const readJsonFile = (path: string, fallback: unknown): unknown => {
  if (!existsSync(path)) {
    return fallback;
  }
  const content = readFileSync(path, 'utf8');
  if (!content.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : error}`);
  }
};

const resolveFile = (file: string, cwd: string): string =>
  isAbsolute(file) ? file : resolve(cwd, file);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): IConfig => {
  const parsedEnv = envSchema.safeParse(env);
  if (!parsedEnv.success) {
    throw new Error(`Invalid environment: ${parsedEnv.error.message}`);
  }

  const rulesRaw = readJsonFile(resolveFile(parsedEnv.data.SSA_RULES_FILE, cwd), { rules: [] });
  const digestRaw = readJsonFile(resolveFile(parsedEnv.data.SSA_DIGEST_FILE, cwd), {});
  const parsedDigest = digestFileSchema.safeParse(digestRaw ?? {});
  if (!parsedDigest.success) {
    throw new Error(`Invalid digest config: ${parsedDigest.error.message}`);
  }
  // Validate shape even when empty so typos surface early.
  rulesFileSchema.parse(rulesRaw ?? { rules: [] });

  return {
    env: parsedEnv.data,
    rules: compileRules(rulesRaw),
    digest: parsedDigest.data,
  };
};
