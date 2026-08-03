import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IFilterRo } from '@teable/core';
import { FieldKeyType, FieldType, hasAnyOf, is, Me, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
  updateViewFilter,
} from './utils/init-app';

describe('Link field filtered by view with Me (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const userId = globalThis.testConfig.userId;
  const userName = globalThis.testConfig.userName;
  const userEmail = globalThis.testConfig.email;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('link with view filter referencing Me', () => {
    let primaryTable: ITableFullVo;
    let foreignTable: ITableFullVo;
    let linkField: IFieldVo;

    beforeEach(async () => {
      const primaryFields: IFieldRo[] = [
        {
          name: 'Name',
          type: FieldType.SingleLineText,
        },
      ];

      primaryTable = await createTable(baseId, {
        name: 'link_me_primary',
        fields: primaryFields,
        records: [
          {
            fields: {
              Name: 'Row 1',
            },
          },
        ],
      });

      const foreignFields: IFieldRo[] = [
        {
          name: 'Title',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Assignee',
          type: FieldType.User,
        },
      ];

      foreignTable = await createTable(
        baseId,
        {
          name: 'link_me_foreign',
          fields: foreignFields,
          records: [
            {
              fields: {
                Title: 'Owned by me',
                Assignee: {
                  id: userId,
                  title: userName,
                  email: userEmail,
                },
              },
            },
            {
              fields: {
                Title: 'Unassigned record',
              },
            },
          ],
        },
        201
      );

      const filterByMe: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: foreignTable.fields[1].id,
              operator: is.value,
              value: Me,
            },
          ],
        },
      };

      await updateViewFilter(foreignTable.id, foreignTable.defaultViewId!, filterByMe);

      linkField = await createField(primaryTable.id, {
        name: 'Filtered Tasks',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          filterByViewId: foreignTable.defaultViewId,
        },
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, primaryTable.id);
      await permanentDeleteTable(baseId, foreignTable.id);
    });

    it('should link records respecting view filter with Me without SQL errors', async () => {
      await expect(
        updateRecordByApi(primaryTable.id, primaryTable.records[0].id, linkField.id, [
          { id: foreignTable.records[0].id },
        ])
      ).resolves.toBeDefined();

      const listResponse = await getRecords(primaryTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });
      const currentRecord = listResponse.records.find(
        (record) => record.id === primaryTable.records[0].id
      );
      const linked = currentRecord?.fields[linkField.id] as Array<{ id: string }> | undefined;
      expect(linked).toBeDefined();
      expect(linked).toHaveLength(1);
      expect(linked?.[0].id).toBe(foreignTable.records[0].id);
    });
  });

  describe('link field filter with multi-user equals Me', () => {
    let primaryTable: ITableFullVo;
    let foreignTable: ITableFullVo;
    let linkField: IFieldVo;
    let assigneesFieldId: string;
    let filterByMe: IFilterRo;

    beforeEach(async () => {
      primaryTable = await createTable(baseId, {
        name: 'link_me_multi_primary',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          {
            fields: { Name: 'Row 1' },
          },
        ],
      });

      foreignTable = await createTable(baseId, {
        name: 'link_me_multi_foreign',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Assignees',
            type: FieldType.User,
            options: { isMultiple: true },
          },
        ],
        records: [
          {
            fields: {
              Title: 'Owned by me',
              Assignees: [
                {
                  id: userId,
                  title: userName,
                  email: userEmail,
                },
              ],
            },
          },
          {
            fields: {
              Title: 'Owned by others',
              Assignees: null,
            },
          },
        ],
      });

      assigneesFieldId =
        foreignTable.fields.find((f) => f.name === 'Assignees')?.id ??
        (() => {
          throw new Error('Assignees field not found');
        })();

      filterByMe = {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: assigneesFieldId,
              operator: hasAnyOf.value,
              value: [Me],
            },
          ],
        },
      };

      linkField = await createField(primaryTable.id, {
        name: 'Filtered Candidates',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          filter: filterByMe.filter,
        },
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, primaryTable.id);
      await permanentDeleteTable(baseId, foreignTable.id);
    });

    it('should return only records assigned to current user', async () => {
      const { records } = await getRecords(foreignTable.id, {
        fieldKeyType: FieldKeyType.Id,
        filter: filterByMe.filter,
        filterLinkCellCandidate: linkField.id,
      });

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(foreignTable.records[0].id);
    });
  });

  describe('user field filter equals Me (single user)', () => {
    let table: ITableFullVo;
    const userId = globalThis.testConfig.userId;
    const userName = globalThis.testConfig.userName;
    const userEmail = globalThis.testConfig.email;
    let assigneeFieldId: string;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'user_me_filter_single',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Assignee',
            type: FieldType.User,
          },
        ],
        records: [
          {
            fields: {
              Title: 'Mine',
              Assignee: {
                id: userId,
                title: userName,
                email: userEmail,
              },
            },
          },
          {
            fields: {
              Title: 'Unassigned',
              Assignee: null,
            },
          },
        ],
      });

      assigneeFieldId =
        table.fields.find((f) => f.name === 'Assignee')?.id ??
        (() => {
          throw new Error('Assignee field not found');
        })();
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should filter records by Me without SQL errors', async () => {
      const { records } = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: assigneeFieldId,
              operator: is.value,
              value: Me,
            },
          ],
        },
      });

      expect(records).toHaveLength(1);
      expect(records[0].fields[assigneeFieldId]).toMatchObject({ id: userId });
    });
  });
});
