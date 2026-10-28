import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IViewVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, Role, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  CREATE_FIELD,
  CREATE_RECORD,
  deleteRecords,
  DUPLICATE_URL,
  emailBaseInvitation,
  FORM_SUBMIT,
  getTrashItems,
  restoreTrash,
  RESTORE_TRASH,
  TableTrashType,
  TrashType,
  UPDATE_FIELD,
  UPDATE_RECORD,
  UPSERT_RECORD,
  urlBuilder,
  USER_ME,
  type ITableFullVo,
  type IUserMeVo,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createTable,
  createView,
  getFields,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * Every v2 entry point that persists a cross-base link must check the caller
 * can read the foreign table, not only the wrappers that used to call
 * `CrossBaseLinkAccessService` by hand (T8090).
 */
describe('Cross-base link access on v2 write entry points (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseId: string;
  let spaceId: string;
  let foreignBaseId: string;
  let foreignTable: ITableFullVo;
  let foreignTable2: ITableFullVo;
  let siblingTable: ITableFullVo;
  let duplicateTable: ITableFullVo;
  let table: ITableFullVo;
  let linkField: IFieldVo;
  let sameBaseLinkField: IFieldVo;
  let keyField: IFieldVo;
  let titleField: IFieldVo;
  let formView: IViewVo;
  let hostRecordId: string;
  let duplicateHostRecordId: string;
  let siblingRecordId: string;
  let storedForeignRecordId: string;
  let attemptedForeignRecordId: string;
  let symmetricFieldId: string;
  let junctionTableName: string;
  let junctionRowCount: number;
  let duplicateJunctionTableName: string;
  let duplicateJunctionRowCount: number;
  let editorUser: AxiosInstance;
  let editorEmail: string;
  let creatorUser: AxiosInstance;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    spaceId = globalThis.testConfig.spaceId;
    baseId = globalThis.testConfig.baseId;

    const foreignBase = await createBase({
      spaceId,
      name: `cross-base-entry-foreign-${Date.now()}`,
    });
    foreignBaseId = foreignBase.id;
    foreignTable = await createTable(foreignBaseId, {
      name: 'foreign',
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records: [{ fields: { title: 'foreign-1' } }, { fields: { title: 'foreign-2' } }],
    });
    foreignTable2 = await createTable(foreignBaseId, {
      name: 'foreign-2',
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records: [],
    });
    storedForeignRecordId = foreignTable.records[0].id;
    attemptedForeignRecordId = foreignTable.records[1].id;

    siblingTable = await createTable(baseId, {
      name: 'cross-base-entry-sibling',
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records: [{ fields: { title: 'sibling-1' } }],
    });
    siblingRecordId = siblingTable.records[0].id;

    table = await createTable(baseId, {
      name: 'cross-base-entry-host',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'key', type: FieldType.SingleLineText, unique: true },
      ],
      records: [{ fields: { title: 'host-1', key: 'k1' } }],
    });
    hostRecordId = table.records[0].id;
    keyField = table.fields.find((field) => field.name === 'key')!;
    titleField = table.fields.find((field) => field.name === 'title')!;
    linkField = await createField(table.id, {
      name: 'link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
        baseId: foreignBaseId,
      },
    });
    sameBaseLinkField = await createField(table.id, {
      name: 'same base link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: siblingTable.id,
      },
    });
    const createdFields = await getFields(table.id);
    const persistedLink = createdFields.find((field) => field.id === linkField.id)!;
    const fkHostTableName = optionString(persistedLink.options, 'fkHostTableName');
    if (!fkHostTableName) {
      throw new Error('created link field has no fkHostTableName');
    }
    junctionTableName = fkHostTableName;
    const foreignFields = await getFields(foreignTable.id);
    symmetricFieldId = foreignFields.find(
      (field) =>
        field.type === FieldType.Link && optionString(field.options, 'foreignTableId') === table.id
    )!.id;
    formView = await createView(table.id, { type: ViewType.Form, name: 'Form' });

    // A second host table without a unique field, so a duplicate fixture is
    // otherwise insertable.
    duplicateTable = await createTable(baseId, {
      name: 'cross-base-entry-duplicate',
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records: [{ fields: { title: 'duplicate-1' } }],
    });
    duplicateHostRecordId = duplicateTable.records[0].id;
    const duplicateLink = await createField(duplicateTable.id, {
      name: 'link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
        baseId: foreignBaseId,
      },
    });

    // Owner writes the links (allowed: it can read both bases).
    await updateRecord(table.id, hostRecordId, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [linkField.id]: [{ id: storedForeignRecordId }] } },
    });
    await updateRecord(duplicateTable.id, duplicateHostRecordId, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [duplicateLink.id]: [{ id: storedForeignRecordId }] } },
    });
    const duplicateFkHostTableName = optionString(
      (await getFields(duplicateTable.id)).find((field) => field.id === duplicateLink.id)!.options,
      'fkHostTableName'
    );
    if (!duplicateFkHostTableName) {
      throw new Error('duplicate link field has no fkHostTableName');
    }
    duplicateJunctionTableName = duplicateFkHostTableName;
    junctionRowCount = await junctionCount(junctionTableName);
    duplicateJunctionRowCount = await junctionCount(duplicateJunctionTableName);

    // Editor on the host base only: no role at all on the foreign base.
    editorEmail = `cross-base-entry-${Date.now()}@test.com`;
    editorUser = await createNewUserAxios({
      email: editorEmail,
      password: 'TestPassword123!',
    });
    const editorMe = await editorUser.get<IUserMeVo>(USER_ME);
    await emailBaseInvitation({
      baseId,
      emailBaseInvitationRo: { emails: [editorMe.data.email], role: Role.Editor },
    });

    // Creator has field|create / field|update on the host base, so a field
    // denial can only come from the cross-base read check.
    creatorUser = await createNewUserAxios({
      email: `cross-base-entry-creator-${Date.now()}@test.com`,
      password: 'TestPassword123!',
    });
    const creatorMe = await creatorUser.get<IUserMeVo>(USER_ME);
    await emailBaseInvitation({
      baseId,
      emailBaseInvitationRo: { emails: [creatorMe.data.email], role: Role.Creator },
    });
  });

  afterAll(async () => {
    for (const tableId of [table?.id, duplicateTable?.id, siblingTable?.id]) {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId).catch(() => undefined);
      }
    }
    if (foreignBaseId) {
      await permanentDeleteBase(foreignBaseId).catch(() => undefined);
    }
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app?.close();
  });

  const attemptedLink = () => [{ id: attemptedForeignRecordId }];

  const optionString = (options: unknown, key: string): string | undefined => {
    if (!options || typeof options !== 'object') {
      return undefined;
    }
    const value: unknown = Reflect.get(options, key);
    return typeof value === 'string' ? value : undefined;
  };

  const junctionCount = async (tableName: string) => {
    const [schema, junction] = tableName.split('.');
    const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM "${schema}"."${junction}"`
    );
    return rows[0]!.count;
  };

  it('denies /api/v2/tables/updateRecords without foreign read', async () => {
    const error = await getError(() =>
      editorUser.post('/v2/tables/updateRecords', {
        tableId: table.id,
        fieldKeyType: FieldKeyType.Id,
        records: [{ id: hostRecordId, fields: { [linkField.id]: attemptedLink() } }],
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies a structured-id createRecord without foreign read', async () => {
    const error = await getError(() =>
      editorUser.post(urlBuilder(CREATE_RECORD, { tableId: table.id }), {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleField.id]: 'created-by-editor',
              [keyField.id]: 'editor-key',
              [linkField.id]: attemptedLink(),
            },
          },
        ],
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies a structured-id updateRecord without foreign read', async () => {
    const error = await getError(() =>
      editorUser.patch(urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: hostRecordId }), {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [linkField.id]: attemptedLink() } },
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies upsert without foreign read', async () => {
    const error = await getError(() =>
      editorUser.post(urlBuilder(UPSERT_RECORD, { tableId: table.id }), {
        fieldKeyType: FieldKeyType.Id,
        matchField: keyField.id,
        onConflict: 'update',
        records: [
          {
            fields: {
              [keyField.id]: 'k1',
              [linkField.id]: attemptedLink(),
            },
          },
        ],
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies form submit without foreign read', async () => {
    const error = await getError(() =>
      editorUser.post(urlBuilder(FORM_SUBMIT, { tableId: table.id }), {
        viewId: formView.id,
        fieldKeyType: FieldKeyType.Id,
        fields: {
          [titleField.id]: 'form-row',
          [linkField.id]: attemptedLink(),
        },
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies duplicate without foreign read', async () => {
    const error = await getError(() =>
      editorUser.post(
        urlBuilder(DUPLICATE_URL, {
          tableId: duplicateTable.id,
          recordId: duplicateHostRecordId,
        })
      )
    );

    expect(error?.status).toBe(403);
    const records = await getRecords(duplicateTable.id, { fieldKeyType: FieldKeyType.Id });
    expect(records.records).toHaveLength(1);
    expect(await junctionCount(duplicateJunctionTableName)).toBe(duplicateJunctionRowCount);
  });

  it('leaves the stored link, the symmetric cell and the junction unchanged', async () => {
    const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });

    expect(records.records).toHaveLength(1);
    expect(records.records[0].fields[linkField.id]).toEqual([
      expect.objectContaining({ id: storedForeignRecordId }),
    ]);
    const foreignRecords = await getRecords(foreignTable.id, { fieldKeyType: FieldKeyType.Id });
    expect(foreignRecords.records[0].fields[symmetricFieldId]).toEqual([
      expect.objectContaining({ id: hostRecordId }),
    ]);
    expect(await junctionCount(junctionTableName)).toBe(junctionRowCount);
    expect(junctionRowCount).toBe(1);
  });

  it('allows a same-base link write for the restricted editor', async () => {
    const response = await editorUser.patch(
      urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: hostRecordId }),
      {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [sameBaseLinkField.id]: [{ id: siblingRecordId }] } },
      }
    );

    expect(response.status).toBe(200);
  });

  it('denies creating a field that references an unreadable foreign base', async () => {
    const error = await getError(() =>
      creatorUser.post(urlBuilder(CREATE_FIELD, { tableId: table.id }), {
        name: 'denied cross-base',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable2.id,
          baseId: foreignBaseId,
        },
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies converting a field to an unreadable foreign base', async () => {
    const error = await getError(() =>
      creatorUser.patch(urlBuilder(UPDATE_FIELD, { tableId: table.id, fieldId: linkField.id }), {
        name: 'renamed link',
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable2.id,
          baseId: foreignBaseId,
        },
      })
    );

    expect(error?.status).toBe(403);
  });

  it('denies creating a link column through paste without foreign read', async () => {
    const fields = await getFields(table.id);
    const linkTemplate = fields.find((field) => field.id === linkField.id)!;
    const textTemplate = fields.find((field) => field.id === titleField.id)!;
    const foreign2Primary = (await getFields(foreignTable2.id)).find(
      (field) => field.isPrimary
    )!.id;

    // Start past the fourth column with one content cell: two columns are
    // created from the last two headers, so the link header is still one of
    // them even though the content is narrower.
    const error = await getError(() =>
      creatorUser.patch(urlBuilder('/table/{tableId}/selection/paste', { tableId: table.id }), {
        viewId: table.views[0].id,
        ranges: [
          [5, 0],
          [5, 0],
        ],
        content: [['foreign-1']],
        header: [
          {
            ...linkTemplate,
            id: `fld${'z'.repeat(16)}`,
            name: 'denied paste link',
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: foreignTable2.id,
              lookupFieldId: foreign2Primary,
              baseId: foreignBaseId,
            },
          },
          { ...textTemplate, id: `fld${'y'.repeat(16)}`, name: 'pasted text' },
        ],
      })
    );

    expect(error?.status).toBe(403);
  });

  it('does not check a copied link header that is pasted into an existing column', async () => {
    const template = (await getFields(table.id)).find((field) => field.id === linkField.id)!;

    const response = await creatorUser.patch(
      urlBuilder('/table/{tableId}/selection/paste', { tableId: table.id }),
      {
        viewId: table.views[0].id,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['plain text']],
        header: [{ ...template, name: 'copied link' }],
      }
    );

    expect(response.status).toBe(200);
  });

  it('allows a same-base field creation for the creator', async () => {
    const response = await creatorUser.post(urlBuilder(CREATE_FIELD, { tableId: table.id }), {
      name: 'allowed same-base',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: siblingTable.id,
      },
    });

    expect(response.status).toBe(201);
  });

  it('denies restoring a trashed record without foreign read', async () => {
    await deleteRecords(table.id, [hostRecordId]);
    const junctionAfterDelete = await junctionCount(junctionTableName);
    const findRecordTrashItem = async () =>
      (
        await getTrashItems({ resourceId: table.id, resourceType: TrashType.Table })
      ).data.trashItems.find(
        (item) => optionString(item, 'resourceType') === TableTrashType.Record
      );
    await expect.poll(findRecordTrashItem).toBeDefined();
    const trashItem = await findRecordTrashItem();

    const error = await getError(() =>
      editorUser.post(urlBuilder(RESTORE_TRASH, { trashId: trashItem!.id }), undefined, {
        params: { tableId: table.id },
      })
    );

    expect(error?.status).toBe(403);
    const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(records.records).toHaveLength(0);
    expect(await junctionCount(junctionTableName)).toBe(junctionAfterDelete);

    // Owner can read the foreign base, so the same restore succeeds and the
    // junction row comes back.
    const restored = await restoreTrash(trashItem!.id, table.id);
    expect(restored.status).toBe(201);
    expect(await junctionCount(junctionTableName)).toBe(junctionRowCount);
  });

  it('allows the same write once the caller can read the foreign base', async () => {
    const me = await editorUser.get<IUserMeVo>(USER_ME);
    await emailBaseInvitation({
      baseId: foreignBaseId,
      emailBaseInvitationRo: { emails: [me.data.email], role: Role.Viewer },
    });

    const response = await editorUser.post('/v2/tables/updateRecords', {
      tableId: table.id,
      fieldKeyType: FieldKeyType.Id,
      records: [{ id: hostRecordId, fields: { [linkField.id]: attemptedLink() } }],
    });
    expect(response.status).toBe(200);

    const created = await editorUser.post(urlBuilder(CREATE_RECORD, { tableId: table.id }), {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [titleField.id]: 'granted create',
            [keyField.id]: 'granted-key',
            [linkField.id]: attemptedLink(),
          },
        },
      ],
    });
    expect(created.status).toBe(201);

    const upserted = await editorUser.post(urlBuilder(UPSERT_RECORD, { tableId: table.id }), {
      fieldKeyType: FieldKeyType.Id,
      matchField: keyField.id,
      onConflict: 'update',
      records: [{ fields: { [keyField.id]: 'k1', [linkField.id]: attemptedLink() } }],
    });
    expect(upserted.status).toBe(201);

    const submitted = await editorUser.post(urlBuilder(FORM_SUBMIT, { tableId: table.id }), {
      viewId: formView.id,
      fieldKeyType: FieldKeyType.Id,
      fields: { [titleField.id]: 'granted form', [linkField.id]: attemptedLink() },
    });
    expect(submitted.status).toBe(201);

    const duplicated = await editorUser.post(
      urlBuilder(DUPLICATE_URL, {
        tableId: duplicateTable.id,
        recordId: duplicateHostRecordId,
      })
    );
    expect(duplicated.status).toBe(201);

    await updateRecord(table.id, hostRecordId, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [linkField.id]: [{ id: storedForeignRecordId }] } },
    });
  });
});
