import type { INestApplication } from '@nestjs/common';
import type { IUserCellValue } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { axios, GET_RECORD_URL, UPDATE_RECORD, X_CANARY_HEADER, urlBuilder } from '@teable/openapi';
import type { Knex } from 'knex';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';
import {
  createBase,
  createTable,
  deleteBase,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

type RecordUpdatedPayload = {
  recordId?: string;
  changes?: Array<{
    fieldId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }>;
};

type AvatarFixture = {
  label: string;
  rawValue: IUserCellValue;
};

const assertLocalPostgres = () => {
  const urls = [
    process.env.PRISMA_META_DATABASE_URL,
    process.env.PRISMA_DATABASE_URL,
    process.env.DATABASE_URL,
  ].filter((value): value is string => Boolean(value));
  if (!urls.length) {
    throw new Error('User avatar event acceptance requires local PostgreSQL');
  }
  for (const value of urls) {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('User avatar event acceptance only permits local PostgreSQL URLs');
    }
  }
};

const userValue = (value: unknown): IUserCellValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a single user cell value');
  }
  return value as IUserCellValue;
};

describe('V2 user avatar update events (real HTTP/PostgreSQL e2e)', () => {
  let app: INestApplication | undefined;
  let dataPrisma: DataPrismaService;
  let knex: Knex;

  beforeAll(async () => {
    assertLocalPostgres();
    ({ app } = await initApp());
    dataPrisma = app.get(DataPrismaService);
    knex = app.get<Knex>('CUSTOM_KNEX');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns canonical avatars from the API and RecordUpdated for missing and stale stored avatars', async () => {
    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'T8242 user avatar event acceptance',
    });
    let tableId: string | undefined;

    try {
      const userId = globalThis.testConfig.userId;
      const table = await createTable(base.id, {
        name: 'T8242 user avatar event acceptance',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
          { name: 'Owner', type: FieldType.User },
        ],
        records: [{ fields: { Name: 'missing avatar' } }, { fields: { Name: 'stale avatar' } }],
      });
      tableId = table.id;
      const userField = table.fields.find(({ name }) => name === 'Owner');
      if (!userField?.dbFieldName) {
        throw new Error('Incomplete user avatar event fixture');
      }

      const fixtures: AvatarFixture[] = [
        {
          label: 'missing avatar',
          rawValue: {
            id: userId,
            title: 'Historical missing-avatar user',
          },
        },
        {
          label: 'stale avatar',
          rawValue: {
            id: userId,
            title: 'Historical stale-avatar user',
            avatarUrl: 'https://expired.invalid/avatar',
          },
        },
      ];

      const expectedByRecord = new Map<string, string>();
      for (const fixture of fixtures) {
        const record = table.records.find(({ fields }) => fields.Name === fixture.label);
        if (!record) throw new Error(`Missing ${fixture.label} record`);

        await dataPrisma.$executeRawUnsafe(
          knex(table.dbTableName)
            .update({ [userField.dbFieldName]: JSON.stringify(fixture.rawValue) })
            .where('__id', record.id)
            .toQuery()
        );
        const rawRows = await dataPrisma.$queryRawUnsafe<Array<{ value: unknown }>>(
          knex(table.dbTableName)
            .select({ value: userField.dbFieldName })
            .where('__id', record.id)
            .toQuery()
        );
        expect(rawRows).toEqual([{ value: fixture.rawValue }]);

        const before = await axios.get(
          urlBuilder(GET_RECORD_URL, { tableId: table.id, recordId: record.id }),
          {
            params: { fieldKeyType: FieldKeyType.Id },
            headers: { [X_CANARY_HEADER]: 'true' },
          }
        );
        expect(before.status).toBe(200);
        expect(before.headers[X_TEABLE_V2_HEADER]).toBe('true');
        const canonicalBefore = userValue(before.data.fields[userField.id]);
        expect(canonicalBefore).toMatchObject({ id: userId, avatarUrl: expect.any(String) });
        expect(canonicalBefore.avatarUrl).toContain(userId);
        expect(canonicalBefore.avatarUrl).not.toBe(fixture.rawValue.avatarUrl);
        expectedByRecord.set(record.id, canonicalBefore.avatarUrl!);

        const updated = await axios.patch(
          urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: record.id }),
          {
            fieldKeyType: FieldKeyType.Id,
            record: {
              fields: {
                [userField.id]: { id: userId, title: globalThis.testConfig.userName },
              },
            },
          },
          { headers: { [X_CANARY_HEADER]: 'true' } }
        );
        expect(updated.status).toBe(200);
        expect(updated.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(userValue(updated.data.fields[userField.id])).toMatchObject({
          id: userId,
          title: globalThis.testConfig.userName,
          avatarUrl: canonicalBefore.avatarUrl,
        });
      }

      const eventRows = await dataPrisma.$queryRawUnsafe<Array<{ payload: unknown }>>(
        `SELECT payload
         FROM domain_event_outbox
         WHERE base_id = $1
           AND table_id = $2
           AND message_name = 'table.record.updated.v1'
         ORDER BY created_at, id`,
        base.id,
        table.id
      );
      const events = eventRows.map(({ payload }) => payload as RecordUpdatedPayload);
      for (const [recordId, canonicalAvatar] of expectedByRecord) {
        const change = events
          .filter((event) => event.recordId === recordId)
          .flatMap((event) => event.changes ?? [])
          .find(({ fieldId }) => fieldId === userField.id);
        expect(change, `missing Owner RecordUpdated change for ${recordId}`).toBeDefined();
        expect(userValue(change!.oldValue)).toMatchObject({
          id: userId,
          avatarUrl: canonicalAvatar,
        });
        expect(userValue(change!.newValue)).toMatchObject({
          id: userId,
          title: globalThis.testConfig.userName,
          avatarUrl: canonicalAvatar,
        });
      }
    } finally {
      try {
        if (tableId) await permanentDeleteTable(base.id, tableId);
      } finally {
        await deleteBase(base.id);
      }
    }
  }, 60_000);
});
