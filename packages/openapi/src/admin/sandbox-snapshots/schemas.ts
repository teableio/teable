import { z } from '../../zod';

export const sandboxSnapshotSchema = z.object({
  id: z.string().describe('Unique snapshot record identifier'),
  snapshotId: z.string().describe('Provider-specific snapshot/image identifier'),
  type: z.string().describe('Snapshot type (e.g. base)'),
  status: z
    .enum(['creating', 'ready', 'failed', 'deleted'])
    .describe('Current snapshot lifecycle status'),
  cliVersion: z.string().nullish().describe('CLI version the snapshot was built with'),
  sizeBytes: z.union([z.string(), z.number()]).nullish().describe('Snapshot size in bytes'),
  metadata: z.unknown().nullish().describe('Provider-specific metadata'),
  createdBy: z.string().nullish().describe('User ID who created the snapshot'),
  createdTime: z.string().describe('ISO 8601 creation timestamp'),
  expiresAt: z.string().nullish().describe('ISO 8601 expiration timestamp'),
});

export type ISandboxSnapshot = z.infer<typeof sandboxSnapshotSchema>;

export const createSnapshotVoSchema = z.object({
  id: z.string().describe('Created snapshot record identifier'),
  status: z.string().describe('Initial snapshot status'),
});

export type ICreateSnapshotVo = z.infer<typeof createSnapshotVoSchema>;

export const createSnapshotRoSchema = z.object({
  agentCli: z.object({
    type: z.string().describe('Agent CLI type identifier (e.g. "claude", "opencode")'),
    version: z.string().describe('CLI version to install'),
  }),
  systemTools: z
    .array(z.string())
    .optional()
    .default([])
    .describe('System apt packages to install (e.g. ["curl", "wget", "git"])'),
  customAptPackages: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Additional custom apt packages'),
  skillSlugs: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Skill slugs to install in the snapshot (built-in skills are always included)'),
});

export type ICreateSnapshotRo = z.infer<typeof createSnapshotRoSchema>;

export const buildStepStatusEnum = z.enum(['pending', 'running', 'done', 'failed']);

export const buildStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: buildStepStatusEnum,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});

export type IBuildStep = z.infer<typeof buildStepSchema>;

export const snapshotMetadataSchema = z.object({
  buildSteps: z.array(buildStepSchema).optional(),
  config: z
    .object({
      agentCli: z.object({ type: z.string(), package: z.string(), version: z.string() }),
      systemTools: z.array(z.string()),
      customAptPackages: z.array(z.string()),
      pipPackages: z.array(z.string()).optional().default([]),
      npmPackages: z.array(z.string()).optional().default([]),
      skillSlugs: z.array(z.string()).optional(),
    })
    .optional(),
  error: z.string().nullish(),
});

export type ISnapshotMetadata = z.infer<typeof snapshotMetadataSchema>;
