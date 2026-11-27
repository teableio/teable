import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship, type IRecord } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import {
  axios,
  CREATE_RECORD,
  GET_RECORD_URL,
  UPDATE_RECORD,
  UPDATE_RECORDS,
  urlBuilder,
  type ICreateRecordsVo,
  type ITableFullVo,
} from '@teable/openapi';
import type { Knex } from 'knex';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

const legacyId = 'recLegacy';
const archiveId = 'rec-Legacy';
const idShapedTitle = 'recXXXXXXXXXXXXXXXX';

const expectV2 = (
  response: { status: number; headers: Record<string, unknown> },
  status: number
) => {
  expect(response.status).toBe(status);
  expect(response.headers['x-teable-v2']).toBe('true');
};

describe('V2 record URL link typecast (T8794)', () => {
  const baseId = globalThis.testConfig.baseId;
  let app: INestApplication;
  let targets: ITableFullVo;
  let sources: ITableFullVo;
  let singleLinkFieldId: string;
  let multipleLinkFieldId: string;
  let recipeId: string;
  let canonicalId: string;
  let idShapedTitleRecordId: string;
  let previousForceV2: string | undefined;

  beforeAll(async () => {
    previousForceV2 = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    app = (await initApp()).app;
    targets = await createTable(baseId, {
      name: 'Link typecast targets',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [
        { fields: { Name: 'recipe' } },
        { fields: { Name: 'Canonical ID target' } },
        { fields: { Name: legacyId } },
        { fields: { Name: 'Legacy ID target' } },
        { fields: { Name: idShapedTitle } },
        { fields: { Name: 'Archive ID target' } },
        { fields: { Name: 'Legacy folded target' } },
        { fields: { Name: 'Legacy exact target' } },
        { fields: { Name: 'Exact Title' } },
      ],
    });
    recipeId = targets.records[0].id;
    canonicalId = targets.records[1].id;
    idShapedTitleRecordId = targets.records[4].id;
    const knex = app.get<Knex>('CUSTOM_KNEX');
    const dataPrisma = app.get(DataPrismaService);
    // The create API generates IDs. Seed historical IDs before creating links.
    for (const [record, id] of [
      [targets.records[3], legacyId],
      [targets.records[5], archiveId],
    ] as const) {
      const rename = knex(targets.dbTableName)
        .where('__id', record.id)
        .update({ __id: id })
        .toSQL()
        .toNative();
      expect(await dataPrisma.$executeRawUnsafe(rename.sql, ...rename.bindings)).toBe(1);
    }
    // Bypass API normalization to seed legacy primary values with line breaks.
    for (const [record, title] of [
      [targets.records[6], 'Folded\nName'],
      [targets.records[7], 'Exact\nTitle'],
    ] as const) {
      const rename = knex(targets.dbTableName)
        .where('__id', record.id)
        .update({ [targets.fields[0].dbFieldName]: title })
        .toSQL()
        .toNative();
      expect(await dataPrisma.$executeRawUnsafe(rename.sql, ...rename.bindings)).toBe(1);
    }

    sources = await createTable(baseId, {
      name: 'Link typecast sources',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        ...[
          { name: 'Single', relationship: Relationship.ManyOne },
          { name: 'Multiple', relationship: Relationship.ManyMany },
        ].map(({ name, relationship }) => ({
          name,
          type: FieldType.Link as const,
          options: {
            relationship,
            foreignTableId: targets.id,
            lookupFieldId: targets.fields[0].id,
            isOneWay: true,
          },
        })),
      ],
      records: [],
    });
    singleLinkFieldId = sources.fields.find(({ name }) => name === 'Single')!.id;
    multipleLinkFieldId = sources.fields.find(({ name }) => name === 'Multiple')!.id;
  });

  afterAll(async () => {
    try {
      if (sources) await permanentDeleteTable(baseId, sources.id, 200);
      if (targets) await permanentDeleteTable(baseId, targets.id, 200);
    } finally {
      await app?.close();
      if (previousForceV2 == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2;
    }
  });

  const postRecord = async (fields: IRecord['fields']) => {
    const response = await axios.post<ICreateRecordsVo>(
      urlBuilder(CREATE_RECORD, { tableId: sources.id }),
      { typecast: true, fieldKeyType: FieldKeyType.Id, records: [{ fields }] }
    );
    expectV2(response, 201);
    return response.data.records[0];
  };

  const patchRecord = async (recordId: string, fields: IRecord['fields']) => {
    const response = await axios.patch<IRecord>(
      urlBuilder(UPDATE_RECORD, { tableId: sources.id, recordId }),
      { typecast: true, fieldKeyType: FieldKeyType.Id, record: { fields } }
    );
    expectV2(response, 200);
    return response.data;
  };

  const readRecord = async (recordId: string) => {
    const response = await axios.get<IRecord>(
      urlBuilder(GET_RECORD_URL, { tableId: sources.id, recordId }),
      { params: { fieldKeyType: FieldKeyType.Id } }
    );
    expectV2(response, 200);
    return response.data;
  };

  it('POST and PATCH resolve the bare recipe title and GET returns its target ID', async () => {
    const created = await postRecord({ [singleLinkFieldId]: 'recipe' });
    expect(created.fields[singleLinkFieldId]).toMatchObject({ id: recipeId });
    expect((await readRecord(created.id)).fields[singleLinkFieldId]).toEqual({
      id: recipeId,
      title: 'recipe',
    });

    const other = await postRecord({ [singleLinkFieldId]: { id: canonicalId } });
    expect((await readRecord(other.id)).fields[singleLinkFieldId]).toMatchObject({
      id: canonicalId,
    });
    const updated = await patchRecord(other.id, { [singleLinkFieldId]: 'recipe' });
    expect(updated.fields[singleLinkFieldId]).toMatchObject({ id: recipeId });
    expect((await readRecord(other.id)).fields[singleLinkFieldId]).toEqual({
      id: recipeId,
      title: 'recipe',
    });
  });

  it('POST and PATCH resolve a scalar title shaped like a generated ID when the ID is absent', async () => {
    const expected = { id: idShapedTitleRecordId, title: idShapedTitle };
    const created = await postRecord({ [singleLinkFieldId]: idShapedTitle });
    expect(created.fields[singleLinkFieldId]).toEqual(expected);
    expect((await readRecord(created.id)).fields[singleLinkFieldId]).toEqual(expected);

    const other = await postRecord({ [singleLinkFieldId]: canonicalId });
    expect(other.fields[singleLinkFieldId]).toEqual({
      id: canonicalId,
      title: 'Canonical ID target',
    });
    const updated = await patchRecord(other.id, { [singleLinkFieldId]: idShapedTitle });
    expect(updated.fields[singleLinkFieldId]).toEqual(expected);
    expect((await readRecord(other.id)).fields[singleLinkFieldId]).toEqual(expected);
  });

  it('keeps bare and explicit legacy IDs linked to their record when a title collides', async () => {
    const expected = { id: legacyId, title: 'Legacy ID target' };
    const created = await postRecord({ [singleLinkFieldId]: legacyId });
    expect(created.fields[singleLinkFieldId]).toEqual(expected);
    expect((await readRecord(created.id)).fields[singleLinkFieldId]).toEqual(expected);

    const other = await postRecord({ [singleLinkFieldId]: canonicalId });
    expect((await readRecord(other.id)).fields[singleLinkFieldId]).toMatchObject({
      id: canonicalId,
    });
    await patchRecord(other.id, { [singleLinkFieldId]: legacyId });
    expect((await readRecord(other.id)).fields[singleLinkFieldId]).toEqual(expected);
    await patchRecord(created.id, { [singleLinkFieldId]: { id: canonicalId } });
    await patchRecord(created.id, { [singleLinkFieldId]: { id: legacyId } });
    expect((await readRecord(created.id)).fields[singleLinkFieldId]).toEqual(expected);
  });

  it('POST retains a bare historical ID containing punctuation', async () => {
    const created = await postRecord({ [singleLinkFieldId]: archiveId });
    expect((await readRecord(created.id)).fields[singleLinkFieldId]).toEqual({
      id: archiveId,
      title: 'Archive ID target',
    });
  });

  it('keeps the order of the first occurrence of each resolved link in a mixed list', async () => {
    const created = await postRecord({
      [multipleLinkFieldId]: [canonicalId, 'recipe', 'No Such Title', legacyId, recipeId],
    });
    expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toEqual([
      { id: canonicalId, title: 'Canonical ID target' },
      { id: recipeId, title: 'recipe' },
      { id: legacyId, title: 'Legacy ID target' },
    ]);
    const updated = await axios.patch<IRecord[]>(
      urlBuilder(UPDATE_RECORDS, { tableId: sources.id }),
      {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: created.id,
            fields: {
              [multipleLinkFieldId]: ['recipe', legacyId, idShapedTitle, canonicalId, legacyId],
            },
          },
        ],
      }
    );
    expectV2(updated, 200);
    expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toEqual([
      { id: recipeId, title: 'recipe' },
      { id: legacyId, title: 'Legacy ID target' },
      { id: idShapedTitleRecordId, title: idShapedTitle },
      { id: canonicalId, title: 'Canonical ID target' },
    ]);
  });

  it('resolves normalized titles across lookup batches and prefers exact titles', async () => {
    const created = await postRecord({
      [multipleLinkFieldId]: [
        'Folded Name',
        ...Array.from({ length: 248 }, (_, index) => `Absent title ${index}`),
        'Exact\nTitle',
        'Folded\nName',
        'Exact Title',
      ],
    });
    // The two exact title predicates are separated by the 250-predicate boundary.
    expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toMatchObject([
      { id: targets.records[6].id },
      { id: targets.records[7].id },
      { id: targets.records[8].id },
    ]);
  });

  it('preserves ordered references when a subsequent write fails validation (T8810)', async () => {
    const fields = { [multipleLinkFieldId]: [{ id: legacyId }, { id: recipeId }] };
    const created = await postRecord(fields);
    const expected = [
      { id: legacyId, title: 'Legacy ID target' },
      { id: recipeId, title: 'recipe' },
    ];
    expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toEqual(expected);
    for (const [typecast, input] of [
      [true, ['recipe', { id: legacyId }]],
      [false, [{ id: '' }]],
    ] as const) {
      const rejected = await axios.patch(
        urlBuilder(UPDATE_RECORD, { tableId: sources.id, recordId: created.id }),
        {
          typecast,
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [multipleLinkFieldId]: input } },
        },
        { validateStatus: () => true }
      );
      expect(rejected.status).toBe(400);
      expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toEqual(expected);
    }
    await patchRecord(created.id, { [multipleLinkFieldId]: null });
    expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toBeUndefined();
  });

  it('rejects a missing generated-format ID when no display title matches it', async () => {
    const created = await postRecord({ [multipleLinkFieldId]: canonicalId });
    const response = await axios.patch(
      urlBuilder(UPDATE_RECORD, { tableId: sources.id, recordId: created.id }),
      {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [multipleLinkFieldId]: ['recipe', 'recYYYYYYYYYYYYYYYY'] } },
      },
      { validateStatus: () => true }
    );
    expect(response.status).toBe(400);
    expect((await readRecord(created.id)).fields[multipleLinkFieldId]).toEqual([
      { id: canonicalId, title: 'Canonical ID target' },
    ]);
  });
});
