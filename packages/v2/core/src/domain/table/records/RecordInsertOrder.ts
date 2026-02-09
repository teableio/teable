import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';
import { ViewId } from '../views/ViewId';
import { RecordId } from './RecordId';

export const recordInsertOrderSchema = z.object({
  viewId: z.string(),
  anchorId: z.string(),
  position: z.enum(['before', 'after']),
});

export type IRecordInsertOrderInput = z.input<typeof recordInsertOrderSchema>;

/**
 * Value object representing the desired position of a record when inserting.
 * Used for createRecord, createRecords, and duplicateRecord operations
 * to specify where the record should be placed relative to an anchor record.
 */
export class RecordInsertOrder extends ValueObject {
  private constructor(
    private readonly _viewId: ViewId,
    private readonly _anchorId: RecordId,
    private readonly _position: 'before' | 'after'
  ) {
    super();
  }

  static create(raw: unknown): Result<RecordInsertOrder, DomainError> {
    const parsed = recordInsertOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RecordInsertOrder input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return ViewId.create(parsed.data.viewId).andThen((viewId) =>
      RecordId.create(parsed.data.anchorId).map(
        (anchorId) => new RecordInsertOrder(viewId, anchorId, parsed.data.position)
      )
    );
  }

  get viewId(): ViewId {
    return this._viewId;
  }

  get anchorId(): RecordId {
    return this._anchorId;
  }

  get position(): 'before' | 'after' {
    return this._position;
  }

  equals(other: RecordInsertOrder): boolean {
    return (
      this._viewId.equals(other._viewId) &&
      this._anchorId.equals(other._anchorId) &&
      this._position === other._position
    );
  }
}
