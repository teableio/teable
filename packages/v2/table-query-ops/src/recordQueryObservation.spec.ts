import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  RecordSearch,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableQueryObservationWindow } from './domain';
import { ObservedTableRecordQueryRepository } from './recordQueryObservation';

const makeTable = () => {
  const titleId = FieldId.create('fld0000000000000001')._unsafeUnwrap();
  const notesId = FieldId.create('fld0000000000000002')._unsafeUnwrap();
  const builder = Table.builder()
    .withId(TableId.create('tbl0000000000000001')._unsafeUnwrap())
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create('Observed search')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(titleId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .longText()
    .withId(notesId)
    .withName(FieldName.create('Notes')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.getFields()[0]?.setDbFieldName(DbFieldName.rehydrate('title')._unsafeUnwrap());
  table.getFields()[1]?.setDbFieldName(DbFieldName.rehydrate('notes')._unsafeUnwrap());
  return { table, titleId, notesId };
};

describe('ObservedTableRecordQueryRepository', () => {
  it('records the resolved selected field scope and active full-text access path', async () => {
    const { table, titleId, notesId } = makeTable();
    const observations: TableQueryObservationWindow[] = [];
    const inner = {
      find: vi.fn().mockResolvedValue(ok({ records: [], total: 0, offset: 0, limit: 100 })),
    };
    const sink = {
      record: vi.fn().mockImplementation((_context, item: TableQueryObservationWindow) => {
        observations.push(item);
        return Promise.resolve(ok(undefined));
      }),
    };
    const repository = new ObservedTableRecordQueryRepository(inner as never, sink);

    await repository.find({} as never, table, undefined, {
      search: {
        search: RecordSearch.fromTuple(['customer order', titleId.toString(), true]),
      },
      searchAccessPath: {
        kind: 'generated_tsvector',
        generatedColumnName: '__tqops_tsv_global',
        languageConfig: 'simple',
        searchScope: 'all_fields',
        coveredFieldIds: [notesId, titleId],
      },
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]?.shape().snapshot().searchShape).toMatchObject({
      allFields: false,
      searchedFieldIds: [titleId.toString()],
      fieldCount: 1,
      searchMode: 'full_text',
      searchScope: 'selected_fields',
      languageConfig: 'simple',
      coveredFieldIds: [titleId.toString(), notesId.toString()].sort(),
    });
  });
});
