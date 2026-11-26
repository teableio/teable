import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IRecord } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  axios,
  CREATE_RECORD,
  GET_RECORD_URL,
  UPDATE_RECORD,
  urlBuilder,
  X_CANARY_HEADER,
  type ICreateRecordsVo,
  type ITableFullVo,
} from '@teable/openapi';
import { DatabaseRouter } from '../src/global/database-router.service';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  createTable,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
} from './utils/init-app';

describe('v1 link typecast over record HTTP', () => {
  const headers = { [X_CANARY_HEADER]: 'false' };
  const legacyId = 'recLegacy7';
  const idShapedTitle = 'recCanonical0000001';
  let app: INestApplication | undefined;
  let spaceId: string | undefined;
  let linkBaseId: string | undefined;
  let foreignTable: ITableFullVo;
  let table: ITableFullVo;
  let singleLink: IFieldVo;
  let multipleLink: IFieldVo;
  let previousForceV2All: string | undefined;
  let previousEnableCanaryFeature: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'true';

    // Boot with private queues and keep the worker's shared pools open during cleanup.
    const previousSharedApp = process.env.E2E_SHARED_APP;
    process.env.E2E_SHARED_APP = '0';
    try {
      app = (await initApp()).app;
    } finally {
      if (previousSharedApp == null) delete process.env.E2E_SHARED_APP;
      else process.env.E2E_SHARED_APP = previousSharedApp;
    }

    const space = await createSpace({ name: 'v1 link typecast HTTP' });
    spaceId = space.id;
    const base = await createBase({ name: 'v1 link typecast HTTP routing', spaceId });
    linkBaseId = base.id;
    await app.get(PrismaService).base.update({
      where: { id: linkBaseId },
      data: { v2Enabled: false },
    });
    const records = ['recipe', 'other', 'legacy row', legacyId, idShapedTitle].map((title) => ({
      fields: { title },
    }));
    foreignTable = await createTable(linkBaseId, {
      name: 'link typecast targets',
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records,
    });
    // Simulate an imported variable-length ID, which the public create API cannot assign.
    const router = app.get(DatabaseRouter);
    const rename = router
      .dataKnex()(foreignTable.dbTableName)
      .where('__id', foreignTable.records[2].id)
      .update({ __id: legacyId })
      .toSQL()
      .toNative();
    const updatedRows = await router.executeDataPrismaForTable(
      foreignTable.id,
      rename.sql,
      ...rename.bindings
    );
    expect(updatedRows).toBe(1);

    table = await createTable(linkBaseId, {
      name: 'link typecast records',
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records: [],
    });
    singleLink = await createField(table.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: foreignTable.id },
    });
    multipleLink = await createField(table.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: foreignTable.id },
    });
  });

  afterAll(async () => {
    try {
      if (linkBaseId) await permanentDeleteBase(linkBaseId);
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally {
      try {
        await app?.close();
      } finally {
        if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
        else process.env.FORCE_V2_ALL = previousForceV2All;
        if (previousEnableCanaryFeature == null) delete process.env.ENABLE_CANARY_FEATURE;
        else process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
      }
    }
  });

  const post = async (...fields: IRecord['fields'][]) => {
    const response = await axios.post<ICreateRecordsVo>(
      urlBuilder(CREATE_RECORD, { tableId: table.id }),
      {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: fields.map((fields) => ({ fields })),
      },
      { headers }
    );
    expect(response.status).toBe(201);
    expect(response.headers['x-teable-v2']).toBe('false');
    return response.data.records;
  };

  const patch = (recordId: string, fields: IRecord['fields']) =>
    axios.patch<IRecord>(
      urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId }),
      { fieldKeyType: FieldKeyType.Id, typecast: true, record: { fields } },
      { headers, validateStatus: () => true }
    );

  const readFields = async (recordId: string) => {
    const response = await axios.get<IRecord>(
      urlBuilder(GET_RECORD_URL, { tableId: table.id, recordId }),
      { headers, params: { fieldKeyType: FieldKeyType.Id } }
    );
    expect(response.headers['x-teable-v2']).toBe('false');
    return response.data.fields;
  };

  it('persists rec-prefixed titles on POST and PATCH for single and multiple links', async () => {
    const [recipe, other] = foreignTable.records;
    const [created, updated] = await post(
      { [singleLink.id]: 'recipe', [multipleLink.id]: 'recipe' },
      { [singleLink.id]: other.id, [multipleLink.id]: other.id }
    );
    expect(await readFields(created.id)).toMatchObject({
      [singleLink.id]: { id: recipe.id },
      [multipleLink.id]: [{ id: recipe.id }],
    });
    expect(await readFields(updated.id)).toMatchObject({
      [singleLink.id]: { id: other.id },
      [multipleLink.id]: [{ id: other.id }],
    });

    const response = await patch(updated.id, {
      [singleLink.id]: 'recipe',
      [multipleLink.id]: 'recipe',
    });
    expect(response.headers['x-teable-v2']).toBe('false');
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(await readFields(updated.id)).toMatchObject({
      [singleLink.id]: { id: recipe.id },
      [multipleLink.id]: [{ id: recipe.id }],
    });
  });

  it('preserves legacy IDs, mixed input order, and duplicate rejection', async () => {
    const [recipe, other] = foreignTable.records;
    const [created, updated] = await post(
      {
        [singleLink.id]: legacyId,
        [multipleLink.id]: [{ id: other.id }, { id: 'recipe' }, 'recipe', 'missing title', legacyId],
      },
      { [singleLink.id]: other.id }
    );
    expect(await readFields(created.id)).toMatchObject({
      [singleLink.id]: { id: legacyId },
      [multipleLink.id]: [{ id: other.id }, { id: recipe.id }, { id: legacyId }],
    });

    const response = await patch(updated.id, {
      [singleLink.id]: legacyId,
      [multipleLink.id]: `${other.id}, ${legacyId}, recipe,`,
    });
    expect(response.headers['x-teable-v2']).toBe('false');
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(await readFields(updated.id)).toMatchObject({
      [singleLink.id]: { id: legacyId },
      [multipleLink.id]: [{ id: other.id }, { id: legacyId }, { id: recipe.id }],
    });

    const duplicate = await patch(updated.id, { [multipleLink.id]: ['recipe', recipe.id] });
    expect(duplicate.headers['x-teable-v2']).toBe('false');
    expect(duplicate.status, JSON.stringify(duplicate.data)).toBe(400);
    expect(duplicate.data).toMatchObject({
      data: { localization: { i18nKey: 'httpErrors.field.linkCellRecordIdAlreadyExists' } },
    });
  });

  it('resolves ID-shaped titles and prefers a matching record ID on collision', async () => {
    const [recipe, other, , , byTitle] = foreignTable.records;
    await createRecords(foreignTable.id, {
      fieldKeyType: FieldKeyType.Name,
      records: [{ fields: { title: other.id } }],
    });

    const [mixed, scalar] = await post(
      { [multipleLink.id]: ['recipe', idShapedTitle, other.id, 'recCanonical0000002'] },
      { [multipleLink.id]: idShapedTitle }
    );
    expect(await readFields(mixed.id)).toMatchObject({
      [multipleLink.id]: [{ id: recipe.id }, { id: byTitle.id }, { id: other.id }],
    });
    expect(await readFields(scalar.id)).toMatchObject({
      [multipleLink.id]: [{ id: byTitle.id }],
    });
  });
});
