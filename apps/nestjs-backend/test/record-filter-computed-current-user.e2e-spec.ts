import type { INestApplication } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import { FieldKeyType, FieldType, Me, Relationship, hasAnyOf } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords } from '@teable/openapi';
import {
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateViewFilter,
} from './utils/init-app';

describe('Computed user filter with current user (e2e)', () => {
  let app: INestApplication;
  let source: ITableFullVo;
  let target: ITableFullVo;
  let lookupFieldId: string;
  const baseId = globalThis.testConfig.baseId;
  const actorId = globalThis.testConfig.userId;

  beforeAll(async () => {
    ({ app } = await initApp());
    source = await createTable(baseId, {
      name: 'computed_user_source',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Assignee',
          type: FieldType.User,
          options: { isMultiple: false, shouldNotify: false, defaultValue: 'me' },
        },
      ],
      records: [
        { fields: { Name: 'Assigned', Assignee: { id: actorId, title: 'Test User' } } },
        { fields: { Name: 'Unassigned', Assignee: null } },
      ],
    });
    const sourceUserField = source.fields.find((field) => field.name === 'Assignee')!;
    const sourceRecords = await apiGetRecords(source.id, { fieldKeyType: FieldKeyType.Id });
    expect(
      sourceRecords.data.records.find((record) => record.id === source.records[0].id)?.fields[
        sourceUserField.id
      ]
    ).toMatchObject({ id: actorId });
    expect(
      sourceRecords.data.records.find((record) => record.id === source.records[1].id)?.fields[
        sourceUserField.id
      ] ?? null
    ).toBeNull();

    target = await createTable(baseId, {
      name: 'computed_user_target',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Sources',
          type: FieldType.Link,
          options: { relationship: Relationship.OneMany, foreignTableId: source.id },
        },
      ],
      records: [
        { fields: { Name: 'Matching', Sources: [{ id: source.records[0].id }] } },
        { fields: { Name: 'Nonmatching', Sources: [{ id: source.records[1].id }] } },
        { fields: { Name: 'Empty' } },
      ],
    });
    const linkFieldId = target.fields.find((field) => field.name === 'Sources')!.id;
    const lookupOptions = {
      foreignTableId: source.id,
      linkFieldId,
      lookupFieldId: sourceUserField.id,
    };
    lookupFieldId = (
      await createField(target.id, {
        name: 'Assignee lookup',
        type: FieldType.User,
        isLookup: true,
        lookupOptions,
      })
    ).id;
  });

  afterAll(async () => {
    if (target) await permanentDeleteTable(baseId, target.id);
    if (source) await permanentDeleteTable(baseId, source.id);
    await app?.close();
  });

  afterEach(async () => {
    if (target) await updateViewFilter(target.id, target.views[0].id, { filter: null });
  });

  it.each(['query', 'saved view'] as const)(
    'filters user lookup by current user through %s',
    async (entry) => {
      const fieldId = lookupFieldId;
      const unfiltered = await apiGetRecords(target.id, { fieldKeyType: FieldKeyType.Id });
      expect(unfiltered.data.records).toHaveLength(3);
      expect(
        unfiltered.data.records.find((record) => record.id === target.records[0].id)?.fields[
          fieldId
        ]
      ).toEqual(expect.arrayContaining([expect.objectContaining({ id: actorId })]));

      const filterFor = (value: string): IFilter => ({
        conjunction: 'and',
        filterSet: [{ fieldId, operator: hasAnyOf.value, value: [value] }],
      });
      const assertMatchingRecord = (response: Awaited<ReturnType<typeof apiGetRecords>>) => {
        expect(response.status).toBe(200);
        if (process.env.FORCE_V2_ALL === 'true') {
          expect(response.headers['x-teable-v2']).toBe('true');
          expect(response.headers['x-teable-v2-feature']).toBe('getRecords');
        }
        expect(response.data.records.map((record) => record.id)).toEqual([target.records[0].id]);
      };

      for (const value of [actorId, Me]) {
        if (entry === 'query') {
          assertMatchingRecord(
            await apiGetRecords(target.id, {
              fieldKeyType: FieldKeyType.Id,
              filter: filterFor(value),
            })
          );
        } else {
          await updateViewFilter(target.id, target.views[0].id, { filter: filterFor(value) });
          assertMatchingRecord(
            await apiGetRecords(target.id, {
              fieldKeyType: FieldKeyType.Id,
              viewId: target.views[0].id,
            })
          );
        }
      }
    }
  );
});
