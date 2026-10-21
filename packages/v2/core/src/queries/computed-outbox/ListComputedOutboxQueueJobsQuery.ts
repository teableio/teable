import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import {
  computedOutboxQueueJobCauses,
  computedOutboxQueueJobOutcomes,
  computedOutboxQueueJobSorts,
  computedOutboxQueueJobStates,
  computedOutboxQueueJobViews,
} from '../../domain/computed/outbox';
import { domainError, type DomainError } from '../../domain/shared/DomainError';

const csvParam = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  );

const boolParam = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => value === true || value === 'true' || value === '1');

export const listComputedOutboxQueueJobsInputSchema = z.object({
  states: z
    .union([
      z.array(z.enum(computedOutboxQueueJobStates)),
      csvParam.pipe(z.array(z.enum(computedOutboxQueueJobStates))),
    ])
    .optional()
    .transform((value) => value ?? []),
  spaceIds: z
    .union([z.array(z.string()), csvParam])
    .optional()
    .transform((value) => value ?? []),
  baseIds: z
    .union([z.array(z.string()), csvParam])
    .optional()
    .transform((value) => value ?? []),
  causes: z
    .union([
      z.array(z.enum(computedOutboxQueueJobCauses)),
      csvParam.pipe(z.array(z.enum(computedOutboxQueueJobCauses))),
    ])
    .optional()
    .transform((value) => value ?? []),
  outcomes: z
    .union([
      z.array(z.enum(computedOutboxQueueJobOutcomes)),
      csvParam.pipe(z.array(z.enum(computedOutboxQueueJobOutcomes))),
    ])
    .optional()
    .transform((value) => value ?? []),
  q: z.string().trim().max(200).optional(),
  minDurationMs: z.coerce.number().int().min(0).optional(),
  view: z.enum(computedOutboxQueueJobViews).optional().default('tasks'),
  includeSettled: boolParam,
  sort: z.enum(computedOutboxQueueJobSorts).optional().default('time'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type IListComputedOutboxQueueJobsQueryInput = z.input<
  typeof listComputedOutboxQueueJobsInputSchema
>;

export class ListComputedOutboxQueueJobsQuery {
  private constructor(
    readonly states: ReadonlyArray<(typeof computedOutboxQueueJobStates)[number]>,
    readonly spaceIds: ReadonlyArray<string>,
    readonly baseIds: ReadonlyArray<string>,
    readonly causes: ReadonlyArray<(typeof computedOutboxQueueJobCauses)[number]>,
    readonly outcomes: ReadonlyArray<(typeof computedOutboxQueueJobOutcomes)[number]>,
    readonly q: string | undefined,
    readonly minDurationMs: number | undefined,
    readonly view: (typeof computedOutboxQueueJobViews)[number],
    readonly includeSettled: boolean,
    readonly sort: (typeof computedOutboxQueueJobSorts)[number],
    readonly limit: number,
    readonly offset: number
  ) {}

  static create(raw: unknown = {}): Result<ListComputedOutboxQueueJobsQuery, DomainError> {
    const parsed = listComputedOutboxQueueJobsInputSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid ListComputedOutboxQueueJobsQuery input' })
      );
    }
    return ok(
      new ListComputedOutboxQueueJobsQuery(
        parsed.data.states,
        parsed.data.spaceIds,
        parsed.data.baseIds,
        parsed.data.causes,
        parsed.data.outcomes,
        parsed.data.q,
        parsed.data.minDurationMs,
        parsed.data.view,
        Boolean(parsed.data.includeSettled),
        parsed.data.sort,
        parsed.data.limit,
        parsed.data.offset
      )
    );
  }
}
