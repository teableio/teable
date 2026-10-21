import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';

export const getComputedOutboxTaskLineageInputSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
});

export type IGetComputedOutboxTaskLineageQueryInput = z.input<
  typeof getComputedOutboxTaskLineageInputSchema
>;

export class GetComputedOutboxTaskLineageQuery {
  private constructor(readonly taskId: string) {}

  static create(raw: unknown = {}): Result<GetComputedOutboxTaskLineageQuery, DomainError> {
    const parsed = getComputedOutboxTaskLineageInputSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid GetComputedOutboxTaskLineageQuery input' })
      );
    }
    return ok(new GetComputedOutboxTaskLineageQuery(parsed.data.taskId));
  }
}
