import { FieldId, TableId } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { LinkExclusivityConstraintCollector } from './LinkExclusivityConstraintCollector';

const mkFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const mkTableId = (seed: string) =>
  TableId.create(`tbl${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const mkRecordId = (seed: string) => `rec${seed.padEnd(16, '0').slice(0, 16)}`;

const createLinkField = (params: {
  fieldId?: string;
  foreignTableId?: string;
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  requiresExclusiveForeignRecord?: boolean;
  hostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
}) => ({
  id: () => mkFieldId(params.fieldId ?? 'field'),
  foreignTableId: () => mkTableId(params.foreignTableId ?? 'foreign'),
  relationship: () => ({ toString: () => params.relationship }),
  isOneWay: () => params.isOneWay ?? false,
  requiresExclusiveForeignRecord: () => params.requiresExclusiveForeignRecord ?? false,
  fkHostTableName: () => ({
    split: () => {
      const raw = params.hostTableName ?? 'public.foreign_links';
      const [schema, tableName] = raw.includes('.') ? raw.split('.') : [undefined, raw];
      return ok({ schema, tableName });
    },
  }),
  selfKeyNameString: () => ok(params.selfKeyName ?? '__fk_self'),
  foreignKeyNameString: () => ok(params.foreignKeyName ?? '__fk_foreign'),
});

describe('LinkExclusivityConstraintCollector', () => {
  it('returns no constraint for non-link fields', () => {
    const visitor = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      newRawValue: null,
    });

    for (const method of [
      'visitSingleLineTextField',
      'visitLongTextField',
      'visitNumberField',
      'visitRatingField',
      'visitFormulaField',
      'visitRollupField',
      'visitLookupField',
      'visitSingleSelectField',
      'visitMultipleSelectField',
      'visitCheckboxField',
      'visitDateField',
      'visitAttachmentField',
      'visitUserField',
      'visitCreatedTimeField',
      'visitLastModifiedTimeField',
      'visitCreatedByField',
      'visitLastModifiedByField',
      'visitAutoNumberField',
      'visitButtonField',
      'visitConditionalRollupField',
      'visitConditionalLookupField',
    ] as const) {
      expect(visitor[method]({} as never)._unsafeUnwrap()).toEqual({ hasConstraint: false });
    }
  });

  it('skips non-exclusive links and rejects invalid raw items', () => {
    const field = createLinkField({
      relationship: 'manyMany',
      requiresExclusiveForeignRecord: false,
    });

    const none = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      newRawValue: [{ id: mkRecordId('foreignA') }],
    }).visitLinkField(field as never);
    const invalid = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      newRawValue: [{ bad: true }],
    }).visitLinkField(
      createLinkField({
        relationship: 'oneOne',
        requiresExclusiveForeignRecord: true,
      }) as never
    );

    expect(none._unsafeUnwrap()).toEqual({ hasConstraint: false });
    expect(invalid.isErr()).toBe(true);
  });
});
