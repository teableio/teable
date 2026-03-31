import { FieldId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  LinkChangeCollectorVisitor,
  createEmptyCollectedLinkChanges,
  mergeCollectedLinkChange,
} from './LinkChangeCollectorVisitor';

const mkFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const mkTableId = (seed: string) =>
  TableId.create(`tbl${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const mkRecordId = (seed: string) => `rec${seed.padEnd(16, '0').slice(0, 16)}`;

const createLinkField = (params: {
  fieldId?: string;
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  hasOrderColumn?: boolean;
  symmetricFieldId?: string;
  foreignTableId?: string;
}) => ({
  id: () => mkFieldId(params.fieldId ?? 'field'),
  relationship: () => ({ toString: () => params.relationship }),
  isOneWay: () => params.isOneWay ?? false,
  hasOrderColumn: () => params.hasOrderColumn ?? false,
  symmetricFieldId: () =>
    params.symmetricFieldId ? mkFieldId(params.symmetricFieldId) : undefined,
  foreignTableId: () => mkTableId(params.foreignTableId ?? 'foreign'),
});

describe('LinkChangeCollectorVisitor', () => {
  it('returns no change for non-link fields', () => {
    const visitor = LinkChangeCollectorVisitor.create({
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
      expect(visitor[method]({} as never)._unsafeUnwrap()).toEqual({ hasChange: false });
    }
  });

  it('detects add/remove/replace/reorder/none for link relationships', () => {
    const baseCtx = {
      recordId: mkRecordId('source'),
      existingLinkIds: [mkRecordId('a'), mkRecordId('b')],
    };

    const add = LinkChangeCollectorVisitor.create({
      ...baseCtx,
      newRawValue: [{ id: mkRecordId('a') }, { id: mkRecordId('b') }, { id: mkRecordId('c') }],
    }).visitLinkField(createLinkField({ relationship: 'manyMany', hasOrderColumn: true }) as never);

    const remove = LinkChangeCollectorVisitor.create({
      ...baseCtx,
      newRawValue: [{ id: mkRecordId('a') }],
    }).visitLinkField(createLinkField({ relationship: 'manyMany' }) as never);

    const replace = LinkChangeCollectorVisitor.create({
      ...baseCtx,
      newRawValue: [{ id: mkRecordId('a') }, { id: mkRecordId('c') }],
    }).visitLinkField(createLinkField({ relationship: 'manyMany' }) as never);

    const reorder = LinkChangeCollectorVisitor.create({
      ...baseCtx,
      newRawValue: [{ id: mkRecordId('b') }, { id: mkRecordId('a') }],
    }).visitLinkField(
      createLinkField({
        relationship: 'oneMany',
        isOneWay: true,
      }) as never
    );

    const none = LinkChangeCollectorVisitor.create({
      ...baseCtx,
      newRawValue: [{ id: mkRecordId('a') }, { id: mkRecordId('b') }],
    }).visitLinkField(
      createLinkField({
        relationship: 'oneOne',
      }) as never
    );

    expect(add._unsafeUnwrap()).toMatchObject({
      hasChange: true,
      linkChange: { changeType: 'add' },
    });
    expect(remove._unsafeUnwrap()).toMatchObject({
      hasChange: true,
      linkChange: { changeType: 'remove' },
    });
    expect(replace._unsafeUnwrap()).toMatchObject({
      hasChange: true,
      linkChange: { changeType: 'replace' },
    });
    expect(reorder._unsafeUnwrap()).toMatchObject({
      hasChange: true,
      linkChange: { changeType: 'reorder' },
    });
    expect(none._unsafeUnwrap()).toEqual({ hasChange: false });
  });

  it('includes symmetric metadata for two-way links and rejects invalid raw items', () => {
    const field = createLinkField({
      fieldId: 'symField',
      relationship: 'oneMany',
      isOneWay: false,
      symmetricFieldId: 'otherField',
      foreignTableId: 'foreignTable',
    });
    const result = LinkChangeCollectorVisitor.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [],
      newRawValue: [{ id: mkRecordId('foreignA') }],
    }).visitLinkField(field as never);
    const invalid = LinkChangeCollectorVisitor.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [],
      newRawValue: [{ nope: 'bad' }],
    }).visitLinkField(field as never);

    expect(result._unsafeUnwrap()).toMatchObject({
      hasChange: true,
      linkChange: {
        isOneWay: false,
        symmetricFieldId: mkFieldId('otherField'),
        symmetricTableId: mkTableId('foreignTable'),
      },
    });
    expect(invalid.isErr()).toBe(true);
  });

  it('merges collected link changes into affected foreign record groups', () => {
    const foreignTableId = mkTableId('foreign');
    const collected = createEmptyCollectedLinkChanges();
    const result = LinkChangeCollectorVisitor.create({
      recordId: mkRecordId('source'),
      existingLinkIds: [mkRecordId('old')],
      newRawValue: [{ id: mkRecordId('new') }],
    }).visitLinkField(
      createLinkField({
        fieldId: 'collector',
        relationship: 'manyMany',
        foreignTableId: 'foreign',
      }) as never
    );

    mergeCollectedLinkChange(collected, result._unsafeUnwrap(), foreignTableId);

    expect(collected.linkChanges).toHaveLength(1);
    expect(collected.relationChangeFieldIds.map((id) => id.toString())).toEqual([
      mkFieldId('collector').toString(),
    ]);
    expect(
      collected.affectedForeignRecords
        .get(foreignTableId.toString())
        ?.recordIds.map((id) => id.toString())
    ).toEqual([mkRecordId('old'), mkRecordId('new')]);
  });
});
