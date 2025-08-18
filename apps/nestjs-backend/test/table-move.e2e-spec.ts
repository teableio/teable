/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions, ILookupOptionsVo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createBase,
  createField,
  createPluginPanel,
  createTable,
  deleteBase,
  getRecords,
  getTableList,
  installPluginPanel,
  moveTable,
  updatePluginPanelStorage,
} from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import { getFields, initApp } from './utils/init-app';

describe('Template Open API Controller (e2e)', () => {
  let app: INestApplication;
  const spaceId = globalThis.testConfig.spaceId;
  let baseId1: string;
  let baseId2: string;
  let baseId3: string;
  let base1Table: ITableFullVo;
  let base1SubTable: ITableFullVo;

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const { id } = (
      await createBase({
        name: 'base-1',
        spaceId,
      })
    ).data;
    baseId1 = id;

    baseId3 = (
      await createBase({
        name: 'base-3',
        spaceId,
      })
    ).data.id;

    base1Table = (
      await createTable(baseId1, {
        // over 63 characters
        name: 'record_query_long_long_long_long_long_long_long_long_long_long_long_long',
        fields: x_20.fields,
        records: x_20.records,
      })
    ).data;

    const x20Link = x_20_link(base1Table);
    base1SubTable = (
      await createTable(baseId1, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      })
    ).data;

    const x20LinkFromLookups = x_20_link_from_lookups(base1Table, base1SubTable.fields[2].id);
    for (const field of x20LinkFromLookups.fields) {
      await createField(base1SubTable.id, field);
    }

    // create panel plugin
    const panelPlugin = (
      await createPluginPanel(base1SubTable.id, {
        name: 'panel-plugin',
      })
    ).data;

    const panelInstalledPlugin1 = (
      await installPluginPanel(base1SubTable.id, panelPlugin.id, {
        name: 'panel-plugin-1',
        pluginId: 'plgchart',
      })
    ).data;

    const textField = base1SubTable.fields.find((field) => field.type === FieldType.SingleLineText);
    const numberField = base1SubTable.fields.find((field) => field.type === FieldType.Number);

    await updatePluginPanelStorage(
      base1SubTable.id,
      panelPlugin.id,
      panelInstalledPlugin1.pluginInstallId,
      {
        storage: {
          query: {
            from: base1SubTable.id,
            select: [
              { column: textField?.id, alias: textField?.name, type: 'field' },
              { column: numberField?.id, alias: numberField?.name, type: 'field' },
            ],
          },
          config: {
            type: 'bar',
            xAxis: [{ column: textField?.name, display: { type: 'bar', position: 'auto' } }],
            yAxis: [{ column: numberField?.name, display: { type: 'bar', position: 'auto' } }],
          },
        },
      }
    );

    const { id: id2 } = (
      await createBase({
        name: 'base-2',
        spaceId,
      })
    ).data;
    baseId2 = id2;
  });

  afterEach(async () => {
    await deleteBase(baseId1);
    await deleteBase(baseId2);
    await deleteBase(baseId3);
  });

  it('should move a full type table to target base', async () => {
    const beforeMoveFields = await getFields(base1SubTable.id);
    const beforeMoveRecords = await getRecords(base1SubTable.id);

    const beforeMoveLinkSourceTableFields = await getFields(base1Table.id);

    await moveTable(baseId1, base1SubTable.id, {
      baseId: baseId2,
    });

    const afterMoveFields = await getFields(base1SubTable.id);

    const afterMoveRecords = await getRecords(base1SubTable.id);

    const afterMoveLinkSourceTableFields = await getFields(base1Table.id);

    const sourceBaseTables = (await getTableList(baseId1)).data;

    const sourceBaseTableIds = sourceBaseTables
      .map(({ id }) => id)
      .filter((id) => id !== base1SubTable.id);

    const assertFields = beforeMoveFields.map((field) => {
      const newField = { ...field };
      if (field.type === FieldType.Link) {
        newField.options = {
          ...newField.options,
          fkHostTableName: (newField.options as ILinkFieldOptions).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        };

        if (sourceBaseTableIds.includes((newField.options as ILinkFieldOptions).foreignTableId)) {
          newField.options = {
            ...newField.options,
            baseId: baseId1,
          };
        }

        if ((newField.options as ILinkFieldOptions)?.baseId === baseId2) {
          delete (newField.options as ILinkFieldOptions).baseId;
        }
      }

      if (field.isLookup) {
        newField.lookupOptions = {
          ...newField.lookupOptions,
          fkHostTableName: (newField.lookupOptions as ILookupOptionsVo).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        } as ILookupOptionsVo;
      }
      return newField;
    });

    expect(afterMoveFields).toEqual(assertFields);
    expect(afterMoveRecords.data.records).toEqual(beforeMoveRecords.data.records);

    // test source base' other table which has link field with source table
    const assertLinkSourceTableFields = beforeMoveLinkSourceTableFields.map((field) => {
      const newField = { ...field };
      if (field.type === FieldType.Link) {
        newField.options = {
          ...newField.options,
          fkHostTableName: (newField.options as ILinkFieldOptions).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        };

        if ((newField.options as ILinkFieldOptions).foreignTableId === base1SubTable.id) {
          (newField.options as ILinkFieldOptions).baseId = baseId2;
        }
      }
      return newField;
    });

    expect(afterMoveLinkSourceTableFields).toEqual(assertLinkSourceTableFields);
  });

  it(`should move source table to target base which source base's table has link field with source table`, async () => {
    const base2Table = (
      await createTable(baseId2, {
        name: 'base2-table',
      })
    ).data;

    const textField = base1SubTable.fields.find(
      (field) => field.type === FieldType.SingleLineText
    )!;

    const linkField = (
      await createField(base2Table.id, {
        name: 'link-field',
        type: FieldType.Link,
        options: {
          baseId: baseId1,
          foreignTableId: base1SubTable.id,
          relationship: Relationship.ManyMany,
        },
      })
    ).data;

    await createField(base2Table.id, {
      name: 'lookup-field',
      isLookup: true,
      options: {},
      lookupOptions: {
        foreignTableId: base1SubTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: textField.id,
      },
      type: textField.type,
    });

    const beforeTargetBaseTablesFields = await getFields(base2Table.id);

    await moveTable(baseId1, base1SubTable.id, {
      baseId: baseId2,
    });

    const afterTargetBaseTablesFields = await getFields(base2Table.id);

    const assertTargetBaseTablesFields = beforeTargetBaseTablesFields.map((field) => {
      const newField = { ...field };
      if (field.type === FieldType.Link) {
        newField.options = {
          ...newField.options,
          fkHostTableName: (newField.options as ILinkFieldOptions).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        };

        if ((newField.options as ILinkFieldOptions).baseId === baseId1) {
          delete (newField.options as ILinkFieldOptions).baseId;
        }
      }

      if (field.isLookup) {
        newField.lookupOptions = {
          ...newField.lookupOptions,
          fkHostTableName: (newField.lookupOptions as ILookupOptionsVo).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        } as ILookupOptionsVo;
      }

      return newField;
    });

    expect(afterTargetBaseTablesFields).toEqual(assertTargetBaseTablesFields);
  });

  it(`should move source table to target base which third base table link the source table's field`, async () => {
    const base3Table = (
      await createTable(baseId3, {
        name: 'base3-table',
      })
    ).data;

    const textField = base1SubTable.fields.find(
      (field) => field.type === FieldType.SingleLineText
    )!;

    const linkField = (
      await createField(base3Table.id, {
        name: 'link-field',
        type: FieldType.Link,
        options: {
          baseId: baseId1,
          foreignTableId: base1SubTable.id,
          relationship: Relationship.ManyMany,
        },
      })
    ).data;

    await createField(base3Table.id, {
      name: 'lookup-field',
      isLookup: true,
      options: {},
      lookupOptions: {
        foreignTableId: base1SubTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: textField.id,
      },
      type: textField.type,
    });

    const beforeTargetBaseTablesFields = await getFields(base3Table.id);

    await moveTable(baseId1, base1SubTable.id, {
      baseId: baseId2,
    });

    const afterTargetBaseTablesFields = await getFields(base3Table.id);

    const assertTargetBaseTablesFields = beforeTargetBaseTablesFields.map((field) => {
      const newField = { ...field };
      if (field.type === FieldType.Link) {
        newField.options = {
          ...newField.options,
          fkHostTableName: (newField.options as ILinkFieldOptions).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        };

        if ((newField.options as ILinkFieldOptions).baseId === baseId1) {
          (newField.options as ILinkFieldOptions).baseId = baseId2;
        }
      }

      if (field.isLookup) {
        newField.lookupOptions = {
          ...newField.lookupOptions,
          fkHostTableName: (newField.lookupOptions as ILookupOptionsVo).fkHostTableName.replace(
            `${baseId1}`,
            `${baseId2}`
          ),
        } as ILookupOptionsVo;
      }

      return newField;
    });

    expect(afterTargetBaseTablesFields).toEqual(assertTargetBaseTablesFields);
  });
});
