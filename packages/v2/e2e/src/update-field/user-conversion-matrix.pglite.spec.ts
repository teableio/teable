/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import {
  ActorId,
  buildUserAvatarUrl,
  GetRecordCollaboratorsQuery,
  type GetRecordCollaboratorsResult,
  type IQueryBus,
  v2CoreTokens,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';
import { ensureAttachmentTables, makeAttachmentCell, seedAttachment } from './attachment/testUtils';

type FieldLike = { id: string; name: string; type?: string; isPrimary?: boolean };
type UserValue = { id: string; title?: string; email?: string };

const baseMember = {
  id: 'usrT8238MatrixBase',
  name: 'Matrix Base Member',
  email: 'matrix-base@example.invalid',
};
const spaceMember = {
  id: 'usrT8238MatrixSpace',
  name: 'Matrix Space Member',
  email: 'matrix-space@example.invalid',
};
const outsider = {
  id: 'usrT8238MatrixOutsider',
  name: 'Matrix Platform Outsider',
  email: 'matrix-outsider@example.invalid',
};
const syntheticUserIds = [baseMember.id, spaceMember.id, outsider.id];

describe('update-field: complete user conversion behavior matrix (PGlite)', () => {
  let ctx: SharedTestContext;
  let spaceId: string;
  let serial = 0;

  const nextName = (prefix: string) => `T8238 ${prefix} ${serial++}`;
  const fieldByName = (fields: ReadonlyArray<FieldLike>, name: string) => {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) throw new Error(`Missing field: ${name}`);
    return field;
  };
  const readCell = async (tableId: string, recordId: string, fieldId: string) => {
    const records = await ctx.listRecords(tableId);
    const record = records.find((candidate) => candidate.id === recordId);
    expect(record, `Record ${recordId} must exist`).toBeDefined();
    const fields = record!.fields;
    expect(
      Object.prototype.hasOwnProperty.call(fields, fieldId),
      `Field ${fieldId} must be an own key`
    ).toBe(true);
    const value = fields[fieldId];
    expect(value, `Field ${fieldId} must not be undefined`).not.toBeUndefined();
    return value;
  };
  const readPopulatedCell = async (tableId: string, recordId: string, fieldId: string) => {
    const value = await readCell(tableId, recordId, fieldId);
    expect(value, `Source field ${fieldId} must be populated`).not.toBeNull();
    return value;
  };
  const removeSyntheticDirectory = async () => {
    await ctx.testContainer.db
      .deleteFrom('collaborator')
      .where('principal_id', 'in', syntheticUserIds)
      .execute();
    await ctx.testContainer.db.deleteFrom('users').where('id', 'in', syntheticUserIds).execute();
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
    const base = await ctx.testContainer.db
      .selectFrom('base')
      .select('space_id')
      .where('id', '=', ctx.baseId)
      .executeTakeFirstOrThrow();
    spaceId = base.space_id;

    await removeSyntheticDirectory();
    await ctx.testContainer.db
      .insertInto('users')
      .values([baseMember, spaceMember, outsider])
      .execute();
    await ctx.testContainer.db
      .insertInto('collaborator')
      .values([
        {
          id: 'colT8238MatrixBase',
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: baseMember.id,
          principal_type: 'user',
        },
        {
          id: 'colT8238MatrixSpace',
          resource_type: 'space',
          resource_id: spaceId,
          principal_id: spaceMember.id,
          principal_type: 'user',
        },
      ])
      .execute();
    await ensureAttachmentTables(ctx);
  });

  afterAll(async () => {
    if (!ctx) return;
    await removeSyntheticDirectory();
  });

  describe.each([
    {
      sourceType: 'singleLineText',
      sourceField: (_choices: unknown[]) => ({ type: 'singleLineText', name: 'Candidate' }),
    },
    {
      sourceType: 'longText',
      sourceField: (_choices: unknown[]) => ({ type: 'longText', name: 'Candidate' }),
    },
    {
      sourceType: 'singleSelect',
      sourceField: (choices: unknown[]) => ({
        type: 'singleSelect',
        name: 'Candidate',
        options: { choices },
      }),
    },
  ])('$sourceType → user collaborator resolution', ({ sourceType, sourceField }) => {
    test.each([false, true])(
      'resolves base/space members by id, email and name and excludes platform outsiders (multiple=%s)',
      async (isMultiple) => {
        let tableId: string | undefined;
        try {
          const values = [
            baseMember.id,
            baseMember.email,
            spaceMember.name,
            outsider.id,
            outsider.email,
            outsider.name,
            JSON.stringify({ id: outsider.id, title: baseMember.name }),
            `unknown, ${baseMember.name}`,
            baseMember.name,
            spaceMember.id,
            spaceMember.email,
          ];
          const choices = values.map((name, index) => ({
            id: `cho${String(index).padStart(16, '0')}`,
            name,
            color: 'blue',
          }));
          const table = await ctx.createTable({
            baseId: ctx.baseId,
            name: nextName(`${sourceType} source`),
            fields: [
              { type: 'singleLineText', name: 'Row', isPrimary: true },
              sourceField(choices),
            ] as never,
          });
          tableId = table.id;
          const rowFieldId = fieldByName(table.fields, 'Row').id;
          const candidateFieldId = fieldByName(table.fields, 'Candidate').id;
          const records = [];
          for (const [index, value] of values.entries()) {
            records.push(
              await ctx.createRecord(table.id, {
                [rowFieldId]: `row-${index}`,
                [candidateFieldId]: value,
              })
            );
          }
          for (const [index, record] of records.entries()) {
            expect(await readPopulatedCell(table.id, record.id, candidateFieldId)).toBe(
              values[index]
            );
          }

          await ctx.updateField({
            tableId: table.id,
            fieldId: candidateFieldId,
            field: { type: 'user', options: { isMultiple, shouldNotify: false } },
          });

          const cells = await Promise.all(
            records.map((record) => readCell(table.id, record.id, candidateFieldId))
          );
          const first = (value: unknown): UserValue | null =>
            (Array.isArray(value) ? value[0] : value) as UserValue | null;
          expect(first(cells[0])).toMatchObject({ id: baseMember.id, email: baseMember.email });
          expect(first(cells[1])).toMatchObject({ id: baseMember.id, email: baseMember.email });
          expect(first(cells[2])).toMatchObject({ id: spaceMember.id, email: spaceMember.email });
          expect(cells[3]).toBeNull();
          expect(cells[4]).toBeNull();
          expect(cells[5]).toBeNull();
          expect(cells[6]).toBeNull();
          expect(first(cells[7])).toMatchObject({ id: baseMember.id, title: baseMember.name });
          expect(first(cells[8])).toMatchObject({ id: baseMember.id, email: baseMember.email });
          expect(first(cells[9])).toMatchObject({ id: spaceMember.id, email: spaceMember.email });
          expect(first(cells[10])).toMatchObject({ id: spaceMember.id, email: spaceMember.email });
          expect(Array.isArray(cells[0])).toBe(isMultiple);

          // Y3641 consumer proof: actual HTTP group metadata, not just ordered rows.
          const params = new URLSearchParams({
            tableId: table.id,
            fieldKeyType: 'id',
            groupBy: JSON.stringify([candidateFieldId]),
            includeGroups: 'true',
          });
          const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params}`);
          expect(response.status).toBe(200);
          const grouped = listTableRecordsOkResponseSchema.parse(await response.json());
          if (!grouped.ok) throw new Error('Expected successful user grouping');
          // Group keys expose canonical display identity/avatar, not email.
          const expectedGroups = [baseMember, spaceMember].map((member, index) => {
            const value = {
              id: member.id,
              title: member.name,
              avatarUrl: buildUserAvatarUrl(member.id),
            };
            return {
              fields: { [candidateFieldId]: isMultiple ? [value] : value },
              count: index === 0 ? 4 : 3,
            };
          });
          expect(grouped.data.groups).toHaveLength(3);
          expect(grouped.data.groups).toEqual(
            expect.arrayContaining([
              ...expectedGroups,
              { fields: { [candidateFieldId]: null }, count: 4 },
            ])
          );
          expect(grouped.data.records).toHaveLength(records.length);

          // Standalone v2 has no collaborators HTTP route: exercise the real
          // GetRecordCollaborators query handler/repository, not a fabricated route.
          const queryBus = ctx.testContainer.container.resolve<IQueryBus>(v2CoreTokens.queryBus);
          const query = GetRecordCollaboratorsQuery.create({
            tableId: table.id,
            fieldId: candidateFieldId,
          })._unsafeUnwrap();
          const collaborators = (
            await queryBus.execute<GetRecordCollaboratorsQuery, GetRecordCollaboratorsResult>(
              { actorId: ActorId.create(ctx.testUser.id)._unsafeUnwrap() },
              query
            )
          )._unsafeUnwrap().collaborators;
          expect(collaborators).toHaveLength(2);
          expect(collaborators).toEqual(
            expect.arrayContaining(
              [baseMember, spaceMember].map((member) => ({
                userId: member.id,
                userName: member.name,
                email: member.email,
                avatar: buildUserAvatarUrl(member.id),
              }))
            )
          );
          for (const result of [grouped.data, collaborators]) {
            const serialized = JSON.stringify(result);
            for (const forbidden of [
              outsider.id,
              outsider.name,
              outsider.email,
              buildUserAvatarUrl(outsider.id),
            ]) {
              expect(serialized).not.toContain(forbidden);
            }
          }
        } finally {
          if (tableId) await ctx.deleteTable(tableId);
        }
      }
    );
  });

  test.each([false, true])(
    'incompatible primitive and JSON-backed sources clear populated values (target multiple=%s)',
    async (isMultiple) => {
      let tableId: string | undefined;
      try {
        const attachment = makeAttachmentCell(await seedAttachment(ctx), 'matrix.txt');
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('primitive sources'),
          fields: [
            { type: 'singleLineText', name: 'Row', isPrimary: true },
            { type: 'number', name: 'Number' },
            { type: 'rating', name: 'Rating', options: { max: 5 } },
            { type: 'checkbox', name: 'Checkbox' },
            {
              type: 'date',
              name: 'Date',
              options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
            },
            {
              type: 'multipleSelect',
              name: 'Multiple Select',
              options: {
                choices: [
                  { id: 'choT8238BaseMember', name: baseMember.name, color: 'blue' },
                  { id: 'choT8238Outsider', name: outsider.name, color: 'red' },
                ],
              },
            },
            { type: 'attachment', name: 'Attachment' },
            { type: 'button', name: 'Button', options: { label: 'Run', color: 'blue' } },
          ] as never,
        });
        tableId = table.id;
        const ids = Object.fromEntries(table.fields.map((field) => [field.name, field.id]));
        const record = await ctx.createRecord(table.id, {
          [ids.Row]: 'populated',
          [ids.Number]: 8238,
          [ids.Rating]: 4,
          [ids.Checkbox]: true,
          [ids.Date]: '2026-01-02T03:04:00.000Z',
          [ids['Multiple Select']]: [baseMember.name, outsider.name],
          [ids.Attachment]: attachment,
          [ids.Button]: { count: 3 },
        });
        const candidateNames = [
          'Number',
          'Rating',
          'Checkbox',
          'Date',
          'Multiple Select',
          'Attachment',
          'Button',
        ];
        for (const name of candidateNames) {
          await readPopulatedCell(table.id, record.id, ids[name]);
        }

        for (const name of candidateNames) {
          await ctx.updateField({
            tableId: table.id,
            fieldId: ids[name],
            field: { type: 'user', options: { isMultiple, shouldNotify: false } },
          });
          expect(await readCell(table.id, record.id, ids[name])).toBeNull();
        }
      } finally {
        if (tableId) await ctx.deleteTable(tableId);
      }
    }
  );

  test.each([false, true])(
    'computed, link and system sources convert to empty user cells instead of resolving display values (target multiple=%s)',
    async (isMultiple) => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('foreign sources'),
          fields: [
            { type: 'singleLineText', name: 'Foreign Name', isPrimary: true },
            { type: 'number', name: 'Foreign Number' },
            {
              type: 'user',
              name: 'Foreign User',
              options: { isMultiple: false, shouldNotify: false },
            },
          ],
        });
        foreignTableId = foreign.id;
        const foreignIds = Object.fromEntries(
          foreign.fields.map((field) => [field.name, field.id])
        );
        const foreignRecord = await ctx.createRecord(foreign.id, {
          [foreignIds['Foreign Name']]: baseMember.name,
          [foreignIds['Foreign Number']]: 7,
          [foreignIds['Foreign User']]: { id: baseMember.id },
        });
        for (const fieldId of Object.values(foreignIds)) {
          await readPopulatedCell(foreign.id, foreignRecord.id, fieldId);
        }

        const linkId = 'fldT8238MatrixLnk';
        const lookupId = 'fldT8238MatrixLkp';
        const userLookupId = 'fldT8238MatrixUsrLkp';
        const rollupId = 'fldT8238MatrixRlp';
        const conditionalLookupId = 'fldT8238MatrixCLkp';
        const conditionalRollupId = 'fldT8238MatrixCRlp';
        const formulaId = 'fldT8238MatrixFml';
        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('computed sources'),
          fields: [
            { type: 'singleLineText', name: 'Row', isPrimary: true },
            {
              type: 'link',
              id: linkId,
              name: 'Link',
              options: {
                relationship: 'manyMany',
                foreignTableId: foreign.id,
                lookupFieldId: foreignIds['Foreign Name'],
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: lookupId,
              name: 'Lookup Text',
              options: {
                linkFieldId: linkId,
                foreignTableId: foreign.id,
                lookupFieldId: foreignIds['Foreign Name'],
              },
            },
            {
              type: 'lookup',
              id: userLookupId,
              name: 'Lookup User',
              options: {
                linkFieldId: linkId,
                foreignTableId: foreign.id,
                lookupFieldId: foreignIds['Foreign User'],
              },
            },
            {
              type: 'rollup',
              id: rollupId,
              name: 'Rollup',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId: linkId,
                foreignTableId: foreign.id,
                lookupFieldId: foreignIds['Foreign Number'],
              },
            },
            {
              type: 'conditionalLookup',
              id: conditionalLookupId,
              name: 'Conditional Lookup',
              options: {
                foreignTableId: foreign.id,
                lookupFieldId: foreignIds['Foreign Name'],
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignIds['Foreign Name'],
                        operator: 'is',
                        value: baseMember.name,
                      },
                    ],
                  },
                },
              },
            },
            {
              type: 'conditionalRollup',
              id: conditionalRollupId,
              name: 'Conditional Rollup',
              options: { expression: 'sum({values})' },
              config: {
                foreignTableId: foreign.id,
                lookupFieldId: foreignIds['Foreign Number'],
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignIds['Foreign Name'],
                        operator: 'is',
                        value: baseMember.name,
                      },
                    ],
                  },
                },
              },
            },
            {
              type: 'formula',
              id: formulaId,
              name: 'Formula',
              options: { expression: `"${baseMember.name}"` },
            },
            { type: 'createdBy', name: 'Created By' },
            { type: 'lastModifiedBy', name: 'Modified By' },
            { type: 'createdTime', name: 'Created Time' },
            { type: 'lastModifiedTime', name: 'Modified Time' },
            { type: 'autoNumber', name: 'Auto Number' },
          ] as never,
        });
        hostTableId = host.id;
        const hostIds = Object.fromEntries(host.fields.map((field) => [field.name, field.id]));
        const record = await ctx.createRecord(host.id, {
          [hostIds.Row]: 'source row',
          [linkId]: [{ id: foreignRecord.id }],
        });
        await ctx.updateRecord(host.id, record.id, { [hostIds.Row]: 'modified source row' });
        await ctx.drainOutbox();

        const sourceNames = [
          'Formula',
          'Lookup Text',
          'Lookup User',
          'Rollup',
          'Conditional Lookup',
          'Conditional Rollup',
          'Created By',
          'Modified By',
          'Created Time',
          'Modified Time',
          'Auto Number',
          'Link',
        ];
        for (const name of sourceNames) {
          await readPopulatedCell(host.id, record.id, hostIds[name]);
        }

        for (const name of sourceNames) {
          await ctx.updateField({
            tableId: host.id,
            fieldId: hostIds[name],
            field: { type: 'user', options: { isMultiple, shouldNotify: false } },
          });
          expect(await readCell(host.id, record.id, hostIds[name])).toBeNull();
        }
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId);
        if (foreignTableId) await ctx.deleteTable(foreignTableId);
      }
    }
  );

  test('user multiplicity changes preserve canonical member order and null semantics', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('multiplicity'),
        fields: [
          { type: 'singleLineText', name: 'Row', isPrimary: true },
          { type: 'user', name: 'Members', options: { isMultiple: true, shouldNotify: false } },
        ],
      });
      tableId = table.id;
      const rowId = fieldByName(table.fields, 'Row').id;
      const membersId = fieldByName(table.fields, 'Members').id;
      const populated = await ctx.createRecord(table.id, {
        [rowId]: 'populated',
        [membersId]: [{ id: baseMember.id }, { id: spaceMember.id }],
      });
      const empty = await ctx.createRecord(table.id, { [rowId]: 'empty' });
      expect(await readPopulatedCell(table.id, populated.id, membersId)).toEqual([
        expect.objectContaining({
          id: baseMember.id,
          title: baseMember.name,
          email: baseMember.email,
        }),
        expect.objectContaining({
          id: spaceMember.id,
          title: spaceMember.name,
          email: spaceMember.email,
        }),
      ]);

      await ctx.updateField({
        tableId: table.id,
        fieldId: membersId,
        field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
      });
      expect(await readPopulatedCell(table.id, populated.id, membersId)).toMatchObject({
        id: baseMember.id,
        title: baseMember.name,
        email: baseMember.email,
      });
      expect(await readCell(table.id, empty.id, membersId)).toBeNull();

      await ctx.updateField({
        tableId: table.id,
        fieldId: membersId,
        field: { type: 'user', options: { isMultiple: true, shouldNotify: true } },
      });
      const wrapped = await readPopulatedCell(table.id, populated.id, membersId);
      expect(wrapped).toEqual([
        expect.objectContaining({
          id: baseMember.id,
          title: baseMember.name,
          email: baseMember.email,
        }),
      ]);
      expect(await readCell(table.id, empty.id, membersId)).toBeNull();
    } finally {
      if (tableId) await ctx.deleteTable(tableId);
    }
  });

  test.each([false, true])(
    'user → primitive targets preserves display values without leaking identity into incompatible targets (source multiple=%s)',
    async (isMultiple) => {
      let tableId: string | undefined;
      try {
        const targetCases = [
          {
            name: 'Text',
            target: { type: 'singleLineText' },
            expected: isMultiple ? `${baseMember.name}, ${spaceMember.name}` : baseMember.name,
          },
          {
            name: 'Long Text',
            target: { type: 'longText' },
            expected: isMultiple ? `${baseMember.name}, ${spaceMember.name}` : baseMember.name,
          },
          {
            name: 'Single Select',
            target: { type: 'singleSelect' },
            expected: isMultiple ? `${baseMember.name}, ${spaceMember.name}` : baseMember.name,
          },
          {
            name: 'Multiple Select',
            target: { type: 'multipleSelect' },
            expected: isMultiple ? [baseMember.name, spaceMember.name] : [baseMember.name],
          },
          { name: 'Checkbox', target: { type: 'checkbox' }, expected: true },
          { name: 'Number', target: { type: 'number' }, expected: null },
          { name: 'Rating', target: { type: 'rating', options: { max: 5 } }, expected: null },
          {
            name: 'Date',
            target: {
              type: 'date',
              options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
            },
            expected: null,
          },
          { name: 'Attachment', target: { type: 'attachment' }, expected: null },
          {
            name: 'Button',
            target: { type: 'button', options: { label: 'Run', color: 'blue' } },
            assert: (value: unknown) => {
              if (value === null) return;
              expect(value).toEqual({ count: expect.any(Number) });
              expect(value && typeof value === 'object' && 'count' in value).toBe(true);
              if (!value || typeof value !== 'object' || !('count' in value)) return;
              expect(Number.isInteger(value.count)).toBe(true);
            },
          },
        ];
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('user primitive targets'),
          fields: [
            { type: 'singleLineText', name: 'Row', isPrimary: true },
            ...targetCases.map((entry) => ({
              type: 'user',
              name: entry.name,
              options: { isMultiple, shouldNotify: false },
            })),
          ] as never,
        });
        tableId = table.id;
        const ids = Object.fromEntries(table.fields.map((field) => [field.name, field.id]));
        const fields = Object.fromEntries(
          targetCases.map((entry) => [
            ids[entry.name],
            isMultiple ? [{ id: baseMember.id }, { id: spaceMember.id }] : { id: baseMember.id },
          ])
        );
        const record = await ctx.createRecord(table.id, { [ids.Row]: 'targets', ...fields });
        for (const entry of targetCases) {
          const before = await readPopulatedCell(table.id, record.id, ids[entry.name]);
          expect(before).toEqual(
            isMultiple
              ? [
                  expect.objectContaining({
                    id: baseMember.id,
                    title: baseMember.name,
                    email: baseMember.email,
                  }),
                  expect.objectContaining({
                    id: spaceMember.id,
                    title: spaceMember.name,
                    email: spaceMember.email,
                  }),
                ]
              : expect.objectContaining({
                  id: baseMember.id,
                  title: baseMember.name,
                  email: baseMember.email,
                })
          );
        }

        for (const entry of targetCases) {
          const updated = await ctx.updateField({
            tableId: table.id,
            fieldId: ids[entry.name],
            field: entry.target as never,
          });
          expect(updated.fields.find((field) => field.id === ids[entry.name])?.type).toBe(
            entry.target.type
          );
          const value = await readCell(table.id, record.id, ids[entry.name]);
          if ('expected' in entry) {
            expect(value).toEqual(entry.expected);
          } else {
            // Incompatible targets may gain a product default later. The contract
            // here is that member identities/PII cannot survive in another shape.
            const serialized = JSON.stringify(value);
            for (const member of [baseMember, spaceMember]) {
              expect(serialized).not.toContain(member.id);
              expect(serialized).not.toContain(member.name);
              expect(serialized).not.toContain(member.email);
            }
          }
          if ('assert' in entry) entry.assert?.(value);
        }
      } finally {
        if (tableId) await ctx.deleteTable(tableId);
      }
    }
  );

  test.each([false, true])(
    'user → computed, link and system targets discards assigned identity and uses explicit target definitions (source multiple=%s)',
    async (isMultiple) => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('foreign targets'),
          fields: [
            { type: 'singleLineText', name: 'Foreign Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
          ],
        });
        foreignTableId = foreign.id;
        const foreignNameId = fieldByName(foreign.fields, 'Foreign Name').id;
        const amountId = fieldByName(foreign.fields, 'Amount').id;
        const foreignRecord = await ctx.createRecord(foreign.id, {
          [foreignNameId]: 'Foreign row',
          [amountId]: 9,
        });

        const linkId = 'fldT8238TargetLink';
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('user computed targets'),
          fields: [
            { type: 'singleLineText', name: 'Row', isPrimary: true },
            {
              type: 'link',
              id: linkId,
              name: 'Supporting Link',
              options: {
                relationship: 'manyMany',
                foreignTableId: foreign.id,
                lookupFieldId: foreignNameId,
                isOneWay: true,
              },
            },
            { type: 'createdTime', name: 'Created Time Reference' },
            { type: 'lastModifiedTime', name: 'Modified Time Reference' },
            { type: 'autoNumber', name: 'Auto Number Reference' },
            ...[
              'Formula Target',
              'Lookup Target',
              'Rollup Target',
              'Conditional Lookup Target',
              'Conditional Rollup Target',
              'Link Target',
              'Created By Target',
              'Modified By Target',
              'Created Time Target',
              'Modified Time Target',
              'Auto Number Target',
            ].map((name) => ({
              type: 'user',
              name,
              options: { isMultiple, shouldNotify: false },
            })),
          ] as never,
        });
        hostTableId = table.id;
        const ids = Object.fromEntries(table.fields.map((field) => [field.name, field.id]));
        const userFields = Object.fromEntries(
          Object.entries(ids)
            .filter(([name]) => name.endsWith('Target'))
            .map(([, id]) => [
              id,
              isMultiple ? [{ id: baseMember.id }, { id: spaceMember.id }] : { id: baseMember.id },
            ])
        );
        const record = await ctx.createRecord(table.id, {
          [ids.Row]: 'target row',
          [linkId]: [{ id: foreignRecord.id }],
          ...userFields,
        });
        await ctx.updateRecord(table.id, record.id, { [ids.Row]: 'updated target row' });
        await ctx.drainOutbox();
        const systemReferences = {
          createdTime: await readPopulatedCell(table.id, record.id, ids['Created Time Reference']),
          modifiedTime: await readPopulatedCell(
            table.id,
            record.id,
            ids['Modified Time Reference']
          ),
          autoNumber: await readPopulatedCell(table.id, record.id, ids['Auto Number Reference']),
        };
        for (const fieldId of Object.keys(userFields)) {
          const value = await readPopulatedCell(table.id, record.id, fieldId);
          expect(value).toEqual(
            isMultiple
              ? [
                  expect.objectContaining({
                    id: baseMember.id,
                    title: baseMember.name,
                    email: baseMember.email,
                  }),
                  expect.objectContaining({
                    id: spaceMember.id,
                    title: spaceMember.name,
                    email: spaceMember.email,
                  }),
                ]
              : expect.objectContaining({
                  id: baseMember.id,
                  title: baseMember.name,
                  email: baseMember.email,
                })
          );
        }

        const condition = {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: foreignNameId, operator: 'is', value: 'Foreign row' }],
          },
        };
        const targets = [
          {
            name: 'Formula Target',
            field: { type: 'formula', options: { expression: '1 + 1' } },
            assert: (value: unknown) => expect(value).toBe(2),
          },
          {
            name: 'Lookup Target',
            field: {
              type: 'lookup',
              options: {
                linkFieldId: linkId,
                foreignTableId: foreign.id,
                lookupFieldId: foreignNameId,
              },
            },
            assert: (value: unknown) => expect([value].flat()).toContain('Foreign row'),
          },
          {
            name: 'Rollup Target',
            field: {
              type: 'rollup',
              options: { expression: 'sum({values})' },
              config: { linkFieldId: linkId, foreignTableId: foreign.id, lookupFieldId: amountId },
            },
            assert: (value: unknown) => expect(value).toBe(9),
          },
          {
            name: 'Conditional Lookup Target',
            field: {
              type: 'conditionalLookup',
              options: { foreignTableId: foreign.id, lookupFieldId: foreignNameId, condition },
            },
            assert: (value: unknown) => expect([value].flat()).toContain('Foreign row'),
          },
          {
            name: 'Conditional Rollup Target',
            field: {
              type: 'conditionalRollup',
              options: { expression: 'sum({values})' },
              config: { foreignTableId: foreign.id, lookupFieldId: amountId, condition },
            },
            assert: (value: unknown) => expect(value).toBe(9),
          },
          {
            name: 'Link Target',
            field: {
              type: 'link',
              options: {
                relationship: 'manyMany',
                foreignTableId: foreign.id,
                lookupFieldId: foreignNameId,
                isOneWay: true,
              },
            },
            assert: (value: unknown) => expect(value).toBeNull(),
          },
          {
            name: 'Created By Target',
            field: { type: 'createdBy' },
            assert: (value: unknown) => expect(value).toMatchObject({ id: ctx.testUser.id }),
          },
          {
            name: 'Modified By Target',
            field: { type: 'lastModifiedBy' },
            assert: (value: unknown) => expect(value).toMatchObject({ id: ctx.testUser.id }),
          },
          {
            name: 'Created Time Target',
            field: { type: 'createdTime' },
            assert: (value: unknown) => expect(value).toEqual(systemReferences.createdTime),
          },
          {
            name: 'Modified Time Target',
            field: { type: 'lastModifiedTime' },
            assert: (value: unknown) => expect(value).toEqual(systemReferences.modifiedTime),
          },
          {
            name: 'Auto Number Target',
            field: { type: 'autoNumber' },
            assert: (value: unknown) => expect(value).toEqual(systemReferences.autoNumber),
          },
        ];

        for (const target of targets) {
          await ctx.updateField({
            tableId: table.id,
            fieldId: ids[target.name],
            field: target.field as never,
          });
          await ctx.drainOutbox();
          const value = await readCell(table.id, record.id, ids[target.name]);
          // Do not freeze default timestamps, sequences, or null initialization.
          // Every target must sever the former assigned member identity.
          const serialized = JSON.stringify(value);
          for (const member of [baseMember, spaceMember]) {
            expect(serialized).not.toContain(member.id);
            expect(serialized).not.toContain(member.name);
            expect(serialized).not.toContain(member.email);
          }
          if ('assert' in target) target.assert?.(value);
        }
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId);
        if (foreignTableId) await ctx.deleteTable(foreignTableId);
      }
    }
  );

  test('invalid formula target is a real HTTP boundary and leaves the user field unchanged', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('invalid target'),
        fields: [
          { type: 'singleLineText', name: 'Row', isPrimary: true },
          { type: 'user', name: 'Member', options: { isMultiple: false, shouldNotify: false } },
        ],
      });
      tableId = table.id;
      const memberId = fieldByName(table.fields, 'Member').id;
      const record = await ctx.createRecord(table.id, { [memberId]: { id: baseMember.id } });
      expect(await readPopulatedCell(table.id, record.id, memberId)).toMatchObject({
        id: baseMember.id,
        title: baseMember.name,
        email: baseMember.email,
      });

      await expect(
        ctx.updateField({
          tableId: table.id,
          fieldId: memberId,
          field: { type: 'formula', options: { expression: 'INVALID(' } },
        })
      ).rejects.toThrow('Failed to update field:');

      const refreshed = await ctx.getTableById(table.id);
      expect(refreshed.fields.find((field) => field.id === memberId)?.type).toBe('user');
      expect(await readPopulatedCell(table.id, record.id, memberId)).toMatchObject({
        id: baseMember.id,
        title: baseMember.name,
        email: baseMember.email,
      });
    } finally {
      if (tableId) await ctx.deleteTable(tableId);
    }
  });
});
