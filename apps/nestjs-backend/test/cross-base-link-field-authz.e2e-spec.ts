import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, Role } from '@teable/core';
import {
  CONVERT_FIELD,
  CREATE_FIELD,
  CREATE_TABLE,
  DELETE_FIELD,
  DELETE_FIELD_LIST,
  emailBaseInvitation,
  getTableList,
  PrincipalType,
  UPDATE_FIELD,
  UPDATE_RECORD,
  updateBaseCollaborator,
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
  createSpace,
  createTable,
  getField,
  getFields,
  getRecord,
  initApp,
  permanentDeleteSpace,
} from './utils/init-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

type FieldSchema = Pick<IFieldVo, 'id' | 'name' | 'type' | 'options'>;
type SchemasSnapshot = { source: FieldSchema[]; foreign: FieldSchema[] };

describe('Cross-base two-way link field authorization (e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  let sourceBaseId: string;
  let foreignBaseId: string;
  let sourceTable: ITableFullVo;
  let foreignTable: ITableFullVo;
  let actor: AxiosInstance;
  let actorId: string;
  let twoWayToOneWay: IFieldVo;
  let twoWayToText: IFieldVo;
  let cardinalityField: IFieldVo;
  let singleDeleteField: IFieldVo;
  let bulkDeleteFields: [IFieldVo, IFieldVo];
  let previousForceV2All: string | undefined;

  const schemaSnapshot = (fields: IFieldVo[]) =>
    fields
      .map(({ id, name, type, options }) => ({ id, name, type, options }))
      .sort((left, right) => left.id.localeCompare(right.id));

  const schemasSnapshot = async (): Promise<SchemasSnapshot> => ({
    source: schemaSnapshot(await getFields(sourceTable.id)),
    foreign: schemaSnapshot(await getFields(foreignTable.id)),
  });

  const expectSchemasUnchanged = async (before: SchemasSnapshot) => {
    expect(await schemasSnapshot()).toEqual(before);
  };

  const symmetricFieldId = (field: IFieldVo) => {
    const fieldId = (field.options as ILinkFieldOptions).symmetricFieldId;
    if (!fieldId) {
      throw new Error(`Expected ${field.name} to have a symmetric field`);
    }
    return fieldId;
  };

  const createOwnerTwoWay = (name: string) =>
    createField(sourceTable.id, {
      name,
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
        baseId: foreignBaseId,
        isOneWay: false,
      },
    });

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    app = (await initApp()).app;
    spaceId = (await createSpace({ name: `cross-base-field-authz-${Date.now()}` })).id;
    sourceBaseId = (await createBase({ spaceId, name: 'writable source' })).id;
    foreignBaseId = (await createBase({ spaceId, name: 'read-only foreign' })).id;
    sourceTable = await createTable(sourceBaseId, {
      name: 'source',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Source record' } }],
    });
    foreignTable = await createTable(foreignBaseId, {
      name: 'foreign',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Foreign record' } }],
    });

    twoWayToOneWay = await createOwnerTwoWay('Two-way to one-way');
    twoWayToText = await createOwnerTwoWay('Two-way to text');
    cardinalityField = await createOwnerTwoWay('Cardinality update');
    singleDeleteField = await createOwnerTwoWay('Single delete');
    bulkDeleteFields = [
      await createOwnerTwoWay('Bulk delete A'),
      await createOwnerTwoWay('Bulk delete B'),
    ];

    const email = `cross-base-field-authz-${Date.now()}@example.com`;
    actor = await createNewUserAxios({ email, password: '12345678' });
    actorId = (await actor.get<IUserMeVo>(USER_ME)).data.id;
    await emailBaseInvitation({
      baseId: sourceBaseId,
      emailBaseInvitationRo: { emails: [email], role: Role.Creator },
    });
    await emailBaseInvitation({
      baseId: foreignBaseId,
      emailBaseInvitationRo: { emails: [email], role: Role.Viewer },
    });
  });

  afterAll(async () => {
    if (spaceId) {
      await permanentDeleteSpace(spaceId).catch(() => undefined);
    }
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app?.close();
  });

  it('denies direct field creation in the Viewer foreign base', async () => {
    const foreignBefore = schemaSnapshot(await getFields(foreignTable.id));
    const error = await getError(() =>
      actor.post(urlBuilder(CREATE_FIELD, { tableId: foreignTable.id }), {
        name: 'Direct foreign field',
        type: FieldType.SingleLineText,
      })
    );

    expect.soft(error?.status).toBe(403);
    expect(schemaSnapshot(await getFields(foreignTable.id))).toEqual(foreignBefore);
  });

  it.each([
    ['explicit isOneWay false', false],
    ['omitted isOneWay', undefined],
  ] as const)(
    'denies creating a two-way link with %s and leaves both schemas unchanged',
    async (_label, isOneWay) => {
      const before = await schemasSnapshot();
      const error = await getError(() =>
        actor.post(urlBuilder(CREATE_FIELD, { tableId: sourceTable.id }), {
          name: `Denied two-way link ${_label}`,
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
            baseId: foreignBaseId,
            ...(isOneWay === undefined ? {} : { isOneWay }),
          },
        })
      );

      expect.soft(error?.status).toBe(403);
      await expectSchemasUnchanged(before);
    }
  );

  it('denies a table creation payload containing a two-way cross-base link', async () => {
    const foreignBefore = schemaSnapshot(await getFields(foreignTable.id));
    const sourceTablesBefore = (await getTableList(sourceBaseId)).data
      .map(({ id, name }) => ({ id, name }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const error = await getError(() =>
      actor.post(urlBuilder(CREATE_TABLE, { baseId: sourceBaseId }), {
        name: 'Denied linked table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Foreign',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: foreignTable.id,
              baseId: foreignBaseId,
            },
          },
        ],
        records: [],
      })
    );

    expect.soft(error?.status).toBe(403);
    expect(schemaSnapshot(await getFields(foreignTable.id))).toEqual(foreignBefore);
    const sourceTablesAfter = (await getTableList(sourceBaseId)).data
      .map(({ id, name }) => ({ id, name }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(sourceTablesAfter).toEqual(sourceTablesBefore);
  });

  it('allows a one-way link but denies converting it to two-way', async () => {
    const foreignBeforeCreate = schemaSnapshot(await getFields(foreignTable.id));
    const created = await actor.post<IFieldVo>(
      urlBuilder(CREATE_FIELD, { tableId: sourceTable.id }),
      {
        name: 'Allowed one-way link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          baseId: foreignBaseId,
          isOneWay: true,
        },
      }
    );

    expect(created.status).toBe(201);
    expect(schemaSnapshot(await getFields(foreignTable.id))).toEqual(foreignBeforeCreate);

    const beforeConvert = await schemasSnapshot();
    const error = await getError(() =>
      actor.put(urlBuilder(CONVERT_FIELD, { tableId: sourceTable.id, fieldId: created.data.id }), {
        name: created.data.name,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          baseId: foreignBaseId,
          isOneWay: false,
        },
      })
    );

    expect.soft(error?.status).toBe(403);
    await expectSchemasUnchanged(beforeConvert);
    expect((await getField(sourceTable.id, created.data.id)).options).toMatchObject({
      isOneWay: true,
    });
  });

  it.each(['two-way to one-way', 'two-way to non-link'] as const)(
    'denies converting %s when it would mutate the foreign schema',
    async (conversion) => {
      const field = conversion === 'two-way to one-way' ? twoWayToOneWay : twoWayToText;
      const before = await schemasSnapshot();
      const error = await getError(() => {
        if (conversion === 'two-way to one-way') {
          return actor.put(
            urlBuilder(CONVERT_FIELD, { tableId: sourceTable.id, fieldId: field.id }),
            {
              name: field.name,
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyMany,
                foreignTableId: foreignTable.id,
                baseId: foreignBaseId,
                isOneWay: true,
              },
            }
          );
        }
        return actor.put(
          urlBuilder(CONVERT_FIELD, { tableId: sourceTable.id, fieldId: field.id }),
          { name: field.name, type: FieldType.SingleLineText }
        );
      });

      expect.soft(error?.status).toBe(403);
      await expectSchemasUnchanged(before);
      expect((await getField(sourceTable.id, field.id)).type).toBe(FieldType.Link);
      expect(await getField(foreignTable.id, symmetricFieldId(field))).toBeDefined();
    }
  );

  it('denies a relationship cardinality update that would update the foreign field', async () => {
    const before = await schemasSnapshot();
    const error = await getError(() =>
      actor.patch(
        urlBuilder(UPDATE_FIELD, { tableId: sourceTable.id, fieldId: cardinalityField.id }),
        {
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreignTable.id,
            baseId: foreignBaseId,
            isOneWay: false,
          },
        }
      )
    );

    expect.soft(error?.status).toBe(403);
    await expectSchemasUnchanged(before);
    expect((await getField(sourceTable.id, cardinalityField.id)).options).toMatchObject({
      relationship: Relationship.ManyMany,
    });
    expect(
      (await getField(foreignTable.id, symmetricFieldId(cardinalityField))).options
    ).toMatchObject({ relationship: Relationship.ManyMany });
  });

  it.each(['single', 'bulk'] as const)(
    'denies %s source field deletion when symmetric foreign fields cannot be deleted',
    async (mode) => {
      const fields = mode === 'single' ? [singleDeleteField] : bulkDeleteFields;
      const before = await schemasSnapshot();
      const error = await getError(() => {
        if (mode === 'single') {
          return actor.delete(
            urlBuilder(DELETE_FIELD, { tableId: sourceTable.id, fieldId: fields[0].id })
          );
        }
        return actor.delete(urlBuilder(DELETE_FIELD_LIST, { tableId: sourceTable.id }), {
          params: { fieldIds: fields.map(({ id }) => id) },
        });
      });

      expect.soft(error?.status).toBe(403);
      await expectSchemasUnchanged(before);
      for (const field of fields) {
        expect(await getField(sourceTable.id, field.id)).toBeDefined();
        expect(await getField(foreignTable.id, symmetricFieldId(field))).toBeDefined();
      }
    }
  );

  it('allows two-way creation, conversion, inverse sync, and deletion for a Creator on both bases', async () => {
    const roleChange = await updateBaseCollaborator({
      baseId: foreignBaseId,
      updateBaseCollaborateRo: {
        principalId: actorId,
        principalType: PrincipalType.User,
        role: Role.Creator,
      },
    });
    expect(roleChange.status).toBe(200);

    const created = await actor.post<IFieldVo>(
      urlBuilder(CREATE_FIELD, { tableId: sourceTable.id }),
      {
        name: 'Authorized two-way link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          baseId: foreignBaseId,
          isOneWay: false,
        },
      }
    );
    expect(created.status).toBe(201);
    const symmetricId = symmetricFieldId(created.data);
    expect(await getField(foreignTable.id, symmetricId)).toBeDefined();

    const recordUpdate = await actor.patch(
      urlBuilder(UPDATE_RECORD, {
        tableId: sourceTable.id,
        recordId: sourceTable.records[0].id,
      }),
      {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: { [created.data.id]: [{ id: foreignTable.records[0].id }] },
        },
      }
    );
    expect(recordUpdate.status).toBe(200);
    const foreignRecord = await getRecord(foreignTable.id, foreignTable.records[0].id);
    expect(foreignRecord.fields[symmetricId]).toEqual([
      expect.objectContaining({ id: sourceTable.records[0].id }),
    ]);

    const converted = await actor.put<IFieldVo>(
      urlBuilder(CONVERT_FIELD, { tableId: sourceTable.id, fieldId: created.data.id }),
      {
        name: created.data.name,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
          baseId: foreignBaseId,
          isOneWay: false,
        },
      }
    );
    expect(converted.status).toBe(200);
    expect((await getField(foreignTable.id, symmetricId)).options).toMatchObject({
      relationship: Relationship.OneMany,
    });

    const deleted = await actor.delete(
      urlBuilder(DELETE_FIELD, { tableId: sourceTable.id, fieldId: created.data.id })
    );
    expect(deleted.status).toBe(200);
    expect((await getFields(sourceTable.id)).some(({ id }) => id === created.data.id)).toBe(false);
    expect((await getFields(foreignTable.id)).some(({ id }) => id === symmetricId)).toBe(false);
    expect(
      (await getRecord(foreignTable.id, foreignTable.records[0].id)).fields
    ).not.toHaveProperty(symmetricId);
  });
});
