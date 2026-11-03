import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { axios, UPDATE_RECORD, X_CANARY_HEADER, urlBuilder } from '@teable/openapi';
import type { Knex } from 'knex';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';
import {
  createBase,
  createField,
  createTable,
  deleteBase,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

interface IStoredRecord {
  id: string;
  version: number;
  parent: unknown;
  parentId: string | null;
  note: string | null;
}

const assertLocalPostgres = () => {
  const urls = [
    process.env.PRISMA_META_DATABASE_URL,
    process.env.PRISMA_DATABASE_URL,
    process.env.DATABASE_URL,
  ].filter((value): value is string => Boolean(value));
  if (!urls.length) throw new Error('Self-link update-scope acceptance requires local PostgreSQL');
  for (const value of urls) {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('Self-link update-scope acceptance only permits local PostgreSQL URLs');
    }
  }
};

describe('V2 self many-one update scope (real HTTP/PostgreSQL e2e)', () => {
  let app: INestApplication | undefined;
  let dataPrisma: DataPrismaService;
  let knex: Knex;

  beforeAll(async () => {
    assertLocalPostgres();
    app = (await initApp()).app;
    dataPrisma = app.get(DataPrismaService);
    knex = app.get<Knex>('CUSTOM_KNEX');
    const database = await dataPrisma.$queryRawUnsafe<Array<{ version: string }>>(
      'SELECT version() AS version'
    );
    expect(database[0]?.version).toContain('PostgreSQL');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('PATCH C.Parent=P changes only C while P and unrelated values stay unchanged', async () => {
    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'T8242 self-link update scope',
    });
    let tableId: string | undefined;

    try {
      const table = await createTable(base.id, {
        name: 'T8242 self-link update scope',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
          { name: 'Note', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'P', Note: 'keep-parent-note' } },
          { fields: { Name: 'C', Note: 'keep-child-note' } },
        ],
      });
      tableId = table.id;
      const nameField = table.fields.find(({ name }) => name === 'Name');
      const noteField = table.fields.find(({ name }) => name === 'Note');
      const parent = table.records.find(({ fields }) => fields.Name === 'P');
      const child = table.records.find(({ fields }) => fields.Name === 'C');
      if (!nameField || !noteField || !parent || !child || !noteField.dbFieldName) {
        throw new Error('Incomplete self-link update-scope fixture');
      }

      const parentField = await createField(table.id, {
        name: 'Parent',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table.id,
          lookupFieldId: nameField.id,
          isOneWay: true,
        },
      });
      const options = parentField.options as ILinkFieldOptions;
      if (!parentField.dbFieldName || !options.fkHostTableName || !options.foreignKeyName) {
        throw new Error('Missing self-link physical storage metadata');
      }
      expect(options).toMatchObject({
        relationship: Relationship.ManyOne,
        foreignTableId: table.id,
        isOneWay: true,
        fkHostTableName: table.dbTableName,
        selfKeyName: '__id',
      });

      const readStoredRecords = async () =>
        dataPrisma.$queryRawUnsafe<IStoredRecord[]>(
          knex(options.fkHostTableName)
            .select({
              id: '__id',
              version: '__version',
              parent: parentField.dbFieldName,
              parentId: options.foreignKeyName,
              note: noteField.dbFieldName,
            })
            .whereIn('__id', [parent.id, child.id])
            .orderBy('__id')
            .toQuery()
        );
      const byId = (rows: IStoredRecord[], recordId: string) => {
        const row = rows.find(({ id }) => id === recordId);
        if (!row) throw new Error(`Missing stored record ${recordId}`);
        return row;
      };

      const beforeHttp = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const beforeStored = await readStoredRecords();
      const parentBefore = byId(beforeStored, parent.id);
      const childBefore = byId(beforeStored, child.id);
      expect(beforeHttp.records.find(({ id }) => id === parent.id)?.fields).toMatchObject({
        [nameField.id]: 'P',
        [noteField.id]: 'keep-parent-note',
      });
      expect(
        beforeHttp.records.find(({ id }) => id === parent.id)?.fields[parentField.id] ?? null
      ).toBeNull();
      expect(beforeHttp.records.find(({ id }) => id === child.id)?.fields).toMatchObject({
        [nameField.id]: 'C',
        [noteField.id]: 'keep-child-note',
      });
      expect(
        beforeHttp.records.find(({ id }) => id === child.id)?.fields[parentField.id] ?? null
      ).toBeNull();
      expect(parentBefore).toMatchObject({
        parent: null,
        parentId: null,
        note: 'keep-parent-note',
      });
      expect(childBefore).toMatchObject({
        parent: null,
        parentId: null,
        note: 'keep-child-note',
      });

      const response = await axios.patch(
        urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: child.id }),
        {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [parentField.id]: { id: parent.id } } },
        },
        { headers: { [X_CANARY_HEADER]: 'true' } }
      );
      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.data.fields[parentField.id]).toMatchObject({ id: parent.id });
      expect(response.data.fields[noteField.id]).toBe('keep-child-note');

      const afterHttp = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const afterStored = await readStoredRecords();
      const parentAfter = byId(afterStored, parent.id);
      const childAfter = byId(afterStored, child.id);
      const parentHttp = afterHttp.records.find(({ id }) => id === parent.id);
      const childHttp = afterHttp.records.find(({ id }) => id === child.id);

      expect(parentHttp?.fields[parentField.id] ?? null).toBeNull();
      expect(childHttp?.fields[parentField.id]).toMatchObject({ id: parent.id });
      expect(parentHttp?.fields[nameField.id]).toBe('P');
      expect(childHttp?.fields[nameField.id]).toBe('C');
      expect(parentHttp?.fields[noteField.id]).toBe('keep-parent-note');
      expect(childHttp?.fields[noteField.id]).toBe('keep-child-note');

      expect(parentAfter.version).toBe(parentBefore.version);
      expect(childAfter.version).toBe(childBefore.version + 1);
      expect(parentAfter.parentId).toBeNull();
      expect(childAfter.parentId).toBe(parent.id);
      expect(parentAfter.parent).toBeNull();
      expect(childAfter.parent).toMatchObject({ id: parent.id });
      expect(parentAfter.note).toBe(parentBefore.note);
      expect(childAfter.note).toBe(childBefore.note);
    } finally {
      try {
        if (tableId) await permanentDeleteTable(base.id, tableId);
      } finally {
        await deleteBase(base.id);
      }
    }
  });
});
