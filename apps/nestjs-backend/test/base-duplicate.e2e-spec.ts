/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, ILookupOptionsRo } from '@teable/core';
import {
  DriverClient,
  FieldAIActionType,
  FieldKeyType,
  FieldType,
  Relationship,
  Role,
  ViewType,
} from '@teable/core';
import type { ICreateBaseVo, ICreateSpaceVo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  CREATE_SPACE,
  createBase,
  createBaseNode,
  createDashboard,
  createField,
  createPluginPanel,
  createSpace,
  deleteBase,
  deleteRecords,
  deleteSpace,
  duplicateBase,
  EMAIL_SPACE_INVITATION,
  getBaseList,
  getBaseNodeTree,
  getDashboard,
  getDashboardInstallPlugin,
  getDashboardList,
  getField,
  getFields,
  getPluginPanel,
  getPluginPanelPlugin,
  getTableList,
  getViewList,
  installPlugin,
  installPluginPanel,
  installViewPlugin,
  listPluginPanels,
  LLMProviderType,
  moveBaseNode,
  updateSetting,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  convertField,
  createRecords,
  createTable,
  getRecords,
  initApp,
  updateRecord,
  permanentDeleteBase,
} from './utils/init-app';

describe('OpenAPI Base Duplicate (e2e)', () => {
  let app: INestApplication;
  let base: ICreateBaseVo;
  let spaceId: string;
  let newUserAxios: AxiosInstance;
  let duplicateBaseId: string | undefined;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    newUserAxios = await createNewUserAxios({
      email: 'test@gmail.com',
      password: '12345678',
    });

    const space = await newUserAxios.post<ICreateSpaceVo>(CREATE_SPACE, {
      name: 'test space',
    });
    spaceId = space.data.id;
    await newUserAxios.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId }), {
      role: Role.Owner,
      emails: [globalThis.testConfig.email],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    base = (await createBase({ spaceId, name: 'test base' })).data;
  });

  afterEach(async () => {
    await permanentDeleteBase(base.id);
    if (duplicateBaseId) {
      await permanentDeleteBase(duplicateBaseId);
      duplicateBaseId = undefined;
    }
  });

  if (globalThis.testConfig.driver !== DriverClient.Pg) {
    expect(true).toBeTruthy();
    return;
  }

  it('duplicate base with cross base link and lookup field', async () => {
    const base2 = (await createBase({ spaceId, name: 'test base 2' })).data;
    const base2Table = await createTable(base2.id, { name: 'table1' });

    const table1 = await createTable(base.id, { name: 'table1' });

    const crossBaseLinkField = (
      await createField(table1.id, {
        name: 'cross base link field',
        type: FieldType.Link,
        options: {
          baseId: base2.id,
          relationship: Relationship.ManyMany,
          foreignTableId: base2Table.id,
        },
      })
    ).data;

    await createField(table1.id, {
      name: 'cross base lookup field',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: base2Table.id,
        linkFieldId: crossBaseLinkField.id,
        lookupFieldId: base2Table.fields[0].id,
      },
    });

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
    });

    expect(dupResult.status).toBe(201);
  });

  it('duplicate within current space', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
    });

    const getResult = await getTableList(dupResult.data.id);
    const records = await getRecords(getResult.data[0].id);
    expect(records.records.length).toBe(0);

    expect(getResult.data.length).toBe(1);
    expect(getResult.data[0].name).toBe(table1.name);
    expect(getResult.data[0].id).not.toBe(table1.id);
    await deleteBase(dupResult.data.id);
  });

  it('duplicate with records', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const preRecords = await getRecords(table1.id);
    await updateRecord(table1.id, preRecords.records[0].id, {
      record: { fields: { [table1.fields[0].name]: 'new value' } },
    });

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const getResult = await getTableList(dupResult.data.id);

    const records = await getRecords(getResult.data[0].id);
    expect(records.records[0].lastModifiedBy).toBeFalsy();
    expect(records.records[0].createdTime).toBeTruthy();
    expect(records.records[0].fields[table1.fields[0].name]).toEqual('new value');
    expect(records.records.length).toBe(3);

    await deleteBase(dupResult.data.id);
  });

  it('duplicate base with tables which have primary formula field, expression with link field', async () => {
    const table1 = await createTable(base.id, {
      name: 'table1',
    });
    const table2 = await createTable(base.id, { name: 'table2' });

    const fields = (await getFields(table1.id)).data;

    const primaryField = fields.find(({ isPrimary }) => isPrimary)!;
    // const numberField = fields.find(({ type }) => type === FieldType.Number)!;

    const formulaRelyLinkField = (
      await createField(table1.id, {
        name: 'link field1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: table2.id },
      })
    ).data;

    const formulaPrimaryField = await convertField(table1.id, primaryField.id, {
      name: 'formula field',
      type: FieldType.Formula,
      options: { expression: `{${formulaRelyLinkField.id}}`, timeZone: 'Asia/Shanghai' },
    });

    await createField(table2.id, {
      name: 'link field',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: table1.id },
    });

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const { id: baseId } = dupResult.data;
    const tables = await getTableList(baseId);

    const duplicateTable1 = tables.data.find(({ name }) => name === table1.name);
    const duplicateTable1Fields = (await getFields(duplicateTable1!.id)).data;
    const duplicateTable1FormulaField = duplicateTable1Fields.find(
      ({ type }) => type === FieldType.Formula
    );
    expect(duplicateTable1FormulaField?.cellValueType).toBe(formulaPrimaryField.cellValueType);
    expect(duplicateTable1FormulaField?.dbFieldType).toBe(formulaPrimaryField.dbFieldType);

    expect(dupResult.status).toBe(201);
  });

  it('duplicate base with link field', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const table2 = await createTable(base.id, { name: 'table2' });

    // create link field
    const table2LinkFieldRo: IFieldRo = {
      name: 'link field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table1.id,
      },
    };

    const table2LinkField = (await createField(table2.id, table2LinkFieldRo)).data;

    const symmetricField = (
      await getField(
        table1.id,
        (table2LinkField.options as ILinkFieldOptions).symmetricFieldId as string
      )
    )?.data;

    // update recording link field to one way
    await convertField(table1.id, symmetricField?.id as string, {
      type: FieldType.Link,
      name: symmetricField.name,
      dbFieldName: symmetricField.dbFieldName,
      options: {
        ...symmetricField?.options,
        relationship: Relationship.OneMany,
      } as ILinkFieldOptions,
    });

    await convertField(table1.id, symmetricField?.id as string, {
      type: FieldType.Link,
      name: symmetricField.name,
      dbFieldName: symmetricField.dbFieldName,
      options: {
        ...symmetricField?.options,
        relationship: Relationship.ManyMany,
      } as ILinkFieldOptions,
    });

    // create lookup field
    const table2LookupFieldRo: IFieldRo = {
      name: 'lookup field',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: table1.id,
        linkFieldId: table2LinkField.id,
        lookupFieldId: table1.fields[0].id,
      } as ILookupOptionsRo,
    };

    const table2LookupField = (await createField(table2.id, table2LookupFieldRo)).data;

    const table1LinkField = (
      await getField(
        table1.id,
        (table2LinkField.options as ILinkFieldOptions).symmetricFieldId as string
      )
    ).data;

    const table1Records = await getRecords(table1.id);
    const table2Records = await getRecords(table2.id);
    // update record before copy
    await updateRecord(table2.id, table2Records.records[0].id, {
      record: { fields: { [table2LinkField.name]: [{ id: table1Records.records[0].id }] } },
    });
    await updateRecord(table1.id, table1Records.records[0].id, {
      record: { fields: { [table1.fields[0].name]: 'text 1' } },
    });

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });
    const newBaseId = dupResult.data.id;

    const getResult = await getTableList(newBaseId);
    const newTable1 = getResult.data[0];
    const newTable2 = getResult.data[1];

    const newTable1Records = await getRecords(newTable1.id);
    const newTable2Records = await getRecords(newTable2.id);
    expect(newTable1Records.records[0].lastModifiedBy).toBeFalsy();
    expect(newTable1Records.records[0].createdTime).toBeTruthy();
    expect(newTable1Records.records[0].fields[table1LinkField.name]).toMatchObject([
      {
        id: newTable2Records.records[0].id,
      },
    ]);
    expect(newTable2Records.records[0].fields[table2LookupField.name]).toEqual(['text 1']);
    expect(newTable1Records.records.length).toBe(3);

    // update record in duplicated table
    await updateRecord(newTable2.id, table2Records.records[0].id, {
      record: { fields: { [table2LinkField.name]: [{ id: table1Records.records[1].id }] } },
    });
    await updateRecord(newTable1.id, table1Records.records[2].id, {
      record: { fields: { [table1LinkField.name]: [{ id: table2Records.records[2].id }] } },
    });
    await updateRecord(newTable1.id, table1Records.records[1].id, {
      record: { fields: { [table1.fields[0].name]: 'text 2' } },
    });

    const newTable1RecordsAfter = await getRecords(newTable1.id);
    const newTable2RecordsAfter = await getRecords(newTable2.id);
    expect(newTable1RecordsAfter.records[0].fields[table1LinkField.name]).toBeUndefined();
    expect(newTable1RecordsAfter.records[1].fields[table1LinkField.name]).toMatchObject([
      {
        id: newTable2Records.records[0].id,
      },
    ]);
    expect(newTable2RecordsAfter.records[2].fields[table2LinkField.name]).toMatchObject([
      {
        id: newTable1Records.records[2].id,
      },
    ]);
    expect(newTable2RecordsAfter.records[0].fields[table2LookupField.name]).toEqual(['text 2']);

    await deleteBase(dupResult.data.id);
  });

  it('should autoNumber work in a duplicated table', async () => {
    await createTable(base.id, { name: 'table1' });
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const getResult = await getTableList(dupResult.data.id);
    const newTable = getResult.data[0];

    await createRecords(newTable.id, { records: [{ fields: {} }] });

    const records = await getRecords(newTable.id);
    expect(records.records[records.records.length - 1].autoNumber).toEqual(records.records.length);
    expect(records.records.length).toBe(4);
    await deleteBase(dupResult.data.id);
  });

  it('should duplicate ai field relative config', async () => {
    const tableWithAiField = await createTable(base.id, { name: 'table-ai-field' });

    const aiSetting = (
      await updateSetting({
        aiConfig: {
          enable: true,
          llmProviders: [
            {
              apiKey: 'test-ai-config',
              baseUrl: 'localhost:3000/api/test',
              models: 'test-e2e',
              name: 'test',
              type: LLMProviderType.ANTHROPIC,
            },
          ],
        },
      })
    ).data;

    const codingModel = aiSetting.aiConfig?.llmProviders[0].models;

    const aiField = (
      await createField(tableWithAiField.id, {
        name: 'ai field',
        type: FieldType.SingleLineText,
        aiConfig: {
          attachPrompt: 'test-attach-prompt',
          modelKey: codingModel,
          sourceFieldId: tableWithAiField.fields[0].id,
          type: FieldAIActionType.Summary,
        },
      })
    ).data;

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const tableList = await getTableList(dupResult.data.id);
    const duplicatedTableWithAiField = tableList.data.find(
      ({ name }) => name === tableWithAiField.name
    );
    const duplicatedFields = (await getFields(duplicatedTableWithAiField!.id)).data;
    const duplicatedAiField = duplicatedFields.find((f) => f.aiConfig);
    expect(duplicatedAiField?.aiConfig).toEqual({
      ...aiField.aiConfig,
      sourceFieldId: duplicatedFields[0].id,
    });

    await deleteBase(dupResult.data.id);
  });

  it('should duplicate the base with node [Folder, Table, Dashboard]', async () => {
    const nodeBaseId = base.id;

    // Create folders using createBaseNode
    const folder1Node = await createBaseNode(nodeBaseId, {
      resourceType: BaseNodeResourceType.Folder,
      name: 'Folder 1',
    }).then((res) => res.data);
    const folder2Node = await createBaseNode(nodeBaseId, {
      resourceType: BaseNodeResourceType.Folder,
      name: 'Folder 2',
    }).then((res) => res.data);

    // Create tables using createBaseNode
    const table1Node = await createBaseNode(nodeBaseId, {
      resourceType: BaseNodeResourceType.Table,
      name: 'Table 1',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      views: [{ name: 'Grid view', type: ViewType.Grid }],
    }).then((res) => res.data);
    const table2Node = await createBaseNode(nodeBaseId, {
      resourceType: BaseNodeResourceType.Table,
      name: 'Table 2',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      views: [{ name: 'Grid view', type: ViewType.Grid }],
    }).then((res) => res.data);

    // Create dashboards using createBaseNode
    const dashboard1Node = await createBaseNode(nodeBaseId, {
      resourceType: BaseNodeResourceType.Dashboard,
      name: 'Dashboard 1',
    }).then((res) => res.data);
    const dashboard2Node = await createBaseNode(nodeBaseId, {
      resourceType: BaseNodeResourceType.Dashboard,
      name: 'Dashboard 2',
    }).then((res) => res.data);

    // Move table1 into folder1 and dashboard1 into folder2
    await moveBaseNode(nodeBaseId, table1Node.id, { parentId: folder1Node.id });
    await moveBaseNode(nodeBaseId, dashboard1Node.id, { parentId: folder2Node.id });

    // Get updated node tree
    const updatedSourceNodeTree = await getBaseNodeTree(nodeBaseId).then((res) => res.data);
    const updatedSourceNodes = updatedSourceNodeTree.nodes;

    // Duplicate the base
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
    }).then((res) => res.data);

    duplicateBaseId = dupResult.id;

    // Verify duplicated node tree
    const duplicatedNodeTree = await getBaseNodeTree(duplicateBaseId).then((res) => res.data);
    const duplicatedNodes = duplicatedNodeTree.nodes;

    // Verify same number of nodes
    expect(duplicatedNodes.length).toBe(updatedSourceNodes.length);

    // Verify resource types distribution
    const sourceResourceTypes = updatedSourceNodes
      .map((n) => n.resourceType)
      .sort()
      .join(',');
    const duplicatedResourceTypes = duplicatedNodes
      .map((n) => n.resourceType)
      .sort()
      .join(',');
    expect(duplicatedResourceTypes).toBe(sourceResourceTypes);

    // Verify folder count
    const sourceFolders = updatedSourceNodes.filter(
      (n) => n.resourceType === BaseNodeResourceType.Folder
    );
    const duplicatedFolders = duplicatedNodes.filter(
      (n) => n.resourceType === BaseNodeResourceType.Folder
    );
    expect(duplicatedFolders.length).toBe(sourceFolders.length);

    // Verify table count
    const sourceTables = updatedSourceNodes.filter(
      (n) => n.resourceType === BaseNodeResourceType.Table
    );
    const duplicatedTables = duplicatedNodes.filter(
      (n) => n.resourceType === BaseNodeResourceType.Table
    );
    expect(duplicatedTables.length).toBe(sourceTables.length);

    // Verify dashboard count
    const sourceDashboards = updatedSourceNodes.filter(
      (n) => n.resourceType === BaseNodeResourceType.Dashboard
    );
    const duplicatedDashboards = duplicatedNodes.filter(
      (n) => n.resourceType === BaseNodeResourceType.Dashboard
    );
    expect(duplicatedDashboards.length).toBe(sourceDashboards.length);

    // Verify hierarchy: nodes with parents should still have parents
    const sourceNodesWithParent = updatedSourceNodes.filter((n) => n.parentId !== null);
    const duplicatedNodesWithParent = duplicatedNodes.filter((n) => n.parentId !== null);
    expect(duplicatedNodesWithParent.length).toBe(sourceNodesWithParent.length);

    // Verify folder names are preserved
    const sourceFolderNames = sourceFolders.map((f) => f.resourceMeta?.name).sort();
    const duplicatedFolderNames = duplicatedFolders.map((f) => f.resourceMeta?.name).sort();
    expect(duplicatedFolderNames).toEqual(sourceFolderNames);

    // Verify that table inside folder1 exists in imported base
    const duplicatedFolder1 = duplicatedFolders.find(
      (f) => f.resourceMeta?.name === folder1Node.resourceMeta?.name
    );
    expect(duplicatedFolder1).toBeDefined();
    const tableInsideFolder = duplicatedNodes.find((n) => {
      return n.resourceType === BaseNodeResourceType.Table && n.parentId === duplicatedFolder1!.id;
    });
    expect(tableInsideFolder).toBeDefined();

    // Verify that dashboard inside folder2 exists in imported base
    const duplicatedFolder2 = duplicatedFolders.find(
      (f) => f.resourceMeta?.name === folder2Node.resourceMeta?.name
    );
    expect(duplicatedFolder2).toBeDefined();
    const dashboardInsideFolder = duplicatedNodes.find((n) => {
      return (
        n.resourceType === BaseNodeResourceType.Dashboard && n.parentId === duplicatedFolder2!.id
      );
    });
    expect(dashboardInsideFolder).toBeDefined();

    // Verify tables are accessible
    const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
    expect(duplicatedTableList.length).toBe(2);
    expect(duplicatedTableList.map((t) => t.name).sort()).toEqual(
      [table1Node.resourceMeta?.name, table2Node.resourceMeta?.name].sort()
    );

    // Verify dashboards are accessible
    const duplicatedDashboardList = await getDashboardList(duplicateBaseId).then((res) => res.data);
    expect(duplicatedDashboardList.length).toBe(2);
    expect(duplicatedDashboardList.map((d) => d.name).sort()).toEqual(
      [dashboard1Node.resourceMeta?.name, dashboard2Node.resourceMeta?.name].sort()
    );
  });

  describe('Duplicate cross space', () => {
    let newSpace: ICreateSpaceVo;
    beforeEach(async () => {
      newSpace = (await createSpace({ name: 'new space' })).data;
    });

    afterEach(async () => {
      await deleteSpace(newSpace.id);
    });

    it('duplicate base to another space', async () => {
      await createTable(base.id, { name: 'table1' });
      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: newSpace.id,
        name: 'test base copy',
      });

      const baseResult = await getBaseList({ spaceId: newSpace.id });
      const tableResult = await getTableList(dupResult.data.id);
      const records = await getRecords(tableResult.data[0].id);
      expect(records.records.length).toBe(0);
      expect(baseResult.data.length).toBe(1);

      expect(tableResult.data.length).toBe(1);
    });
  });

  describe('should duplicate all plugins', () => {
    it('should duplicate all dashboard plugins', async () => {
      const dashboard = (await createDashboard(base.id, { name: 'dashboard' })).data;
      const dashboard2 = (await createDashboard(base.id, { name: 'dashboard2' })).data;

      await installPlugin(base.id, dashboard.id, {
        name: 'plugin1',
        pluginId: 'plgchart',
      });

      await installPlugin(base.id, dashboard.id, {
        name: 'plugin2',
        pluginId: 'plgchart',
      });

      await installPlugin(base.id, dashboard2.id, {
        name: 'plugin2_1',
        pluginId: 'plgchart',
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy',
      });
      duplicateBaseId = dupResult.data.id;
      const newBaseId = dupResult.data.id;

      const dashboardList = (await getDashboardList(newBaseId)).data;

      const dashboard1Info = (await getDashboard(newBaseId, dashboardList[0].id)).data;

      expect(dashboard1Info.layout?.length).toBe(2);
      const installedPlugins = (
        await getDashboardInstallPlugin(
          newBaseId,
          dashboardList[0].id,
          dashboard1Info.layout![0].pluginInstallId
        )
      ).data;

      expect(dashboardList.length).toBe(2);
      expect(installedPlugins.name).toBe('plugin1');
    });

    it('should duplicate all panel plugins', async () => {
      const pluginTable = await createTable(base.id, { name: 'table1PanelPlugin' });

      const panel = (await createPluginPanel(pluginTable.id, { name: 'panel1' })).data;
      const panel2 = (await createPluginPanel(pluginTable.id, { name: 'panel2' })).data;

      await installPluginPanel(pluginTable.id, panel.id, {
        name: 'plugin1',
        pluginId: 'plgchart',
      });

      await installPluginPanel(pluginTable.id, panel.id, {
        name: 'plugin2',
        pluginId: 'plgchart',
      });

      await installPluginPanel(pluginTable.id, panel2.id, {
        name: 'plugin2_1',
        pluginId: 'plgchart',
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy',
      });
      duplicateBaseId = dupResult.data.id;
      const panelList = (await listPluginPanels(pluginTable.id)).data;

      const panel1Info = (
        await getPluginPanel(pluginTable.id, panelList.find(({ name }) => name === 'panel1')!.id)
      ).data;

      const installedPlugins = (
        await getPluginPanelPlugin(
          pluginTable.id,
          panelList.find(({ name }) => name === 'panel1')!.id,
          panel1Info.layout![0].pluginInstallId
        )
      ).data;

      expect(panel1Info.layout?.length).toBe(2);
      expect(panelList.length).toBe(2);
      expect(installedPlugins.name).toBe('plugin1');
    });

    it('should duplicate all view plugins', async () => {
      const pluginTable = await createTable(base.id, { name: 'table1ViewPlugin' });
      const tableId = pluginTable.id;

      const sheetView1 = (
        await installViewPlugin(tableId, { name: 'sheetView1', pluginId: 'plgsheetform' })
      ).data;
      const sheetView2 = (
        await installViewPlugin(tableId, { name: 'sheetView2', pluginId: 'plgsheetform' })
      ).data;

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy',
      });
      duplicateBaseId = dupResult.data.id;
      const views = (await getViewList(tableId)).data;

      const pluginViews = views.filter(({ type }) => type === ViewType.Plugin);

      expect(pluginViews.length).toBe(2);

      expect(pluginViews.find(({ name }) => name === sheetView1.name)).toBeDefined();
      expect(pluginViews.find(({ name }) => name === sheetView2.name)).toBeDefined();
    });
  });

  // with ai
  it('should duplicate base with bidirectional link field', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const table2 = await createTable(base.id, { name: 'table2' });
    await deleteRecords(
      table1.id,
      table1.records.map((r) => r.id)
    );
    await deleteRecords(
      table2.id,
      table2.records.map((r) => r.id)
    );
    // Create bidirectional link field with dbFieldName 'link'
    const linkFieldRo: IFieldRo = {
      name: 'link field',
      type: FieldType.Link,
      dbFieldName: 'link',
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table2.id,
      },
    };

    const linkField = (await createField(table1.id, linkFieldRo)).data;

    // Get the symmetric field
    const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId!;
    const symmetricField = (await getField(table2.id, symmetricFieldId)).data;

    // Convert link field to required (notNull: true)
    await convertField(table1.id, linkField.id, {
      ...linkFieldRo,
      notNull: true,
    });
    await createRecords(table2.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: {} }, { fields: {} }, { fields: {} }],
    });
    // Get records
    const table2Records = await getRecords(table2.id);
    await createRecords(table1.id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [linkField.name]: [{ id: table2Records.records[0].id }],
          },
        },
        {
          fields: {
            [linkField.name]: [{ id: table2Records.records[1].id }],
          },
        },
        {
          fields: {
            [linkField.name]: [{ id: table2Records.records[2].id }],
          },
        },
      ],
    });

    // Duplicate base with records
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy - required link',
      withRecords: true,
    });

    duplicateBaseId = dupResult.data.id;

    // Verify duplicated base
    const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
    expect(duplicatedTableList.length).toBe(2);

    const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'table1')!;
    const duplicatedTable2 = duplicatedTableList.find((t) => t.name === 'table2')!;

    // Verify link field properties
    const duplicatedTable1Fields = (await getFields(duplicatedTable1.id)).data;
    const duplicatedLinkField = duplicatedTable1Fields.find((f) => f.dbFieldName === 'link');

    expect(duplicatedLinkField).toBeDefined();
    expect(duplicatedLinkField?.type).toBe(FieldType.Link);
    expect(duplicatedLinkField?.dbFieldName).toBe('link');
    expect(duplicatedLinkField?.notNull).toBe(true);
    expect((duplicatedLinkField?.options as ILinkFieldOptions).relationship).toBe(
      Relationship.ManyMany
    );
    expect((duplicatedLinkField?.options as ILinkFieldOptions).foreignTableId).toBe(
      duplicatedTable2.id
    );

    // Verify symmetric field
    const duplicatedTable2Fields = (await getFields(duplicatedTable2.id)).data;
    const duplicatedSymmetricField = duplicatedTable2Fields.find(
      (f) => f.id === (duplicatedLinkField?.options as ILinkFieldOptions).symmetricFieldId
    );
    expect(duplicatedSymmetricField).toBeDefined();

    // Verify link data is preserved
    const duplicatedTable1Records = await getRecords(duplicatedTable1.id);
    const duplicatedTable2Records = await getRecords(duplicatedTable2.id);

    expect(duplicatedTable1Records.records[0].fields[linkField.name]).toMatchObject([
      { id: duplicatedTable2Records.records[0].id },
    ]);
    expect(duplicatedTable1Records.records[1].fields[linkField.name]).toMatchObject([
      { id: duplicatedTable2Records.records[1].id },
    ]);
    expect(duplicatedTable1Records.records[2].fields[linkField.name]).toMatchObject([
      { id: duplicatedTable2Records.records[2].id },
    ]);

    // Verify symmetric link data
    expect(duplicatedTable2Records.records[0].fields[symmetricField.name]).toMatchObject([
      { id: duplicatedTable1Records.records[0].id },
    ]);
    expect(duplicatedTable2Records.records[1].fields[symmetricField.name]).toMatchObject([
      { id: duplicatedTable1Records.records[1].id },
    ]);
    expect(duplicatedTable2Records.records[2].fields[symmetricField.name]).toMatchObject([
      { id: duplicatedTable1Records.records[2].id },
    ]);
  });

  describe('Partial base duplication with nodes parameter', () => {
    it('should duplicate only selected tables using nodes parameter', async () => {
      const table1 = await createTable(base.id, { name: 'table1' });
      const table2 = await createTable(base.id, { name: 'table2' });
      await createTable(base.id, { name: 'table3' });

      // Create link between table1 and table2
      const linkField12 = (
        await createField(table1.id, {
          name: 'link to table2',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table2.id,
          },
        })
      ).data;

      // Create records and link data
      const table1Records = await getRecords(table1.id);
      const table2Records = await getRecords(table2.id);

      await updateRecord(table1.id, table1Records.records[0].id, {
        record: {
          fields: {
            [linkField12.name]: [{ id: table2Records.records[0].id }],
          },
        },
      });

      const nodeTree = await getBaseNodeTree(base.id).then((res) => res.data);
      const table1Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'table1'
      );
      const table2Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'table2'
      );

      expect(table1Node).toBeDefined();
      expect(table2Node).toBeDefined();

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - partial',
        withRecords: true,
        nodes: [table1Node!.id, table2Node!.id],
      });

      duplicateBaseId = dupResult.data.id;

      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      expect(duplicatedTableList.length).toBe(2);
      expect(duplicatedTableList.map((t) => t.name).sort()).toEqual(['table1', 'table2'].sort());

      // Verify link field data is copied
      const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'table1')!;
      const duplicatedTable2 = duplicatedTableList.find((t) => t.name === 'table2')!;
      const duplicatedTable1Records = await getRecords(duplicatedTable1.id);
      const duplicatedTable2Records = await getRecords(duplicatedTable2.id);

      // Link data should be preserved
      expect(duplicatedTable1Records.records[0].fields[linkField12.name]).toBeDefined();
      expect(duplicatedTable1Records.records[0].fields[linkField12.name]).toMatchObject([
        { id: duplicatedTable2Records.records[0].id },
      ]);
    });

    it('should handle disconnected link fields when duplicating partial tables', async () => {
      const table1 = await createTable(base.id, { name: 'table1' });
      const table2 = await createTable(base.id, { name: 'table2' });
      const table3 = await createTable(base.id, { name: 'table3' });

      // Create link from table1 to table2
      const linkField12 = (
        await createField(table1.id, {
          name: 'link to table2',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table2.id,
          },
        })
      ).data;

      // Create link from table1 to table3
      const linkField13 = (
        await createField(table1.id, {
          name: 'link to table3',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table3.id,
          },
        })
      ).data;

      // Create records with link data
      const table1Records = await getRecords(table1.id);
      const table2Records = await getRecords(table2.id);
      const table3Records = await getRecords(table3.id);

      await updateRecord(table1.id, table1Records.records[0].id, {
        record: {
          fields: {
            [linkField12.name]: [{ id: table2Records.records[0].id }],
            [linkField13.name]: [{ id: table3Records.records[0].id }],
          },
        },
      });

      // Only duplicate table1 and table2, excluding table3
      const nodeTree = await getBaseNodeTree(base.id).then((res) => res.data);
      const table1Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'table1'
      );
      const table2Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'table2'
      );

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - disconnected links',
        withRecords: true,
        nodes: [table1Node!.id, table2Node!.id],
      });

      duplicateBaseId = dupResult.data.id;

      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'table1')!;
      const duplicatedTable2 = duplicatedTableList.find((t) => t.name === 'table2')!;

      // Get fields of duplicated table1
      const duplicatedTable1Fields = (await getFields(duplicatedTable1.id)).data;
      const duplicatedLinkField12 = duplicatedTable1Fields.find((f) => f.name === 'link to table2');
      const duplicatedLinkField13 = duplicatedTable1Fields.find((f) => f.name === 'link to table3');

      // Link to table2 should exist and remain as Link type
      expect(duplicatedLinkField12).toBeDefined();
      expect(duplicatedLinkField12?.type).toBe(FieldType.Link);

      // Link to table3 should be converted to SingleLineText (disconnected - table3 was not included)
      expect(duplicatedLinkField13).toBeDefined();
      expect(duplicatedLinkField13?.type).toBe(FieldType.SingleLineText);

      // Get records and verify link field values
      const duplicatedTable1Records = await getRecords(duplicatedTable1.id);
      const duplicatedTable2Records = await getRecords(duplicatedTable2.id);

      // Link to table2 should have data and point to the duplicated table2 record
      expect(duplicatedTable1Records.records[0].fields[linkField12.name]).toBeDefined();
      expect(duplicatedTable1Records.records[0].fields[linkField12.name]).toMatchObject([
        { id: duplicatedTable2Records.records[0].id },
      ]);

      // Link to table3 should be empty or null (disconnected - table3 was not included)
      const linkToTable3Value = duplicatedTable1Records.records[0].fields[linkField13.name];
      expect(
        linkToTable3Value === null ||
          linkToTable3Value === undefined ||
          (Array.isArray(linkToTable3Value) && linkToTable3Value.length === 0)
      ).toBe(true);
    });

    it('should duplicate link field data correctly with multiple records', async () => {
      const table1 = await createTable(base.id, { name: 'Products' });
      const table2 = await createTable(base.id, { name: 'Categories' });

      // Create link field from Products to Categories
      const linkField = (
        await createField(table1.id, {
          name: 'categories',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table2.id,
          },
        })
      ).data;

      // Get records
      const table1Records = await getRecords(table1.id);
      const table2Records = await getRecords(table2.id);

      // Create multiple link relationships
      await updateRecord(table1.id, table1Records.records[0].id, {
        record: {
          fields: {
            [linkField.name]: [
              { id: table2Records.records[0].id },
              { id: table2Records.records[1].id },
            ],
          },
        },
      });

      await updateRecord(table1.id, table1Records.records[1].id, {
        record: {
          fields: {
            [linkField.name]: [{ id: table2Records.records[1].id }],
          },
        },
      });

      // Duplicate with records
      const nodeTree = await getBaseNodeTree(base.id).then((res) => res.data);
      const table1Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'Products'
      );
      const table2Node = nodeTree.nodes.find(
        (n) =>
          n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'Categories'
      );

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - link data',
        withRecords: true,
        nodes: [table1Node!.id, table2Node!.id],
      });

      duplicateBaseId = dupResult.data.id;

      // Verify duplicated data
      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'Products')!;
      const duplicatedTable2 = duplicatedTableList.find((t) => t.name === 'Categories')!;

      const duplicatedTable1Records = await getRecords(duplicatedTable1.id);
      const duplicatedTable2Records = await getRecords(duplicatedTable2.id);

      // First record should have 2 links
      const firstRecordLinks = duplicatedTable1Records.records[0].fields[linkField.name];
      expect(firstRecordLinks).toBeDefined();
      expect(Array.isArray(firstRecordLinks)).toBe(true);
      expect((firstRecordLinks as unknown[]).length).toBe(2);
      expect(firstRecordLinks).toMatchObject([
        { id: duplicatedTable2Records.records[0].id },
        { id: duplicatedTable2Records.records[1].id },
      ]);

      // Second record should have 1 link
      const secondRecordLinks = duplicatedTable1Records.records[1].fields[linkField.name];
      expect(secondRecordLinks).toBeDefined();
      expect(Array.isArray(secondRecordLinks)).toBe(true);
      expect((secondRecordLinks as unknown[]).length).toBe(1);
      expect(secondRecordLinks).toMatchObject([{ id: duplicatedTable2Records.records[1].id }]);

      // Third record should have no links
      const thirdRecordLinkValue = duplicatedTable1Records.records[2].fields[linkField.name];
      expect(
        thirdRecordLinkValue === null ||
          thirdRecordLinkValue === undefined ||
          (Array.isArray(thirdRecordLinkValue) && thirdRecordLinkValue.length === 0)
      ).toBe(true);
    });

    it('should duplicate bidirectional link field data correctly', async () => {
      const table1 = await createTable(base.id, { name: 'Tasks' });
      const table2 = await createTable(base.id, { name: 'Users' });

      // Create bidirectional link field
      const linkField = (
        await createField(table1.id, {
          name: 'assigned to',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table2.id,
          },
        })
      ).data;

      // Get the symmetric field
      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId!;
      const symmetricField = (await getField(table2.id, symmetricFieldId)).data;

      // Get records
      const table1Records = await getRecords(table1.id);
      const table2Records = await getRecords(table2.id);

      // Create link from table1 side
      await updateRecord(table1.id, table1Records.records[0].id, {
        record: {
          fields: {
            [linkField.name]: [{ id: table2Records.records[0].id }],
          },
        },
      });

      // Create link from table2 side
      await updateRecord(table2.id, table2Records.records[1].id, {
        record: {
          fields: {
            [symmetricField.name]: [{ id: table1Records.records[1].id }],
          },
        },
      });

      // Duplicate with records
      const nodeTree = await getBaseNodeTree(base.id).then((res) => res.data);
      const table1Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'Tasks'
      );
      const table2Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'Users'
      );

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - bidirectional link',
        withRecords: true,
        nodes: [table1Node!.id, table2Node!.id],
      });

      duplicateBaseId = dupResult.data.id;

      // Verify duplicated data
      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'Tasks')!;
      const duplicatedTable2 = duplicatedTableList.find((t) => t.name === 'Users')!;

      const duplicatedTable1Records = await getRecords(duplicatedTable1.id);
      const duplicatedTable2Records = await getRecords(duplicatedTable2.id);

      // Verify link from table1 side
      expect(duplicatedTable1Records.records[0].fields[linkField.name]).toMatchObject([
        { id: duplicatedTable2Records.records[0].id },
      ]);

      // Verify link from table2 side (symmetric field)
      expect(duplicatedTable2Records.records[1].fields[symmetricField.name]).toMatchObject([
        { id: duplicatedTable1Records.records[1].id },
      ]);

      // Verify bidirectional relationship
      expect(duplicatedTable1Records.records[1].fields[linkField.name]).toMatchObject([
        { id: duplicatedTable2Records.records[1].id },
      ]);
    });

    it('should preserve folder hierarchy when duplicating with nodes parameter', async () => {
      const folder1Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 1',
      }).then((res) => res.data);

      await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 2',
      });

      const table1Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table in Folder',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);

      await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table outside',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });

      // Move table1 into folder1
      await moveBaseNode(base.id, table1Node.id, { parentId: folder1Node.id });

      // Only duplicate the table inside folder (should include parent folder)
      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - with parent folder',
        nodes: [table1Node.id],
      });

      duplicateBaseId = dupResult.data.id;

      const duplicatedNodeTree = await getBaseNodeTree(duplicateBaseId).then((res) => res.data);
      const duplicatedNodes = duplicatedNodeTree.nodes;

      // Should include the folder (parent) and the table
      const duplicatedFolders = duplicatedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Folder
      );
      const duplicatedTables = duplicatedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Table
      );

      expect(duplicatedFolders.length).toBe(1);
      expect(duplicatedFolders[0].resourceMeta?.name).toBe('Folder 1');

      expect(duplicatedTables.length).toBe(1);
      expect(duplicatedTables[0].resourceMeta?.name).toBe('Table in Folder');

      // Verify table is still inside the folder
      expect(duplicatedTables[0].parentId).toBe(duplicatedFolders[0].id);

      // Verify table2 is not included
      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      expect(duplicatedTableList.length).toBe(1);
      expect(duplicatedTableList[0].name).toBe('Table in Folder');
    });

    it('should convert disconnected link fields to SingleLineText and clear data', async () => {
      const table1 = await createTable(base.id, { name: 'Orders' });
      const table2 = await createTable(base.id, { name: 'Customers' });
      const table3 = await createTable(base.id, { name: 'Products' });

      // Create link from Orders to Customers (will be included)
      const linkField12 = (
        await createField(table1.id, {
          name: 'customer',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table2.id,
          },
        })
      ).data;

      // Create link from Orders to Products (will be excluded)
      const linkField13 = (
        await createField(table1.id, {
          name: 'product',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table3.id,
          },
        })
      ).data;

      // Add some link data
      const table1Records = await getRecords(table1.id);
      const table2Records = await getRecords(table2.id);
      const table3Records = await getRecords(table3.id);

      await updateRecord(table1.id, table1Records.records[0].id, {
        record: {
          fields: {
            [linkField12.name]: [{ id: table2Records.records[0].id }],
            [linkField13.name]: [{ id: table3Records.records[0].id }],
          },
        },
      });

      // Only duplicate table1 and table2, excluding table3
      const nodeTree = await getBaseNodeTree(base.id).then((res) => res.data);
      const table1Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'Orders'
      );
      const table2Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'Customers'
      );

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - field type conversion',
        withRecords: true,
        nodes: [table1Node!.id, table2Node!.id],
      });

      duplicateBaseId = dupResult.data.id;

      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'Orders')!;

      // Verify field types
      const duplicatedFields = (await getFields(duplicatedTable1.id)).data;
      const customerField = duplicatedFields.find((f) => f.name === 'customer');
      const productField = duplicatedFields.find((f) => f.name === 'product');

      // Customer field should remain as Link
      expect(customerField).toBeDefined();
      expect(customerField?.type).toBe(FieldType.Link);
      expect((customerField?.options as ILinkFieldOptions)?.foreignTableId).toBeDefined();

      // Product field should be converted to SingleLineText
      expect(productField).toBeDefined();
      expect(productField?.type).toBe(FieldType.SingleLineText);
      // Options should be empty object or not have link-specific properties
      expect(productField?.options).toBeDefined();
      expect((productField?.options as ILinkFieldOptions)?.foreignTableId).toBeUndefined();

      // Verify data: customer link should have data, product field should be empty
      const duplicatedRecords = await getRecords(duplicatedTable1.id);
      expect(duplicatedRecords.records[0].fields[linkField12.name]).toBeDefined();

      const productFieldValue = duplicatedRecords.records[0].fields[linkField13.name];
      expect(
        productFieldValue === null || productFieldValue === undefined || productFieldValue === ''
      ).toBe(true);
    });

    it('should handle lookup fields when link field is disconnected', async () => {
      const table1 = await createTable(base.id, { name: 'table1' });
      await createTable(base.id, { name: 'table2' });
      const table3 = await createTable(base.id, { name: 'table3' });

      // Create link from table1 to table3
      const linkField13 = (
        await createField(table1.id, {
          name: 'link to table3',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table3.id,
          },
        })
      ).data;

      // Create lookup field based on the link to table3
      await createField(table1.id, {
        name: 'lookup from table3',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table3.id,
          linkFieldId: linkField13.id,
          lookupFieldId: table3.fields[0].id,
        },
      });

      // Only duplicate table1 and table2, excluding table3
      const nodeTree = await getBaseNodeTree(base.id).then((res) => res.data);
      const table1Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'table1'
      );
      const table2Node = nodeTree.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceMeta?.name === 'table2'
      );

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - disconnected lookup',
        nodes: [table1Node!.id, table2Node!.id],
      });

      duplicateBaseId = dupResult.data.id;

      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedTable1 = duplicatedTableList.find((t) => t.name === 'table1')!;

      // Get fields and verify lookup field exists
      const duplicatedTable1Fields = (await getFields(duplicatedTable1.id)).data;
      const lookupField = duplicatedTable1Fields.find((f) => f.name === 'lookup from table3');

      // Lookup field should be converted to SingleLineText (disconnected - based on link to table3)
      expect(lookupField).toBeDefined();
      expect(lookupField?.type).toBe(FieldType.SingleLineText);
      expect(lookupField?.isLookup).toBeFalsy();
    });

    it('should duplicate multiple folders and their contents with nodes parameter', async () => {
      const folder1Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder A',
      }).then((res) => res.data);

      const folder2Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder B',
      }).then((res) => res.data);

      const table1Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table A1',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);

      const table2Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table B1',
        fields: [{ name: 'Field2', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);

      const table3Node = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table B2',
        fields: [{ name: 'Field3', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);

      // Move tables into folders
      await moveBaseNode(base.id, table1Node.id, { parentId: folder1Node.id });
      await moveBaseNode(base.id, table2Node.id, { parentId: folder2Node.id });
      await moveBaseNode(base.id, table3Node.id, { parentId: folder2Node.id });

      // Duplicate only Folder A's table and one table from Folder B
      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: spaceId,
        name: 'test base copy - multiple folders',
        nodes: [table1Node.id, table2Node.id],
      });

      duplicateBaseId = dupResult.data.id;

      const duplicatedNodeTree = await getBaseNodeTree(duplicateBaseId).then((res) => res.data);
      const duplicatedNodes = duplicatedNodeTree.nodes;

      const duplicatedFolders = duplicatedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Folder
      );
      const duplicatedTables = duplicatedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Table
      );

      // Should have both folders
      expect(duplicatedFolders.length).toBe(2);
      expect(duplicatedFolders.map((f) => f.resourceMeta?.name).sort()).toEqual(
        ['Folder A', 'Folder B'].sort()
      );

      // Should have only 2 tables
      expect(duplicatedTables.length).toBe(2);
      expect(duplicatedTables.map((t) => t.resourceMeta?.name).sort()).toEqual(
        ['Table A1', 'Table B1'].sort()
      );

      // Table B2 should not be included
      const duplicatedTableList = await getTableList(duplicateBaseId).then((res) => res.data);
      expect(duplicatedTableList.find((t) => t.name === 'Table B2')).toBeUndefined();
    });
  });
});
