import type { INestApplication } from '@nestjs/common';
import {
  FieldType,
  FieldKeyType,
  DateFormattingPreset,
  TimeFormatting,
  Role as baseRole,
  type IUserCellValue,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  axios,
  USER_ME,
  emailBaseInvitation,
  deleteBaseCollaborator,
  PrincipalType,
  type IUserMeVo,
} from '@teable/openapi';
import type { Knex } from 'knex';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('V2 creation field product conversions', () => {
  const baseId = globalThis.testConfig.baseId;
  let app: INestApplication;
  let prisma: PrismaService;
  let knex: Knex;
  const previousForceV2 = process.env.FORCE_V2_ALL;
  beforeAll(async () => {
    process.env.FORCE_V2_ALL = 'true';
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    knex = app.get('CUSTOM_KNEX');
  });
  afterAll(async () => {
    await app?.close();
    if (previousForceV2 == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2;
  });

  it.each([FieldType.SingleLineText, FieldType.Date])(
    'preserves createdTime through product convert endpoint (%s, T7785)',
    async (type) => {
      const table = await createTable(baseId, {
        name: 'Creation timestamp conversion',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Created',
            type: FieldType.CreatedTime,
            options: {
              formatting: {
                date: DateFormattingPreset.ISO,
                time: TimeFormatting.Hour24,
                timeZone: 'Asia/Tokyo',
              },
            },
          },
        ],
        records: [{ fields: { Name: 'Entry' } }],
      });
      try {
        const field = table.fields.find((candidate) => candidate.name === 'Created')!;
        const recordId = table.records[0].id;
        const before = await axios.get(`/table/${table.id}/record/${recordId}`, {
          params: { fieldKeyType: FieldKeyType.Id },
        });
        expect(before.headers['x-teable-v2']).toBe('true');
        const original = before.data.fields[field.id];
        const formatted = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(original));
        const converted = await axios.put(`/table/${table.id}/field/${field.id}/convert`, { type });
        expect(converted.status).toBe(200);
        expect(converted.headers['x-teable-v2']).toBe('true');
        expect(converted.data.type).toBe(type);
        const after = await getRecord(table.id, recordId);
        expect(after.fields[field.id]).toBe(type === FieldType.Date ? original : formatted);
        if (type === FieldType.Date) {
          await updateRecordByApi(table.id, recordId, field.id, '2020-01-01T00:00:00.000Z');
          expect((await getRecord(table.id, recordId)).fields[field.id]).toBe(
            '2020-01-01T00:00:00.000Z'
          );
        }
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it('preserves two creator names through product convert endpoint (T7789)', async () => {
    const email = 'creation-conversion@example.test';
    const second = await createNewUserAxios({ email, password: 'Creator123456!' });
    const actor = (await second.get<IUserMeVo>(USER_ME)).data;
    await prisma.user.update({ where: { id: actor.id }, data: { name: 'Example, Author' } });
    await emailBaseInvitation({
      baseId,
      emailBaseInvitationRo: { emails: [email], role: baseRole.Editor },
    });
    const table = await createTable(baseId, {
      name: 'Creator conversion',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Creator', type: FieldType.CreatedBy },
      ],
      records: [{ fields: { Name: 'First' } }],
    });
    try {
      const field = table.fields.find((candidate) => candidate.name === 'Creator')!;
      const primary = table.fields.find((candidate) => candidate.isPrimary)!;
      const first = await getRecord(table.id, table.records[0].id);
      const firstName = (first.fields[field.id] as IUserCellValue).title;
      const created = await second.post(`/table/${table.id}/record`, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [primary.id]: 'Second' } }],
      });
      expect(created.headers['x-teable-v2']).toBe('true');
      const secondId = created.data.records[0].id;
      expect((await getRecord(table.id, secondId)).fields[field.id]).toMatchObject({
        title: 'Example, Author',
      });
      const converted = await axios.put(`/table/${table.id}/field/${field.id}/convert`, {
        type: FieldType.SingleLineText,
      });
      expect(converted.headers['x-teable-v2']).toBe('true');
      expect(converted.data.type).toBe(FieldType.SingleLineText);
      expect((await getRecord(table.id, first.id)).fields[field.id]).toBe(firstName);
      expect((await getRecord(table.id, secondId)).fields[field.id]).toBe('"Example, Author"');
    } finally {
      await permanentDeleteTable(baseId, table.id);
      await deleteBaseCollaborator({
        baseId,
        deleteBaseCollaboratorRo: {
          principalId: actor.id,
          principalType: PrincipalType.User,
        },
      });
    }
  });

  it('preserves enriched creator display through product convert endpoint (T7789)', async () => {
    const actor = (await axios.get<IUserMeVo>(USER_ME)).data;
    const table = await createTable(baseId, {
      name: 'Historical creator conversion',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Creator', type: FieldType.CreatedBy },
      ],
      records: [0, 1, 2, 3].map((index) => ({ fields: { Name: `Entry ${index}` } })),
    });
    try {
      const field = table.fields.find((candidate) => candidate.name === 'Creator')!;
      const snapshots = [
        null,
        actor.id,
        { id: actor.id },
        { id: actor.id, title: 'Historical name' },
      ];
      const beforeNames: string[] = [];
      for (const [index, snapshot] of snapshots.entries()) {
        await prisma.$executeRawUnsafe(
          knex(table.dbTableName)
            .update({ [field.dbFieldName]: JSON.stringify(snapshot) })
            .where('__id', table.records[index].id)
            .toQuery()
        );
        const before = await getRecord(table.id, table.records[index].id);
        const name = (before.fields[field.id] as IUserCellValue).title;
        expect(name).toBe(actor.name);
        beforeNames.push(name);
      }
      const converted = await axios.put(`/table/${table.id}/field/${field.id}/convert`, {
        type: FieldType.SingleLineText,
      });
      expect(converted.headers['x-teable-v2']).toBe('true');
      for (const [index, name] of beforeNames.entries()) {
        expect((await getRecord(table.id, table.records[index].id)).fields[field.id]).toBe(
          name.includes(',') ? `"${name}"` : name
        );
      }
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
