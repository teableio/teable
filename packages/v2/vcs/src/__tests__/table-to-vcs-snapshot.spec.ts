import {
  ActorId,
  BaseId,
  FieldId,
  FieldName,
  FormulaExpression,
  GetViewSnapshotsQuery,
  ListTableRecordsQuery,
  Table,
  TableId,
  TableName,
  ViewAuditMetadata,
  ok,
  type IExecutionContext,
  type IQueryBus,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import {
  buildTableVcsSnapshot,
  mapTableFieldsToVcsSnapshots,
  mapTableViewsFromDomain,
} from '../server';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_A_ID = `tbl${'a'.repeat(16)}`;
const FIELD_TITLE_ID = `fld${'a'.repeat(16)}`;
const FIELD_SCORE_ID = `fld${'b'.repeat(16)}`;
const FIELD_FORMULA_ID = `fld${'c'.repeat(16)}`;
const FIELD_DATE_ID = `fld${'d'.repeat(16)}`;
const CREATED_AT = '2026-11-18T10:54:38.123Z';
const REC_1_ID = `rec${'a'.repeat(16)}`;

describe('tableToVcsSnapshot mappers', () => {
  it('maps domain fields, views, and versioned records into canonical VCS snapshots', async () => {
    const builder = Table.builder()
      .withBaseId(BaseId.create(BASE_ID)._unsafeUnwrap())
      .withId(TableId.create(TABLE_A_ID)._unsafeUnwrap())
      .withName(TableName.create('Items')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(FieldId.create(FIELD_TITLE_ID)._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(FieldId.create(FIELD_SCORE_ID)._unsafeUnwrap())
      .withName(FieldName.create('Score')._unsafeUnwrap())
      .done();
    builder
      .field()
      .formula()
      .withId(FieldId.create(FIELD_FORMULA_ID)._unsafeUnwrap())
      .withName(FieldName.create('Double')._unsafeUnwrap())
      .withExpression(FormulaExpression.create(`{${FIELD_SCORE_ID}} * 2`)._unsafeUnwrap())
      .done();
    builder
      .field()
      .date()
      .withId(FieldId.create(FIELD_DATE_ID)._unsafeUnwrap())
      .withName(FieldName.create('Created at')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const view = table.views()[0]!;
    view
      .setAuditMetadata(
        ViewAuditMetadata.rehydrate({
          createdBy: 'system',
          createdTime: '2026-11-18T00:00:00.000Z',
          lastModifiedBy: 'system',
          lastModifiedTime: '2026-11-18T00:00:00.000Z',
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    const gridViewId = view.id().toString();

    const fieldsRes = mapTableFieldsToVcsSnapshots(table);
    expect(fieldsRes.isOk()).toBe(true);
    expect(fieldsRes._unsafeUnwrap().map((f) => f.id)).toEqual([
      FIELD_TITLE_ID,
      FIELD_SCORE_ID,
      FIELD_FORMULA_ID,
      FIELD_DATE_ID,
    ]);
    expect(fieldsRes._unsafeUnwrap().find((f) => f.id === FIELD_TITLE_ID)?.isPrimary).toBe(true);
    expect(fieldsRes._unsafeUnwrap().find((f) => f.id === FIELD_FORMULA_ID)?.isComputed).toBe(true);

    const viewsRes = mapTableViewsFromDomain(table);
    expect(viewsRes.isOk()).toBe(true);
    expect(viewsRes._unsafeUnwrap()).toHaveLength(1);

    const queryBus: IQueryBus = {
      execute: vi.fn(async (_ctx: IExecutionContext, query: unknown) => {
        if (query instanceof GetViewSnapshotsQuery) {
          return ok({
            snapshots: [
              {
                view: {
                  id: gridViewId,
                  name: 'Grid',
                  type: 'grid',
                  columnMeta: {},
                },
              },
            ],
          });
        }
        if (query instanceof ListTableRecordsQuery) {
          return ok({
            records: [
              {
                id: REC_1_ID,
                fields: {
                  [FIELD_TITLE_ID]: 'Alpha',
                  [FIELD_SCORE_ID]: 10,
                  [FIELD_FORMULA_ID]: 20,
                  [FIELD_DATE_ID]: new Date(CREATED_AT),
                },
                version: 7,
              },
            ],
            total: 1,
            hasMore: false,
          });
        }
        throw new Error('Unexpected query');
      }) as unknown as IQueryBus['execute'],
    };

    const ctx: IExecutionContext = {
      actorId: ActorId.create('usrVcsMapper0001')._unsafeUnwrap(),
    };

    const snapshotRes = await buildTableVcsSnapshot({
      queryBus,
      context: ctx,
      table,
      includeRecords: true,
    });
    expect(snapshotRes.isOk()).toBe(true);
    const snap = snapshotRes._unsafeUnwrap();
    expect(snap.id).toBe(TABLE_A_ID);
    expect(snap.records).toEqual([
      {
        id: REC_1_ID,
        fields: {
          [FIELD_TITLE_ID]: 'Alpha',
          [FIELD_SCORE_ID]: 10,
          [FIELD_FORMULA_ID]: 20,
          [FIELD_DATE_ID]: CREATED_AT,
        },
        version: 7,
      },
    ]);
  });
});
