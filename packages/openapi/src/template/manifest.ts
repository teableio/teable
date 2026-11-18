import { z } from '../zod';

export enum TemplateReviewStatus {
  Review = 'review',
  Rejected = 'rejected',
  Withdrawn = 'withdrawn',
}

export enum TemplateReviewCheck {
  /** A template project: nothing in it is still the author's own (names, addresses, keys). */
  Content = 'content',
  Connectors = 'connectors',
  Privacy = 'privacy',
  Estimate = 'estimate',
  Trial = 'trial',
}

export enum TemplateCheckResult {
  Pass = 'pass',
  Warn = 'warn',
  Fail = 'fail',
}

export const templateManifestRequirementSchema = z.object({
  credentialType: z.enum(['connection', 'secret']),
  provider: z.string().nullable(),
  alias: z.string().nullable(),
  count: z.number(),
});

export type ITemplateManifestRequirement = z.infer<typeof templateManifestRequirementSchema>;

export const templateManifestProducesSchema = z.object({
  tables: z.number(),
  workflows: z.number(),
  routines: z.number(),
  apps: z.number(),
  dashboards: z.number(),
});

export type ITemplateManifestProduces = z.infer<typeof templateManifestProducesSchema>;

export const templateManifestEstimateSchema = z.object({
  runsPerMonth: z.number(),
});

export const templateManifestScheduleSchema = z.object({
  every: z.enum(['minutes', 'hours', 'days', 'weeks', 'months']),
  interval: z.number(),
  weekdays: z.array(z.string()).optional(),
  daysOfMonth: z.array(z.number()).optional(),
  /** `HH:mm` wall-clock time, when the schedule names one. */
  time: z.string().optional(),
});

export type ITemplateManifestSchedule = z.infer<typeof templateManifestScheduleSchema>;

export const templateManifestTriggerSchema = z.object({
  /** A workflow trigger type, or `schedule` / `event` for a routine. */
  type: z.string(),
  tableName: z.string().optional(),
  schedule: templateManifestScheduleSchema.optional(),
});

export const templateManifestComponentSchema = z.object({
  kind: z.enum(['table', 'workflow', 'routine', 'app']),
  name: z.string(),
  fields: z.number().optional(),
  trigger: templateManifestTriggerSchema.optional(),
});

export type ITemplateManifestComponent = z.infer<typeof templateManifestComponentSchema>;

export const templateManifestSchema = z.object({
  requires: z.array(templateManifestRequirementSchema),
  produces: templateManifestProducesSchema,
  estimate: templateManifestEstimateSchema,
  /** Each table and automation by name, with what sets the automation off. */
  components: z.array(templateManifestComponentSchema).optional(),
});

export type ITemplateManifest = z.infer<typeof templateManifestSchema>;

export const templateReviewCheckSchema = z.object({
  key: z.enum(TemplateReviewCheck),
  result: z.enum(TemplateCheckResult),
  /** Connectors: the providers this deployment cannot connect. */
  providers: z.array(z.string()).optional(),
  /** Estimate: what the submission needs a month against what the free plan allows. */
  runsPerMonth: z.number().optional(),
  freeRunsPerMonth: z.number().optional(),
  /** Content: findings still open, and findings the author marked as samples. */
  open: z.number().optional(),
  marked: z.number().optional(),
});

export type ITemplateReviewCheck = z.infer<typeof templateReviewCheckSchema>;

export const templateReviewSchema = z.object({
  snapshotBaseId: z.string(),
  /** The candidate's publish info; it points into the frozen snapshot, so it goes live with it. */
  publishInfo: z.unknown().optional(),
  changelog: z.string().optional(),
  /** The candidate's manifest, so a reviewer sees what it brings before it goes live. */
  manifest: templateManifestSchema.optional(),
  checks: z.array(templateReviewCheckSchema),
  status: z.enum(TemplateReviewStatus),
  note: z.string().nullable().optional(),
  submittedTime: z.string(),
  submittedBy: z.string(),
  reviewedTime: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
});

export type ITemplateReview = z.infer<typeof templateReviewSchema>;

export const templateHistoryEntrySchema = z.object({
  version: z.number(),
  publishedTime: z.string(),
  changelog: z.string().optional(),
});

export type ITemplateHistoryEntry = z.infer<typeof templateHistoryEntrySchema>;

export const templateHistorySchema = z.array(templateHistoryEntrySchema);

interface ITemplatePublishState {
  snapshot?: unknown;
  isPublished?: boolean | null;
  featured?: boolean | null;
  history?: unknown;
  review?: unknown;
}

/**
 * Published: the template's links open the version that went out, and it installs. Whether the
 * template centre lists it is a separate call (`isPublished`), made by a review after it went
 * out, so a template the centre does not list is still published. A draft that never went out
 * has no history; a template its author took down has no snapshot.
 */
export const isTemplateLive = (template: ITemplatePublishState | null | undefined): boolean =>
  Boolean(template?.snapshot) && (Boolean(template?.isPublished) || Boolean(template?.history));

/**
 * In the template centre, where publishing is followed by a review: an admin let it in, which
 * features it. `isPublished` alone is not enough: templates published before reviews existed
 * carry it without being shown. A history only says that versions went out, which every
 * published template has.
 */
export const isTemplateListed = (template: ITemplatePublishState | null | undefined): boolean =>
  Boolean(template?.isPublished) && Boolean(template?.featured);

/**
 * Submitted before publishing went live on submit, and still waiting: nothing of it is live, so
 * its links open the submission itself.
 */
export const isUnreleasedSubmission = (
  template: ITemplatePublishState | null | undefined
): boolean =>
  !template?.snapshot &&
  (template?.review as { status?: string } | null | undefined)?.status ===
    TemplateReviewStatus.Review;
