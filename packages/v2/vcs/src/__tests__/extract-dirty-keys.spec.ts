import {
  BaseId,
  FieldCreated,
  FieldDeleted,
  FieldDuplicated,
  FieldId,
  FieldName,
  FieldUpdated,
  LinkFieldConfig,
  RecordCreated,
  RecordId,
  RecordReordered,
  RecordUpdated,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  Table,
  TableCreated,
  TableDeleted,
  TableId,
  TableName,
  TableRenamed,
  TableRestored,
  TableTrashed,
  ViewCreated,
  ViewDeleted,
  ViewFilterUpdated,
  ViewId,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { buildVcsChangesFromEvent, extractVcsDirtyKeysFromEvent } from '../server';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_A_ID = `tbl${'a'.repeat(16)}`;
const FIELD_SCORE_ID = `fld${'b'.repeat(16)}`;
const FIELD_FORMULA_ID = `fld${'c'.repeat(16)}`;
const FIELD_NEW_ID = `fld${'n'.repeat(16)}`;
const VIEW_A_ID = `viw${'a'.repeat(16)}`;
const REC_1_ID = `rec${'a'.repeat(16)}`;
const REC_2_ID = `rec${'b'.repeat(16)}`;

describe('extractVcsDirtyKeysFromEvent & buildVcsChangesFromEvent', () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_A_ID)._unsafeUnwrap();
  const fieldId = FieldId.create(FIELD_SCORE_ID)._unsafeUnwrap();
  const dupFieldId = FieldId.create(FIELD_NEW_ID)._unsafeUnwrap();
  const viewId = ViewId.create(VIEW_A_ID)._unsafeUnwrap();
  const recordId = RecordId.create(REC_1_ID)._unsafeUnwrap();
  const recordId2 = RecordId.create(REC_2_ID)._unsafeUnwrap();
  const tableName = TableName.create('Items')._unsafeUnwrap();
  const renamedName = TableName.create('Renamed Items')._unsafeUnwrap();

  it('extracts dirty keys for table, field, view, and record domain events', () => {
    expect(
      extractVcsDirtyKeysFromEvent(
        TableCreated.create({
          baseId,
          tableId,
          tableName,
          fieldIds: [fieldId],
          viewIds: [viewId],
        })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'table', entityId: TABLE_A_ID, opKind: 'create' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        TableRenamed.create({ baseId, tableId, previousName: tableName, nextName: renamedName })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'table', entityId: TABLE_A_ID, opKind: 'update' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        TableDeleted.create({ baseId, tableId, tableName, fieldIds: [fieldId], viewIds: [viewId] })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'table', entityId: TABLE_A_ID, opKind: 'delete' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        TableTrashed.create({ baseId, tableId, tableName, fieldIds: [fieldId], viewIds: [viewId] })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'table', entityId: TABLE_A_ID, opKind: 'delete' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        TableRestored.create({ baseId, tableId, tableName, fieldIds: [fieldId], viewIds: [viewId] })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'table', entityId: TABLE_A_ID, opKind: 'create' },
    ]);

    expect(extractVcsDirtyKeysFromEvent(FieldCreated.create({ baseId, tableId, fieldId }))).toEqual(
      [{ tableId: TABLE_A_ID, entityType: 'field', entityId: FIELD_SCORE_ID, opKind: 'create' }]
    );

    expect(
      extractVcsDirtyKeysFromEvent(
        FieldUpdated.create({ baseId, tableId, fieldId, updatedProperties: ['name'] })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'field', entityId: FIELD_SCORE_ID, opKind: 'update' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        FieldDuplicated.create({
          baseId,
          tableId,
          sourceFieldId: fieldId,
          newFieldId: dupFieldId,
          includeRecordValues: true,
        })
      )
    ).toEqual([
      { tableId: TABLE_A_ID, entityType: 'field', entityId: FIELD_NEW_ID, opKind: 'create' },
    ]);

    expect(extractVcsDirtyKeysFromEvent(FieldDeleted.create({ baseId, tableId, fieldId }))).toEqual(
      [{ tableId: TABLE_A_ID, entityType: 'field', entityId: FIELD_SCORE_ID, opKind: 'delete' }]
    );

    expect(extractVcsDirtyKeysFromEvent(ViewCreated.create({ baseId, tableId, viewId }))).toEqual([
      { tableId: TABLE_A_ID, entityType: 'view', entityId: VIEW_A_ID, opKind: 'create' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        ViewFilterUpdated.create({
          baseId,
          tableId,
          viewId,
          previousFilter: null,
          nextFilter: null,
        })
      )
    ).toEqual([{ tableId: TABLE_A_ID, entityType: 'view', entityId: VIEW_A_ID, opKind: 'update' }]);

    expect(extractVcsDirtyKeysFromEvent(ViewDeleted.create({ baseId, tableId, viewId }))).toEqual([
      { tableId: TABLE_A_ID, entityType: 'view', entityId: VIEW_A_ID, opKind: 'delete' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        RecordCreated.create({ baseId, tableId, recordId, fieldValues: [] })
      )
    ).toMatchObject([
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_1_ID, opKind: 'create' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        RecordsBatchCreated.create({
          baseId,
          tableId,
          records: [
            { recordId: REC_1_ID, fields: [] },
            { recordId: REC_2_ID, fields: [] },
          ],
        })
      )
    ).toMatchObject([
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_1_ID, opKind: 'create' },
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_2_ID, opKind: 'create' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        RecordUpdated.create({
          baseId,
          tableId,
          recordId,
          oldVersion: 1,
          newVersion: 2,
          source: 'computed',
          changes: [{ fieldId: FIELD_FORMULA_ID, oldValue: 20, newValue: 30 }],
        })
      )
    ).toMatchObject([
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_1_ID, opKind: 'update' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        RecordsBatchUpdated.create({
          baseId,
          tableId,
          source: 'computed',
          updates: [{ recordId: REC_1_ID, oldVersion: 1, newVersion: 2, changes: [] }],
        })
      )
    ).toMatchObject([
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_1_ID, opKind: 'update' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        RecordsDeleted.create({
          baseId,
          tableId,
          recordIds: [recordId, recordId2],
          recordSnapshots: [],
        })
      )
    ).toMatchObject([
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_1_ID, opKind: 'delete' },
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_2_ID, opKind: 'delete' },
    ]);

    expect(
      extractVcsDirtyKeysFromEvent(
        RecordReordered.create({
          baseId,
          tableId,
          viewId,
          recordIds: [recordId],
          ordersByRecordId: { [REC_1_ID]: 2 },
          previousOrdersByRecordId: { [REC_1_ID]: 1 },
        })
      )
    ).toMatchObject([
      { tableId: TABLE_A_ID, entityType: 'record', entityId: REC_1_ID, opKind: 'update' },
    ]);
  });

  it('builds user record update payloads cleanly with before/after cell maps', () => {
    const userEvent = RecordUpdated.create({
      baseId,
      tableId,
      recordId,
      oldVersion: 1,
      newVersion: 2,
      source: 'user',
      changes: [{ fieldId: FIELD_SCORE_ID, oldValue: 10, newValue: 15 }],
    });

    const res = buildVcsChangesFromEvent(userEvent, {});
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual([
      {
        tableId: TABLE_A_ID,
        entityType: 'record',
        entityId: REC_1_ID,
        opKind: 'update',
        beforeValue: { id: REC_1_ID, fields: { [FIELD_SCORE_ID]: 10 } },
        afterValue: { id: REC_1_ID, fields: { [FIELD_SCORE_ID]: 15 } },
      },
    ]);
  });

  it('emits symmetric foreign-table record dirty keys for two-way link create and update events', () => {
    const compTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const symFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: compTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symFieldId.toString(),
      isOneWay: false,
    })._unsafeUnwrap();

    const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Company')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();
    const tableWithLink = builder.build()._unsafeUnwrap();

    const createEv = RecordCreated.create({
      baseId,
      tableId,
      recordId,
      fieldValues: [
        { fieldId: FIELD_SCORE_ID, value: 'Alice' },
        { fieldId: linkFieldId.toString(), value: { id: 'recComp1' } },
      ],
    });
    const createdChanges = buildVcsChangesFromEvent(createEv, {
      nextTable: tableWithLink,
    })._unsafeUnwrap();
    expect(createdChanges).toContainEqual({
      tableId: compTableId.toString(),
      entityType: 'record',
      entityId: 'recComp1',
      fieldId: symFieldId.toString(),
      opKind: 'update',
      beforeValue: null,
      afterValue: null,
    });

    const updateEv = RecordUpdated.create({
      baseId,
      tableId,
      recordId,
      oldVersion: 1,
      newVersion: 2,
      source: 'user',
      changes: [
        {
          fieldId: linkFieldId.toString(),
          oldValue: { id: 'recComp1' },
          newValue: { id: 'recComp2' },
        },
      ],
    });
    const updatedChanges = buildVcsChangesFromEvent(updateEv, {
      prevTable: tableWithLink,
      nextTable: tableWithLink,
    })._unsafeUnwrap();
    expect(updatedChanges).toContainEqual({
      tableId: compTableId.toString(),
      entityType: 'record',
      entityId: 'recComp1',
      fieldId: symFieldId.toString(),
      opKind: 'update',
      beforeValue: null,
      afterValue: null,
    });
    expect(updatedChanges).toContainEqual({
      tableId: compTableId.toString(),
      entityType: 'record',
      entityId: 'recComp2',
      fieldId: symFieldId.toString(),
      opKind: 'update',
      beforeValue: null,
      afterValue: null,
    });
  });
});
