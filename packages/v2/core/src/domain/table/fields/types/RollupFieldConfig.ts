import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';

const rollupFieldConfigSchema = z
  .object({
    linkFieldId: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
  })
  .strip();

export type RollupFieldConfigValue = {
  linkFieldId: string;
  foreignTableId: string;
  lookupFieldId: string;
};

export class RollupFieldConfig extends ValueObject {
  private constructor(
    private readonly linkFieldIdValue: FieldId,
    private readonly foreignTableIdValue: TableId,
    private readonly lookupFieldIdValue: FieldId
  ) {
    super();
  }

  static create(raw: unknown): Result<RollupFieldConfig, DomainError> {
    const parsed = rollupFieldConfigSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RollupFieldConfig' }));
    const data = parsed.data;

    return FieldId.create(data.linkFieldId).andThen((linkFieldId) =>
      TableId.create(data.foreignTableId).andThen((foreignTableId) =>
        FieldId.create(data.lookupFieldId).map(
          (lookupFieldId) => new RollupFieldConfig(linkFieldId, foreignTableId, lookupFieldId)
        )
      )
    );
  }

  equals(other: RollupFieldConfig): boolean {
    return (
      this.linkFieldIdValue.equals(other.linkFieldIdValue) &&
      this.foreignTableIdValue.equals(other.foreignTableIdValue) &&
      this.lookupFieldIdValue.equals(other.lookupFieldIdValue)
    );
  }

  linkFieldId(): FieldId {
    return this.linkFieldIdValue;
  }

  foreignTableId(): TableId {
    return this.foreignTableIdValue;
  }

  lookupFieldId(): FieldId {
    return this.lookupFieldIdValue;
  }

  toDto(): RollupFieldConfigValue {
    return {
      linkFieldId: this.linkFieldIdValue.toString(),
      foreignTableId: this.foreignTableIdValue.toString(),
      lookupFieldId: this.lookupFieldIdValue.toString(),
    };
  }
}
