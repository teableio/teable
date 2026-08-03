/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  ILinkFieldOptions,
  ILookupOptionsRo,
  IPluginViewOptions,
} from '@teable/core';
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
  getUserLastVisitListBase,
  getViewInstallPlugin,
  getViewList,
  installPlugin,
  installPluginPanel,
  installViewPlugin,
  listPluginPanels,
  LLMProviderType,
  moveBaseNode,
  SettingKey,
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
  permanentDeleteBase,
  permanentDeleteSpace,
  updateRecord,
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

  it('duplicate base with cross-space link/lookup downgrades values to title text', async () => {
    // Source base (`base`) and link target (`base2`) share spaceId, so the link
    // is legal at create time (same-space cross-base). The duplicate destination
    // is a SEPARATE space — from its perspective the preserved link would point
    // back into another space, which the duplicate must downgrade to text.
    const base2 = (await createBase({ spaceId, name: 'test base 2' })).data;
    const destSpace = (await createSpace({ name: 'duplicate dest space' })).data;
    try {
      const base2Table = await createTable(base2.id, { name: 'table1', records: [] });
      const base2PrimaryId = base2Table.fields[0].id;

      // Peer record sets the title we expect to see flow into the duplicated
      // base as plain text after the cross-space link/lookup are downgraded.
      const peerRecord = (
        await createRecords(base2Table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [base2PrimaryId]: 'peer-A' } }],
        })
      ).records[0];

      const table1 = await createTable(base.id, { name: 'table1', records: [] });
      const table1Primary = table1.fields.find((f) => f.isPrimary)!;

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

      const crossBaseLookupField = (
        await createField(table1.id, {
          name: 'cross base lookup field',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: base2Table.id,
            linkFieldId: crossBaseLinkField.id,
            lookupFieldId: base2PrimaryId,
          },
        })
      ).data;

      await createRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [table1Primary.id]: 'src-1',
              [crossBaseLinkField.id]: [{ id: peerRecord.id }],
            },
          },
        ],
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: destSpace.id,
        name: 'test base copy',
        withRecords: true,
      });
      expect(dupResult.status).toBe(201);
      duplicateBaseId = dupResult.data.id;

      // Field downgrade is the easy half — the cellValue downgrade is what
      // multiple recent fixes (0d441780e / ac5da54d0 / 175e2c59c / 9490800a9)
      // were chasing. Without this assertion a regression would silently leave
      // the new text columns null while still appearing structurally correct.
      const dupTables = (await getTableList(duplicateBaseId)).data;
      const dupTable1 = dupTables.find((t) => t.name === 'table1')!;
      const dupFields = (await getFields(dupTable1.id)).data;
      const dupLinkField = dupFields.find((f) => f.name === 'cross base link field')!;
      const dupLookupField = dupFields.find((f) => f.name === 'cross base lookup field')!;

      expect(dupLinkField.type).toBe(FieldType.SingleLineText);
      expect(dupLookupField.type).toBe(FieldType.SingleLineText);
      expect(dupLookupField.isLookup).toBeFalsy();

      const dupRecords = await getRecords(dupTable1.id);
      const dupRow = dupRecords.records[0];
      // Link's source DB column stores the cached title text directly, so the
      // SQL-direct copy lands on a clean "peer-A" in the new text column.
      // Lookup's source DB column stores the multi-value JSON array (the
      // lookup engine's storage contract), and duplicateBase uses SQL-direct
      // row copy with no cellValue2String pass on downgraded fields — so the
      // raw '["peer-A"]' is what survives the move. This documents the
      // intentional split: downgrade preserves data verbatim, it doesn't
      // re-stringify it.
      expect(dupRow.fields[dupLinkField.name]).toBe('peer-A');
      expect(dupRow.fields[dupLookupField.name]).toBe('["peer-A"]');
    } finally {
      await permanentDeleteBase(base2.id);
      if (duplicateBaseId) {
        await permanentDeleteBase(duplicateBaseId);
        duplicateBaseId = undefined;
      }
      await permanentDeleteSpace(destSpace.id);
    }
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

  it('seeds last-visit so a freshly duplicated base tops the recent list', async () => {
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId,
      name: 'last-visit seed copy',
    });
    expect(dupResult.status).toBe(201);
    duplicateBaseId = dupResult.data.id;

    // The recent-bases query INNER JOINs user_last_visit, so without the seed the
    // new base is absent entirely (not merely sorted last) — looking like a failed copy.
    const listRes = await getUserLastVisitListBase();
    const listedIds = listRes.data.list.map((item) => item.resource.id);
    expect(listedIds).toContain(duplicateBaseId);
    // Seeded with lastVisitTime = now, so it sorts to the front.
    expect(listRes.data.list[0].resource.id).toBe(duplicateBaseId);
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

  it('should duplicate a complex base through v2 canary', async () => {
    const previousCanaryEnv = process.env.ENABLE_CANARY_FEATURE;
    process.env.ENABLE_CANARY_FEATURE = 'true';

    const externalBase = (await createBase({ spaceId, name: 'external link base' })).data;
    try {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          forceV2All: true,
          spaceIds: [spaceId],
        },
      });

      const externalTable = await createTable(externalBase.id, { name: 'vendors' });
      const externalRecord = (
        await createRecords(externalTable.id, {
          records: [{ fields: { [externalTable.fields[0].id]: 'Vendor A' } }],
        })
      ).records[0];

      const peopleFolder = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'People Folder',
      }).then((res) => res.data);
      const taskFolder = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Task Folder',
      }).then((res) => res.data);

      const peopleNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'People',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Score', type: FieldType.Number },
        ],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      const taskNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Tasks',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      await moveBaseNode(base.id, peopleNode.id, { parentId: peopleFolder.id });
      await moveBaseNode(base.id, taskNode.id, { parentId: taskFolder.id });

      const [peopleDefaultRecords, taskDefaultRecords] = await Promise.all([
        getRecords(peopleNode.resourceId).then(({ records }) => records),
        getRecords(taskNode.resourceId).then(({ records }) => records),
      ]);
      if (peopleDefaultRecords.length) {
        await deleteRecords(
          peopleNode.resourceId,
          peopleDefaultRecords.map(({ id }) => id)
        );
      }
      if (taskDefaultRecords.length) {
        await deleteRecords(
          taskNode.resourceId,
          taskDefaultRecords.map(({ id }) => id)
        );
      }

      const peopleFields = (await getFields(peopleNode.resourceId)).data;
      const peopleNameField = peopleFields.find(({ name }) => name === 'Name')!;
      const scoreField = peopleFields.find(({ name }) => name === 'Score')!;
      const taskTitleField = (await getFields(taskNode.resourceId)).data.find(
        ({ name }) => name === 'Title'
      )!;
      const doubledScoreField = (
        await createField(peopleNode.resourceId, {
          name: 'Doubled Score',
          type: FieldType.Formula,
          options: { expression: `{${scoreField.id}} * 2`, timeZone: 'Asia/Shanghai' },
        })
      ).data;
      const ownerLinkField = (
        await createField(taskNode.resourceId, {
          name: 'Owner',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: peopleNode.resourceId,
          },
        })
      ).data;
      const externalLinkField = (
        await createField(taskNode.resourceId, {
          name: 'External Vendor',
          type: FieldType.Link,
          options: {
            baseId: externalBase.id,
            relationship: Relationship.ManyMany,
            foreignTableId: externalTable.id,
          },
        })
      ).data;

      const peopleRecord = (
        await createRecords(peopleNode.resourceId, {
          records: [
            {
              fields: {
                [peopleNameField.id]: 'Alice',
                [scoreField.id]: 11,
              },
            },
          ],
        })
      ).records[0];
      await createRecords(taskNode.resourceId, {
        records: [
          {
            fields: {
              [taskTitleField.id]: 'Task A',
              [ownerLinkField.id]: [{ id: peopleRecord.id }],
              [externalLinkField.id]: [{ id: externalRecord.id }],
            },
          },
        ],
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'complex v2 base copy',
        withRecords: true,
      });
      expect(dupResult.status).toBe(201);
      duplicateBaseId = dupResult.data.id;

      const duplicatedTables = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedPeopleTable = duplicatedTables.find(({ name }) => name === 'People')!;
      const duplicatedTaskTable = duplicatedTables.find(({ name }) => name === 'Tasks')!;
      expect(duplicatedPeopleTable.id).not.toBe(peopleNode.resourceId);
      expect(duplicatedTaskTable.id).not.toBe(taskNode.resourceId);

      const duplicatedPeopleFields = (await getFields(duplicatedPeopleTable.id)).data;
      const duplicatedDoubledScoreField = duplicatedPeopleFields.find(
        ({ name }) => name === doubledScoreField.name
      );
      expect(duplicatedDoubledScoreField?.options).toMatchObject({
        expression: expect.stringContaining(
          duplicatedPeopleFields.find(({ name }) => name === scoreField.name)!.id
        ),
      });

      const duplicatedTasks = await getRecords(duplicatedTaskTable.id, {
        fieldKeyType: FieldKeyType.Name,
      });
      expect(duplicatedTasks.records).toHaveLength(1);
      expect(duplicatedTasks.records[0].fields[ownerLinkField.name]).toMatchObject([
        { title: 'Alice' },
      ]);
      expect(duplicatedTasks.records[0].fields[externalLinkField.name]).toMatchObject([
        { title: 'Vendor A' },
      ]);

      const duplicatedNodeTree = await getBaseNodeTree(duplicateBaseId).then((res) => res.data);
      const duplicatedPeopleFolder = duplicatedNodeTree.nodes.find(
        ({ resourceMeta, resourceType }) =>
          resourceMeta?.name === peopleFolder.resourceMeta?.name &&
          resourceType === BaseNodeResourceType.Folder
      );
      const duplicatedPeopleNode = duplicatedNodeTree.nodes.find(
        ({ resourceMeta, resourceType }) =>
          resourceMeta?.name === peopleNode.resourceMeta?.name &&
          resourceType === BaseNodeResourceType.Table
      );
      expect(duplicatedPeopleNode?.parentId).toBe(duplicatedPeopleFolder?.id);
    } finally {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          spaceIds: [],
        },
      });
      process.env.ENABLE_CANARY_FEATURE = previousCanaryEnv;
      await permanentDeleteBase(externalBase.id);
    }
  });

  describe('V2 canary duplicate parity', () => {
    let previousCanaryEnv: string | undefined;

    beforeEach(async () => {
      previousCanaryEnv = process.env.ENABLE_CANARY_FEATURE;
      process.env.ENABLE_CANARY_FEATURE = 'true';
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          forceV2All: true,
          spaceIds: [spaceId],
        },
      });
    });

    afterEach(async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          forceV2All: false,
          spaceIds: [],
        },
      });
      process.env.ENABLE_CANARY_FEATURE = previousCanaryEnv;
    });

    it('duplicates schema, records, and auto number through v2', async () => {
      const table = await createTable(base.id, { name: 'Basic Table' });

      const structureOnlyResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'v2 structure only copy',
      });
      duplicateBaseId = structureOnlyResult.data.id;

      const structureOnlyTables = await getTableList(duplicateBaseId).then((res) => res.data);
      const structureOnlyRecords = await getRecords(structureOnlyTables[0].id);
      expect(structureOnlyTables).toHaveLength(1);
      expect(structureOnlyTables[0].name).toBe(table.name);
      expect(structureOnlyTables[0].id).not.toBe(table.id);
      expect(structureOnlyRecords.records).toHaveLength(0);

      await permanentDeleteBase(duplicateBaseId);
      duplicateBaseId = undefined;

      const sourceRecords = await getRecords(table.id);
      await updateRecord(table.id, sourceRecords.records[0].id, {
        record: { fields: { [table.fields[0].name]: 'new value' } },
      });

      const withRecordsResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'v2 records copy',
        withRecords: true,
      });
      duplicateBaseId = withRecordsResult.data.id;

      const duplicatedTable = (await getTableList(duplicateBaseId)).data[0];
      const duplicatedRecords = await getRecords(duplicatedTable.id);
      expect(duplicatedRecords.records).toHaveLength(3);
      expect(duplicatedRecords.records[0].lastModifiedBy).toBeFalsy();
      expect(duplicatedRecords.records[0].createdTime).toBeTruthy();
      expect(duplicatedRecords.records[0].fields[table.fields[0].name]).toEqual('new value');

      await createRecords(duplicatedTable.id, { records: [{ fields: {} }] });
      const recordsAfterCreate = await getRecords(duplicatedTable.id);
      expect(recordsAfterCreate.records[recordsAfterCreate.records.length - 1].autoNumber).toEqual(
        recordsAfterCreate.records.length
      );
    });

    it('duplicates bidirectional link records through v2 stream copy', async () => {
      const sourceTable = await createTable(base.id, { name: 'V2 Source', records: [] });
      const linkedTable = await createTable(base.id, { name: 'V2 Linked', records: [] });
      const linkField = (
        await createField(sourceTable.id, {
          name: 'Links',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: linkedTable.id,
          },
        })
      ).data;
      const symmetricField = (
        await getField(
          linkedTable.id,
          (linkField.options as ILinkFieldOptions).symmetricFieldId as string
        )
      ).data;
      const linkedRecords = await createRecords(linkedTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: {} }, { fields: {} }],
      });
      await createRecords(sourceTable.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          { fields: { [linkField.name]: [{ id: linkedRecords.records[0].id }] } },
          { fields: { [linkField.name]: [{ id: linkedRecords.records[1].id }] } },
        ],
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'v2 stream link copy',
        withRecords: true,
      });
      duplicateBaseId = dupResult.data.id;

      const duplicatedTables = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedSourceTable = duplicatedTables.find(({ name }) => name === sourceTable.name)!;
      const duplicatedLinkedTable = duplicatedTables.find(({ name }) => name === linkedTable.name)!;
      const duplicatedSourceRecords = await getRecords(duplicatedSourceTable.id);
      const duplicatedLinkedRecords = await getRecords(duplicatedLinkedTable.id);

      expect(duplicatedSourceRecords.records[0].fields[linkField.name]).toMatchObject([
        { id: duplicatedLinkedRecords.records[0].id },
      ]);
      expect(duplicatedSourceRecords.records[1].fields[linkField.name]).toMatchObject([
        { id: duplicatedLinkedRecords.records[1].id },
      ]);
      expect(duplicatedLinkedRecords.records[0].fields[symmetricField.name]).toMatchObject([
        { id: duplicatedSourceRecords.records[0].id },
      ]);
      expect(duplicatedLinkedRecords.records[1].fields[symmetricField.name]).toMatchObject([
        { id: duplicatedSourceRecords.records[1].id },
      ]);
    });

    it('downgrades cross-space cross-base link records through v2 stream copy', async () => {
      const externalBase = (await createBase({ spaceId, name: 'V2 External Base' })).data;
      const destSpace = (await createSpace({ name: 'v2 duplicate dest space' })).data;

      try {
        const externalTable = await createTable(externalBase.id, {
          name: 'V2 Vendors',
          records: [],
        });
        const externalPrimaryField = externalTable.fields.find(({ isPrimary }) => isPrimary)!;
        const vendorRecord = (
          await createRecords(externalTable.id, {
            fieldKeyType: FieldKeyType.Id,
            records: [{ fields: { [externalPrimaryField.id]: 'Vendor A' } }],
          })
        ).records[0];

        const sourceTable = await createTable(base.id, { name: 'V2 Orders', records: [] });
        const sourcePrimaryField = sourceTable.fields.find(({ isPrimary }) => isPrimary)!;
        const vendorLinkField = (
          await createField(sourceTable.id, {
            name: 'Vendor',
            type: FieldType.Link,
            options: {
              baseId: externalBase.id,
              relationship: Relationship.ManyMany,
              foreignTableId: externalTable.id,
            },
          })
        ).data;
        const vendorLookupField = (
          await createField(sourceTable.id, {
            name: 'Vendor Name',
            type: FieldType.SingleLineText,
            isLookup: true,
            lookupOptions: {
              foreignTableId: externalTable.id,
              linkFieldId: vendorLinkField.id,
              lookupFieldId: externalPrimaryField.id,
            },
          })
        ).data;

        await createRecords(sourceTable.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              fields: {
                [sourcePrimaryField.id]: 'Order 1',
                [vendorLinkField.id]: [{ id: vendorRecord.id }],
              },
            },
          ],
        });

        const dupResult = await duplicateBase({
          fromBaseId: base.id,
          spaceId: destSpace.id,
          name: 'v2 cross base link downgrade',
          withRecords: true,
        });
        duplicateBaseId = dupResult.data.id;

        const duplicatedTables = await getTableList(duplicateBaseId).then((res) => res.data);
        const duplicatedSourceTable = duplicatedTables.find(
          ({ name }) => name === sourceTable.name
        )!;
        const duplicatedFields = (await getFields(duplicatedSourceTable.id)).data;
        const duplicatedVendorLinkField = duplicatedFields.find(
          ({ name }) => name === vendorLinkField.name
        )!;
        const duplicatedVendorLookupField = duplicatedFields.find(
          ({ name }) => name === vendorLookupField.name
        )!;
        expect(duplicatedVendorLinkField.type).toBe(FieldType.SingleLineText);
        expect(duplicatedVendorLookupField.type).toBe(FieldType.SingleLineText);
        expect(duplicatedVendorLookupField.isLookup).toBeFalsy();

        const duplicatedRecords = await getRecords(duplicatedSourceTable.id);
        const duplicatedRow = duplicatedRecords.records[0];
        expect(duplicatedRow.fields[duplicatedVendorLinkField.name]).toBe('Vendor A');
        expect(duplicatedRow.fields[duplicatedVendorLookupField.name]).toContain('Vendor A');
      } finally {
        await permanentDeleteBase(externalBase.id);
        if (duplicateBaseId) {
          await permanentDeleteBase(duplicateBaseId);
          duplicateBaseId = undefined;
        }
        await permanentDeleteSpace(destSpace.id);
      }
    });

    it('duplicates formula, link, lookup, rollup, bidirectional link, and ai field config through v2', async () => {
      const peopleTable = await createTable(base.id, { name: 'People' });
      const taskTable = await createTable(base.id, { name: 'Tasks' });

      const peopleFields = (await getFields(peopleTable.id)).data;
      const peoplePrimaryField = peopleFields.find(({ isPrimary }) => isPrimary)!;
      const scoreField = (
        await createField(peopleTable.id, {
          name: 'Score',
          type: FieldType.Number,
        })
      ).data;
      const doubledScoreField = (
        await createField(peopleTable.id, {
          name: 'Doubled Score',
          type: FieldType.Formula,
          options: { expression: `{${scoreField.id}} * 2`, timeZone: 'Asia/Shanghai' },
        })
      ).data;
      const ownerLinkField = (
        await createField(taskTable.id, {
          name: 'Owner',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: peopleTable.id,
          },
        })
      ).data;
      const ownerSymmetricField = (
        await getField(
          peopleTable.id,
          (ownerLinkField.options as ILinkFieldOptions).symmetricFieldId as string
        )
      ).data;
      const ownerLookupField = (
        await createField(taskTable.id, {
          name: 'Owner Name',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: peopleTable.id,
            linkFieldId: ownerLinkField.id,
            lookupFieldId: peoplePrimaryField.id,
          },
        })
      ).data;
      const ownerScoreRollupField = (
        await createField(taskTable.id, {
          name: 'Owner Score Sum',
          type: FieldType.Rollup,
          options: {
            expression: 'sum({values})',
          },
          lookupOptions: {
            foreignTableId: peopleTable.id,
            linkFieldId: ownerLinkField.id,
            lookupFieldId: scoreField.id,
          },
        })
      ).data;

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
      const aiField = (
        await createField(peopleTable.id, {
          name: 'ai field',
          type: FieldType.SingleLineText,
          aiConfig: {
            attachPrompt: 'test-attach-prompt',
            modelKey: aiSetting.aiConfig?.llmProviders[0].models,
            sourceFieldId: peoplePrimaryField.id,
            type: FieldAIActionType.Summary,
          },
        })
      ).data;

      const peopleRecords = await getRecords(peopleTable.id);
      const taskRecords = await getRecords(taskTable.id);
      await updateRecord(peopleTable.id, peopleRecords.records[0].id, {
        record: {
          fields: {
            [peoplePrimaryField.name]: 'Alice',
            [scoreField.name]: 11,
          },
        },
      });
      await updateRecord(taskTable.id, taskRecords.records[0].id, {
        record: {
          fields: {
            [taskTable.fields[0].name]: 'Task A',
            [ownerLinkField.name]: [{ id: peopleRecords.records[0].id }],
          },
        },
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'v2 field parity copy',
        withRecords: true,
      });
      duplicateBaseId = dupResult.data.id;

      const duplicatedTables = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedPeopleTable = duplicatedTables.find(({ name }) => name === peopleTable.name)!;
      const duplicatedTaskTable = duplicatedTables.find(({ name }) => name === taskTable.name)!;
      const duplicatedPeopleFields = (await getFields(duplicatedPeopleTable.id)).data;
      const duplicatedTaskFields = (await getFields(duplicatedTaskTable.id)).data;

      const duplicatedScoreField = duplicatedPeopleFields.find(
        ({ name }) => name === scoreField.name
      )!;
      const duplicatedOwnerLinkField = duplicatedTaskFields.find(
        ({ name }) => name === ownerLinkField.name
      )!;
      const duplicatedOwnerScoreRollupField = duplicatedTaskFields.find(
        ({ name }) => name === ownerScoreRollupField.name
      );
      const duplicatedDoubledScoreField = duplicatedPeopleFields.find(
        ({ name }) => name === doubledScoreField.name
      );
      expect(duplicatedDoubledScoreField?.options).toMatchObject({
        expression: expect.stringContaining(duplicatedScoreField.id),
      });

      const duplicatedAiField = duplicatedPeopleFields.find(({ name }) => name === aiField.name);
      expect(duplicatedAiField?.aiConfig).toEqual({
        ...aiField.aiConfig,
        sourceFieldId: duplicatedPeopleFields.find(({ name }) => name === peoplePrimaryField.name)!
          .id,
      });

      const duplicatedPeopleRecords = await getRecords(duplicatedPeopleTable.id);
      const duplicatedTaskRecords = await getRecords(duplicatedTaskTable.id, {
        fieldKeyType: FieldKeyType.Name,
      });
      expect(duplicatedTaskRecords.records[0].fields[ownerLinkField.name]).toMatchObject([
        { id: duplicatedPeopleRecords.records[0].id, title: 'Alice' },
      ]);
      expect(duplicatedTaskRecords.records[0].fields[ownerLookupField.name]).toEqual(['Alice']);
      expect(duplicatedPeopleRecords.records[0].fields[ownerSymmetricField.name]).toMatchObject([
        { id: duplicatedTaskRecords.records[0].id },
      ]);
      expect(
        duplicatedTaskFields.find(({ name }) => name === ownerLookupField.name)?.isLookup
      ).toBe(true);
      expect(duplicatedOwnerScoreRollupField?.type).toBe(FieldType.Rollup);
      expect(duplicatedOwnerScoreRollupField?.lookupOptions).toMatchObject({
        foreignTableId: duplicatedPeopleTable.id,
        linkFieldId: duplicatedOwnerLinkField.id,
        lookupFieldId: duplicatedScoreField.id,
      });
    });

    it('duplicates folders, dashboards, and plugins through v2', async () => {
      const folderNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 1',
      }).then((res) => res.data);
      const pluginTableNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Plugin Table',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      await moveBaseNode(base.id, pluginTableNode.id, { parentId: folderNode.id });

      const dashboard = (await createDashboard(base.id, { name: 'Dashboard 1' })).data;
      await installPlugin(base.id, dashboard.id, {
        name: 'dashboard plugin',
        pluginId: 'plgchart',
      });

      const panel = (await createPluginPanel(pluginTableNode.resourceId, { name: 'panel1' })).data;
      await installPluginPanel(pluginTableNode.resourceId, panel.id, {
        name: 'panel plugin',
        pluginId: 'plgchart',
      });

      const sheetView = (
        await installViewPlugin(pluginTableNode.resourceId, {
          name: 'sheetView1',
          pluginId: 'plgsheetform',
        })
      ).data;

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'v2 extras parity copy',
      });
      duplicateBaseId = dupResult.data.id;

      const duplicatedNodeTree = await getBaseNodeTree(duplicateBaseId).then((res) => res.data);
      const duplicatedFolder = duplicatedNodeTree.nodes.find(
        ({ resourceMeta, resourceType }) =>
          resourceMeta?.name === folderNode.resourceMeta?.name &&
          resourceType === BaseNodeResourceType.Folder
      );
      const duplicatedPluginTableNode = duplicatedNodeTree.nodes.find(
        ({ resourceMeta, resourceType }) =>
          resourceMeta?.name === pluginTableNode.resourceMeta?.name &&
          resourceType === BaseNodeResourceType.Table
      );
      expect(duplicatedPluginTableNode?.parentId).toBe(duplicatedFolder?.id);

      const duplicatedDashboard = (await getDashboardList(duplicateBaseId)).data.find(
        ({ name }) => name === dashboard.name
      )!;
      const duplicatedDashboardInfo = (await getDashboard(duplicateBaseId, duplicatedDashboard.id))
        .data;
      expect(duplicatedDashboardInfo.layout).toHaveLength(1);
      const duplicatedDashboardPlugin = (
        await getDashboardInstallPlugin(
          duplicateBaseId,
          duplicatedDashboard.id,
          duplicatedDashboardInfo.layout![0].pluginInstallId
        )
      ).data;
      expect(duplicatedDashboardPlugin.name).toBe('dashboard plugin');

      const duplicatedTable = (await getTableList(duplicateBaseId)).data.find(
        ({ name }) => name === pluginTableNode.resourceMeta?.name
      )!;
      const duplicatedPanels = (await listPluginPanels(duplicatedTable.id)).data;
      const duplicatedPanel = duplicatedPanels.find(({ name }) => name === panel.name)!;
      const duplicatedPanelInfo = (await getPluginPanel(duplicatedTable.id, duplicatedPanel.id))
        .data;
      expect(duplicatedPanelInfo.layout).toHaveLength(1);
      const duplicatedPanelPlugin = (
        await getPluginPanelPlugin(
          duplicatedTable.id,
          duplicatedPanel.id,
          duplicatedPanelInfo.layout![0].pluginInstallId
        )
      ).data;
      expect(duplicatedPanelPlugin.name).toBe('panel plugin');

      const duplicatedPluginViews = (await getViewList(duplicatedTable.id)).data.filter(
        ({ type }) => type === ViewType.Plugin
      );
      const duplicatedSheetView = duplicatedPluginViews.find(
        ({ name }) => name === sheetView.name
      )!;
      const duplicatedViewPlugin = (
        await getViewInstallPlugin(duplicatedTable.id, duplicatedSheetView.id)
      ).data;
      expect(duplicatedViewPlugin).toMatchObject({
        baseId: duplicateBaseId,
        pluginId: 'plgsheetform',
      });
      expect(duplicatedViewPlugin.pluginInstallId).toBe(
        (duplicatedSheetView.options as IPluginViewOptions).pluginInstallId
      );
      expect(duplicatedViewPlugin.pluginInstallId).not.toBe(sheetView.pluginInstallId);
    });

    it('duplicates base to another space through v2', async () => {
      const newSpace = (await createSpace({ name: 'v2 target space' })).data;
      try {
        await createTable(base.id, { name: 'Cross Space Table' });
        const dupResult = await duplicateBase({
          fromBaseId: base.id,
          spaceId: newSpace.id,
          name: 'v2 cross space copy',
        });
        const newSpaceDuplicateBaseId = dupResult.data.id;

        const baseResult = await getBaseList({ spaceId: newSpace.id });
        const tableResult = await getTableList(newSpaceDuplicateBaseId);
        const records = await getRecords(tableResult.data[0].id);
        expect(baseResult.data).toHaveLength(1);
        expect(tableResult.data).toHaveLength(1);
        expect(records.records).toHaveLength(0);
      } finally {
        await deleteSpace(newSpace.id);
      }
    });

    it('duplicates partial nodes, disconnected links, lookup conversion, and parent folders through v2', async () => {
      const folderNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Orders Folder',
      }).then((res) => res.data);
      const ordersNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Orders',
        fields: [{ name: 'Order', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      const customersNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Customers',
        fields: [{ name: 'Customer', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      const productsNode = await createBaseNode(base.id, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Products',
        fields: [{ name: 'Product', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      await moveBaseNode(base.id, ordersNode.id, { parentId: folderNode.id });
      const productPrimaryField = (await getFields(productsNode.resourceId)).data.find(
        ({ isPrimary }) => isPrimary
      )!;

      const customerLinkField = (
        await createField(ordersNode.resourceId, {
          name: 'customer',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: customersNode.resourceId,
          },
        })
      ).data;
      const productLinkField = (
        await createField(ordersNode.resourceId, {
          name: 'product',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: productsNode.resourceId,
          },
        })
      ).data;
      const productLookupField = (
        await createField(ordersNode.resourceId, {
          name: 'product lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: productsNode.resourceId,
            linkFieldId: productLinkField.id,
            lookupFieldId: productPrimaryField.id,
          },
        })
      ).data;

      const orderRecords = await getRecords(ordersNode.resourceId);
      const customerRecords = await getRecords(customersNode.resourceId);
      const productRecords = await getRecords(productsNode.resourceId);
      await updateRecord(ordersNode.resourceId, orderRecords.records[0].id, {
        record: {
          fields: {
            [customerLinkField.name]: [{ id: customerRecords.records[0].id }],
            [productLinkField.name]: [{ id: productRecords.records[0].id }],
          },
        },
      });

      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId,
        name: 'v2 partial nodes copy',
        withRecords: true,
        nodes: [ordersNode.id, customersNode.id],
      });
      duplicateBaseId = dupResult.data.id;

      const duplicatedNodeTree = await getBaseNodeTree(duplicateBaseId).then((res) => res.data);
      const duplicatedFolders = duplicatedNodeTree.nodes.filter(
        ({ resourceType }) => resourceType === BaseNodeResourceType.Folder
      );
      const duplicatedTableNodes = duplicatedNodeTree.nodes.filter(
        ({ resourceType }) => resourceType === BaseNodeResourceType.Table
      );
      expect(duplicatedFolders).toHaveLength(1);
      expect(duplicatedFolders[0].resourceMeta?.name).toBe(folderNode.resourceMeta?.name);
      expect(duplicatedTableNodes.map(({ resourceMeta }) => resourceMeta?.name).sort()).toEqual(
        ['Customers', 'Orders'].sort()
      );
      expect(
        duplicatedTableNodes.find(({ resourceMeta }) => resourceMeta?.name === 'Orders')?.parentId
      ).toBe(duplicatedFolders[0].id);

      const duplicatedTables = await getTableList(duplicateBaseId).then((res) => res.data);
      const duplicatedOrdersTable = duplicatedTables.find(({ name }) => name === 'Orders')!;
      const duplicatedCustomersTable = duplicatedTables.find(({ name }) => name === 'Customers')!;
      const duplicatedOrderFields = (await getFields(duplicatedOrdersTable.id)).data;
      expect(duplicatedTables.map(({ name }) => name).sort()).toEqual(['Customers', 'Orders']);
      expect(duplicatedOrderFields.find(({ name }) => name === customerLinkField.name)?.type).toBe(
        FieldType.Link
      );
      expect(duplicatedOrderFields.find(({ name }) => name === productLinkField.name)?.type).toBe(
        FieldType.SingleLineText
      );
      const duplicatedProductLookupField = duplicatedOrderFields.find(
        ({ name }) => name === productLookupField.name
      );
      expect(duplicatedProductLookupField?.type).toBe(FieldType.SingleLineText);
      expect(duplicatedProductLookupField?.isLookup).toBeFalsy();

      const duplicatedOrderRecords = await getRecords(duplicatedOrdersTable.id);
      const duplicatedCustomerRecords = await getRecords(duplicatedCustomersTable.id);
      expect(duplicatedOrderRecords.records[0].fields[customerLinkField.name]).toMatchObject([
        { id: duplicatedCustomerRecords.records[0].id },
      ]);
      const duplicatedProductLinkValue =
        duplicatedOrderRecords.records[0].fields[productLinkField.name];
      expect(
        duplicatedProductLinkValue === null ||
          duplicatedProductLinkValue === undefined ||
          duplicatedProductLinkValue === ''
      ).toBe(true);
    });
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
      const duplicatedTable = (await getTableList(duplicateBaseId)).data.find(
        ({ name }) => name === pluginTable.name
      )!;
      const pluginViews = (await getViewList(duplicatedTable.id)).data.filter(
        ({ type }) => type === ViewType.Plugin
      );

      expect(pluginViews.length).toBe(2);

      for (const sourceView of [sheetView1, sheetView2]) {
        const duplicatedView = pluginViews.find(({ name }) => name === sourceView.name)!;
        const duplicatedInstall = (
          await getViewInstallPlugin(duplicatedTable.id, duplicatedView.id)
        ).data;
        expect(duplicatedInstall.pluginInstallId).toBe(
          (duplicatedView.options as IPluginViewOptions).pluginInstallId
        );
        expect(duplicatedInstall.pluginInstallId).not.toBe(sourceView.pluginInstallId);
        expect(duplicatedInstall.baseId).toBe(duplicateBaseId);
      }
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
