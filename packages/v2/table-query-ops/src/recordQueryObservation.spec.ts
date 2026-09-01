import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  RecordSearch,
  Table,
  TableId,
  TableName,
  v2CoreTokens,
} from '@teable/v2-core';
import { container } from '@teable/v2-di';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableQueryObservationWindow } from './domain';
import {
  decorateV2TableRecordQueryRepositoryWithTableOps,
  ObservedTableRecordQueryRepository,
} from './recordQueryObservation';
import { v2TableOpsTokens } from './tokens';

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
    const publisher = {
      publish: vi.fn().mockImplementation((_context, item: TableQueryObservationWindow) => {
        observations.push(item);
      }),
    };
    const repository = new ObservedTableRecordQueryRepository(inner as never, publisher);

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

  it('publishes an observation without persistence knowledge', async () => {
    const { table } = makeTable();
    const publish = vi.fn();
    const repository = new ObservedTableRecordQueryRepository(
      {
        find: vi.fn().mockResolvedValue(ok({ records: [], total: 0, offset: 0, limit: 100 })),
      } as never,
      { publish }
    );

    const result = await repository.find({} as never, table);

    expect(result.isOk()).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('forwards aggregate to the inner repository and records an aggregation observation', async () => {
    const { table, titleId } = makeTable();
    const observations: TableQueryObservationWindow[] = [];
    const aggregate = vi
      .fn()
      .mockResolvedValue(ok([{ fieldId: titleId, statisticFunc: 'filled', value: 2 }]));
    const inner = {
      find: vi.fn(),
      aggregate,
    };
    const publisher = {
      publish: vi.fn().mockImplementation((_context, item: TableQueryObservationWindow) => {
        observations.push(item);
      }),
    };
    const repository = new ObservedTableRecordQueryRepository(inner as never, publisher);
    const aggregation = {
      fields: [{ fieldId: titleId, statisticFunc: 'filled' }],
      groupBy: [],
    };

    const result = await repository.aggregate({} as never, table, aggregation as never);

    expect(aggregate).toHaveBeenCalledOnce();
    expect(result.isOk()).toBe(true);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.shape().snapshot()).toMatchObject({
      queryKind: 'aggregation',
      aggregationShape: {
        groupFieldCount: 0,
        metricCount: 1,
        hasFilter: false,
      },
    });
  });

  it('forwards calendarDailyCollection and findDistinctUserIds to the inner repository', async () => {
    const { table } = makeTable();
    const calendarDailyCollection = vi.fn().mockResolvedValue(ok([]));
    const findDistinctUserIds = vi.fn().mockResolvedValue(ok(['usr1']));
    const repository = new ObservedTableRecordQueryRepository(
      {
        find: vi.fn(),
        calendarDailyCollection,
        findDistinctUserIds,
      } as never,
      { publish: vi.fn() }
    );

    await repository.calendarDailyCollection({} as never, table, {} as never, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await repository.findDistinctUserIds({} as never, table, {} as never);

    expect(calendarDailyCollection).toHaveBeenCalledOnce();
    expect(findDistinctUserIds).toHaveBeenCalledOnce();
  });

  it('keeps aggregate available after wrapping the registered repository', async () => {
    const { table, titleId } = makeTable();
    const child = container.createChildContainer();
    const aggregate = vi.fn().mockResolvedValue(ok([]));
    child.registerInstance(v2CoreTokens.tableRecordQueryRepository, {
      find: vi.fn(),
      findOne: vi.fn(),
      findStream: vi.fn(),
      aggregate,
      calendarDailyCollection: vi.fn(),
      findDistinctUserIds: vi.fn(),
    });
    child.registerInstance(v2TableOpsTokens.observationPublisher, {
      publish: vi.fn(),
    });

    decorateV2TableRecordQueryRepositoryWithTableOps(child);
    const wrapped = child.resolve<{ aggregate?: typeof aggregate }>(
      v2CoreTokens.tableRecordQueryRepository
    );

    expect(typeof wrapped.aggregate).toBe('function');
    await wrapped.aggregate?.({} as never, table, {
      fields: [{ fieldId: titleId, statisticFunc: 'filled' }],
      groupBy: [],
    } as never);
    expect(aggregate).toHaveBeenCalledOnce();
  });
});
