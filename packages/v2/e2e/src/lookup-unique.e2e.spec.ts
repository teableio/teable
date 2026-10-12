import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('lookup unique values through the HTTP API', () => {
  let ctx: SharedTestContext;
  let counter = 0;
  const fieldId = () => `fld${(counter++).toString(36).padStart(16, '0')}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test.each(['lookup', 'conditionalLookup'] as const)(
    '%s keeps numeric and boolean types and leaves an empty lookup empty',
    async (type) => {
      const titleId = fieldId();
      const numberId = fieldId();
      const checkboxId = fieldId();
      const hostTitleId = fieldId();
      const linkId = fieldId();
      const numberLookupId = fieldId();
      const checkboxLookupId = fieldId();
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Scalar source',
        fields: [
          { type: 'singleLineText', id: titleId, name: 'Name', isPrimary: true },
          { type: 'number', id: numberId, name: 'Number' },
          { type: 'checkbox', id: checkboxId, name: 'Checked' },
        ],
        records: [
          { fields: { [titleId]: 'Match', [numberId]: 0, [checkboxId]: true } },
          { fields: { [titleId]: 'Match', [numberId]: 0, [checkboxId]: true } },
          { fields: { [titleId]: 'Match', [numberId]: 2 } },
          { fields: { [titleId]: 'Match' } },
        ],
      });
      let hostId: string | undefined;
      try {
        const sourceRecords = await ctx.listRecords(foreign.id);
        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Scalar host',
          fields: [
            { type: 'singleLineText', id: hostTitleId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkId,
              name: 'Sources',
              options: {
                foreignTableId: foreign.id,
                lookupFieldId: titleId,
                relationship: 'manyMany',
              },
            },
          ],
        });
        hostId = host.id;
        const populated = await ctx.createRecord(host.id, {
          [hostTitleId]: 'Match',
          [linkId]: sourceRecords.map(({ id }) => ({ id })),
        });
        const empty = await ctx.createRecord(host.id, { [hostTitleId]: 'No match' });
        for (const [id, lookupFieldId] of [
          [numberLookupId, numberId],
          [checkboxLookupId, checkboxId],
        ]) {
          const common = { foreignTableId: foreign.id, lookupFieldId, isUnique: true };
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: host.id,
            field:
              type === 'lookup'
                ? {
                    type,
                    id,
                    name: `Unique ${lookupFieldId}`,
                    options: { ...common, linkFieldId: linkId },
                  }
                : {
                    type,
                    id,
                    name: `Unique ${lookupFieldId}`,
                    options: {
                      ...common,
                      condition: {
                        filter: {
                          conjunction: 'and',
                          filterSet: [
                            {
                              fieldId: titleId,
                              operator: 'is',
                              value: hostTitleId,
                              isSymbol: true,
                            },
                          ],
                        },
                      },
                    },
                  },
          });
        }
        await ctx.drainOutbox();
        const records = await ctx.listRecords(host.id);
        const values = records.find(({ id }) => id === populated.id)?.fields;
        expect(values?.[numberLookupId]).toEqual([0, 2]);
        expect(values?.[checkboxLookupId]).toEqual([true]);
        const emptyValues = records.find(({ id }) => id === empty.id)?.fields;
        for (const id of [numberLookupId, checkboxLookupId]) {
          expect(emptyValues?.[id] ?? null).toBeNull();
        }
      } finally {
        if (hostId) await ctx.deleteTable(hostId);
        await ctx.deleteTable(foreign.id);
      }
    }
  );

  test.each(['lookup', 'conditionalLookup'] as const)(
    '%s preserves duplicates by default and recalculates when uniqueness changes',
    async (type) => {
      const titleId = fieldId();
      const valueId = fieldId();
      const hostTitleId = fieldId();
      const linkId = fieldId();
      const lookupId = fieldId();
      const countId = fieldId();
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Unique value source',
        fields: [
          { type: 'singleLineText', id: titleId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: valueId, name: 'Value' },
        ],
        records: [
          { fields: { [titleId]: 'Source one', [valueId]: 'Alpha' } },
          { fields: { [titleId]: 'Source two', [valueId]: 'Alpha' } },
          { fields: { [titleId]: 'Source three', [valueId]: 'Beta' } },
        ],
      });
      let hostId: string | undefined;
      try {
        const foreignRecords = await ctx.listRecords(foreign.id);
        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Unique value host',
          fields: [
            { type: 'singleLineText', id: hostTitleId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkId,
              name: 'Sources',
              options: {
                relationship: 'manyMany',
                foreignTableId: foreign.id,
                lookupFieldId: titleId,
              },
            },
          ],
        });
        hostId = host.id;
        await ctx.createRecord(host.id, {
          [hostTitleId]: 'Host',
          [linkId]: foreignRecords.map(({ id }) => ({ id })),
        });
        const options =
          type === 'lookup'
            ? { foreignTableId: foreign.id, lookupFieldId: valueId, linkFieldId: linkId }
            : {
                foreignTableId: foreign.id,
                lookupFieldId: valueId,
                condition: {
                  filter: {
                    conjunction: 'and' as const,
                    filterSet: [{ fieldId: titleId, operator: 'isNotEmpty' as const, value: null }],
                  },
                },
              };
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: { type, id: lookupId, name: 'Values', options },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'formula',
            id: countId,
            name: 'Value count',
            options: { expression: `COUNTALL({${lookupId}})` },
          },
        });
        await ctx.drainOutbox();
        const values = async () => (await ctx.listRecords(host.id))[0].fields[lookupId];
        const count = async () => (await ctx.listRecords(host.id))[0].fields[countId];
        expect(await values()).toEqual(['Alpha', 'Alpha', 'Beta']);
        expect(await count()).toBe(3);

        await ctx.updateField({
          tableId: host.id,
          fieldId: lookupId,
          field: { type, options: { isUnique: true } },
        });
        await ctx.drainOutbox();
        const enabledTable = await ctx.getTableById(host.id);
        expect(enabledTable.fields.find(({ id }) => id === lookupId)).toMatchObject(
          type === 'lookup'
            ? { lookupOptions: { isUnique: true } }
            : { conditionalLookupOptions: { isUnique: true } }
        );
        expect(await values()).toEqual(['Alpha', 'Beta']);
        expect(await count()).toBe(2);

        await ctx.updateRecord(foreign.id, foreignRecords[2].id, { [valueId]: 'Alpha' });
        await ctx.drainOutbox();
        expect(await values()).toEqual(['Alpha']);
        expect(await count()).toBe(1);

        await ctx.updateField({
          tableId: host.id,
          fieldId: lookupId,
          field: { type, options: { ...options, isUnique: false } },
        });
        await ctx.drainOutbox();
        expect(await values()).toEqual(['Alpha', 'Alpha', 'Alpha']);
        expect(await count()).toBe(3);
        const disabledTable = await ctx.getTableById(host.id);
        expect(disabledTable.fields.find(({ id }) => id === lookupId)).toMatchObject(
          type === 'lookup'
            ? { lookupOptions: { isUnique: false } }
            : { conditionalLookupOptions: { isUnique: false } }
        );
      } finally {
        if (hostId) await ctx.deleteTable(hostId);
        await ctx.deleteTable(foreign.id);
      }
    }
  );

  test.each(['lookup', 'conditionalLookup'] as const)(
    '%s flattens multi-select values and preserves distinct users with the same name',
    async (type) => {
      const titleId = fieldId();
      const tagsId = fieldId();
      const usersId = fieldId();
      const hostTitleId = fieldId();
      const linkId = fieldId();
      const uniqueTagsId = fieldId();
      const uniqueUsersId = fieldId();
      const otherUser = { id: 'usrUniqueOtherPerson', title: ctx.testUser.name };
      const currentUser = { id: ctx.testUser.id, title: ctx.testUser.name };
      await ctx.testContainer.db
        .insertInto('users')
        .values({
          id: otherUser.id,
          name: otherUser.title,
          email: 'unique-other@example.test',
        })
        .execute();
      await ctx.testContainer.db
        .insertInto('collaborator')
        .values({
          id: `col${otherUser.id}`,
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: otherUser.id,
          principal_type: 'user',
        })
        .execute();
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Multi value source',
        fields: [
          { type: 'singleLineText', id: titleId, name: 'Name', isPrimary: true },
          {
            type: 'multipleSelect',
            id: tagsId,
            name: 'Tags',
            options: {
              choices: [
                { id: 'choAlpha', name: 'Alpha', color: 'blue' },
                { id: 'choBeta', name: 'Beta', color: 'green' },
                { id: 'choGamma', name: 'Gamma', color: 'red' },
              ],
            },
          },
          {
            type: 'user',
            id: usersId,
            name: 'People',
            options: { isMultiple: true, shouldNotify: false },
          },
        ],
      });
      let hostId: string | undefined;
      try {
        const first = await ctx.createRecord(foreign.id, {
          [titleId]: 'First',
          [tagsId]: ['Beta', 'Alpha'],
          [usersId]: [currentUser],
        });
        const second = await ctx.createRecord(foreign.id, {
          [titleId]: 'Second',
          [tagsId]: ['Alpha', 'Gamma'],
          [usersId]: [currentUser, otherUser],
        });
        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Multi value host',
          fields: [
            { type: 'singleLineText', id: hostTitleId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkId,
              name: 'Sources',
              options: {
                relationship: 'manyMany',
                foreignTableId: foreign.id,
                lookupFieldId: titleId,
              },
            },
          ],
        });
        hostId = host.id;
        await ctx.createRecord(host.id, {
          [hostTitleId]: 'Host',
          [linkId]: [{ id: first.id }, { id: second.id }],
        });
        for (const [id, lookupFieldId] of [
          [uniqueTagsId, tagsId],
          [uniqueUsersId, usersId],
        ]) {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: host.id,
            field: {
              type,
              id,
              name: `Unique ${lookupFieldId}`,
              options: {
                ...(type === 'lookup'
                  ? { linkFieldId: linkId }
                  : {
                      condition: {
                        filter: {
                          conjunction: 'and' as const,
                          filterSet: [{ fieldId: titleId, operator: 'isNotEmpty' as const }],
                        },
                      },
                    }),
                foreignTableId: foreign.id,
                lookupFieldId,
                isUnique: true,
              },
            },
          });
        }
        await ctx.drainOutbox();
        const [record] = await ctx.listRecords(host.id);
        expect(record.fields[uniqueTagsId]).toEqual(['Beta', 'Alpha', 'Gamma']);
        expect(record.fields[uniqueUsersId]).toMatchObject([currentUser, otherUser]);
        expect(record.fields[uniqueUsersId]).toHaveLength(2);
      } finally {
        if (hostId) await ctx.deleteTable(hostId);
        await ctx.deleteTable(foreign.id);
        await ctx.testContainer.db
          .deleteFrom('collaborator')
          .where('principal_id', '=', otherUser.id)
          .execute();
        await ctx.testContainer.db.deleteFrom('users').where('id', '=', otherUser.id).execute();
      }
    }
  );
});
