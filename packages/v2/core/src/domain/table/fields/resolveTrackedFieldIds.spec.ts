import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import { FieldType } from './FieldType';
import { resolveTrackedFieldIds } from './resolveTrackedFieldIds';
import type { LastModifiedTimeField } from './types/LastModifiedTimeField';

const fieldId = (value: string) => FieldId.create(value)._unsafeUnwrap();

/**
 * A table with two editable fields and one modification-time stamp whose
 * tracking list is the parameter under test.
 */
const buildTrackedStamp = (trackedFieldIds: ReadonlyArray<string>) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Audit tracking')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(fieldId('fldtracked'))
    .withName(FieldName.create('Tracked')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withId(fieldId('flduntracked'))
    .withName(FieldName.create('Untracked')._unsafeUnwrap())
    .done();
  builder
    .field()
    .lastModifiedTime()
    .withId(fieldId('fldstamp'))
    .withName(FieldName.create('Stamp')._unsafeUnwrap())
    .withTrackedFieldIds(trackedFieldIds.map(fieldId))
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const field = table
    .getField((candidate): candidate is LastModifiedTimeField =>
      candidate.type().equals(FieldType.lastModifiedTime())
    )
    ._unsafeUnwrap();

  return { table, field };
};

const trackedIdsOf = (trackedFieldIds: ReadonlyArray<string>) => {
  const { table, field } = buildTrackedStamp(trackedFieldIds);
  return resolveTrackedFieldIds(table, field).map((id) => id.toString());
};

describe('resolveTrackedFieldIds', () => {
  it('reports an empty list for track-all', () => {
    expect(trackedIdsOf([])).toEqual([]);
  });

  it('keeps every tracked id that still resolves on the table', () => {
    expect(trackedIdsOf(['fldtracked', 'flduntracked'])).toEqual(['fldtracked', 'flduntracked']);
  });

  it('drops a tracked id the table no longer has', () => {
    expect(trackedIdsOf(['fldtracked', 'flddeleted'])).toEqual(['fldtracked']);
  });

  it('falls back to track-all when no tracked id resolves', () => {
    expect(trackedIdsOf(['flddeleted'])).toEqual([]);
  });
});
