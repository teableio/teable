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
      existingLinkIds: [],
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
      existingLinkIds: [],
      newRawValue: [{ id: mkRecordId('foreignA') }],
    }).visitLinkField(field as never);
    const invalid = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [],
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

  it('collects exclusive constraints for two-way one-many links', () => {
    const result = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [mkRecordId('existing')],
      newRawValue: [{ id: mkRecordId('existing') }, { id: mkRecordId('newA') }],
    }).visitLinkField(
      createLinkField({
        fieldId: 'constraint',
        foreignTableId: 'foreign',
        relationship: 'oneMany',
        isOneWay: false,
        requiresExclusiveForeignRecord: true,
        hostTableName: 'public.foreign_table',
        selfKeyName: '__fk_parent',
        foreignKeyName: '__id',
      }) as never
    );

    expect(result._unsafeUnwrap()).toEqual({
      hasConstraint: true,
      constraint: {
        fieldId: mkFieldId('constraint'),
        foreignTableId: mkTableId('foreign'),
        fkHostTableName: 'public.foreign_table',
        selfKeyName: '__fk_parent',
        foreignKeyName: '__id',
        addedForeignRecordIds: [mkRecordId('newA')],
        sourceRecordId: mkRecordId('source'),
        isOneWay: false,
        usesJunctionTable: false,
      },
    });
  });

  it('marks one-way one-many exclusivity constraints as junction-backed and ignores unchanged links', () => {
    const field = createLinkField({
      relationship: 'oneMany',
      isOneWay: true,
      requiresExclusiveForeignRecord: true,
      hostTableName: 'junction_oneway',
      selfKeyName: '__fk_source',
      foreignKeyName: '__fk_foreign',
    });
    const constraint = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [],
      newRawValue: [{ id: mkRecordId('newA') }],
    }).visitLinkField(field as never);
    const noAdded = LinkExclusivityConstraintCollector.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [mkRecordId('same')],
      newRawValue: [{ id: mkRecordId('same') }],
    }).visitLinkField(field as never);

    expect(constraint._unsafeUnwrap()).toMatchObject({
      hasConstraint: true,
      constraint: {
        isOneWay: true,
        usesJunctionTable: true,
        addedForeignRecordIds: [mkRecordId('newA')],
      },
    });
    expect(noAdded._unsafeUnwrap()).toEqual({ hasConstraint: false });
  });
});
