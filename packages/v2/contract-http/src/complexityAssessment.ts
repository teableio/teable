import { z } from 'zod';

export const estimatedRangeSchema = z.object({
  status: z.enum(['estimated', 'bounded', 'unknown']),
  expected: z.number().nullable(),
  lower: z.number().nullable(),
  upper: z.number().nullable(),
});

const complexityShareSchema = z.object({
  typicalShare: z.number().nonnegative().nullable(),
  worstCaseShare: z.number().nonnegative().nullable(),
  warnings: z.array(z.string()).readonly(),
});

const complexityModeBreakdownSchema = z.object({
  mode: z.enum([
    'sameRecord',
    'linkTraversal',
    'conditionalFiltered',
    'allTargetRecords',
    'backfill',
  ]),
  pathCount: z.number().int().nonnegative(),
  scan: estimatedRangeSchema,
  dirty: estimatedRangeSchema,
  estimatedWrites: estimatedRangeSchema,
  workRows: estimatedRangeSchema,
  share: complexityShareSchema,
});

const complexityPathBreakdownSchema = z.object({
  mode: z.enum([
    'sameRecord',
    'linkTraversal',
    'conditionalFiltered',
    'allTargetRecords',
    'backfill',
  ]),
  fromFieldId: z.string().min(1),
  toFieldId: z.string().min(1),
  fromTableId: z.string().min(1),
  toTableId: z.string().min(1),
  linkFieldId: z.string().nullable(),
  level: z.number().int().nonnegative(),
  beforeImage: z.enum(['included', 'not-required', 'unknown']),
  alternativeGroup: z.string().nullable(),
  certainty: z.enum(['structural', 'possible', 'unknown']),
  scan: estimatedRangeSchema,
  dirty: estimatedRangeSchema,
  estimatedWrites: estimatedRangeSchema,
  workRows: estimatedRangeSchema,
  share: complexityShareSchema,
});

const complexityWorkloadBreakdownSchema = z.object({
  shareBasis: z.literal('path-work'),
  modes: z.array(complexityModeBreakdownSchema).readonly(),
  paths: z.array(complexityPathBreakdownSchema).readonly(),
});

/**
 * Policy projection over the profile. `level` comes from the workload envelope,
 * never from `score`; `score` is a sort-only helper and is null when a required
 * data dimension is unknown.
 */
export const complexityAssessmentSchema = z.object({
  policyVersion: z.literal('v2-complexity-policy-2'),
  level: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
  score: z.number().min(0).max(100).nullable(),
  headline: z.string().min(1),
  workload: z.object({
    status: z.enum(['estimated', 'bounded', 'unknown']),
    rows: estimatedRangeSchema,
    typicalLevel: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
    worstCaseLevel: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
    level: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
    basis: z.literal('max-scan-dirty'),
    warnings: z.array(z.string()).readonly(),
  }),
  breakdown: complexityWorkloadBreakdownSchema,
  components: z.object({
    structural: z.number().nonnegative(),
    dataWork: z.number().nonnegative().nullable(),
    risk: z.number().nonnegative(),
  }),
  reasonCodes: z.array(z.string()).readonly(),
  recommendations: z.array(z.string()).readonly(),
  confidence: z.enum(['high', 'medium', 'low']),
});
