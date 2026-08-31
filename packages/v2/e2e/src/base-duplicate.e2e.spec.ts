import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * v1 reference: community/apps/nestjs-backend/test/base-duplicate.e2e-spec.ts
 *
 * Native same-container base duplication is exposed through /bases/duplicate.
 * Portable schema, record and computed-field cases run below; scenarios that
 * still need space, node/plugin or last-visit contracts remain explicit todos.
 * Shared expectations for every executable scenario:
 * - drain the outbox before asserting computed values,
 * - remapped IDs: link cell values must point at duplicated record IDs,
 * - T6520: unchecked checkbox cells are stored as null and must stay null
 *   (never backfilled to false) in the duplicated tables.
 */
describe('base duplicate parity (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  // v1: "duplicate within current space" — duplicate without records;
  // duplicated tables exist with schema only, record count is 0.
  test('[V1 PARITY] duplicates base within the current space without records', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Structure Source' }),
    });
    expect(createBaseResponse.status).toBe(201);
    const createBaseBody = (await createBaseResponse.json()) as {
      ok: boolean;
      data?: { base: { id: string } };
    };
    expect(createBaseBody.ok).toBe(true);
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const sourceTable = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'checkbox', name: 'Done' },
      ],
    });
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const sourceNameFieldId = sourceTable.fields[0]!.id;
    const sourceDoneFieldId = sourceTable.fields[1]!.id;
    const properties = await client.tables.updateProperties({
      baseId: sourceBaseId,
      tableId: sourceTable.id,
      description: 'Portable project metadata',
      icon: '📋',
    });
    expect(properties.ok).toBe(true);
    const richView = await client.tables.createView({
      tableId: sourceTable.id,
      view: {
        type: 'grid',
        name: 'Planning',
        description: 'Portable planning view',
        columnMeta: { [sourceNameFieldId]: { width: 280 } },
        options: { rowHeight: 'short', frozenColumnCount: 1 },
        sort: [{ fieldId: sourceNameFieldId, order: 'asc' }],
        group: [{ fieldId: sourceDoneFieldId, order: 'desc' }],
        manualSort: false,
        isLocked: true,
        enableShare: true,
        shareMeta: { allowCopy: false, password: 'secret' },
      },
    });
    expect(richView.ok).toBe(true);
    if (!richView.ok) throw new Error(richView.error.message);
    const sourceRichViewId = richView.data.viewId;
    await ctx.createRecord(sourceTable.id, {
      [sourceTable.fields[0]!.id]: 'Source record',
      [sourceTable.fields[1]!.id]: true,
    });

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceBaseId,
        name: 'Structure Copy',
        withRecords: false,
      }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      ok: boolean;
      data?: {
        base: { id: string; name: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
        viewIdMap: Record<string, string>;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);
    expect(duplicateBody).toMatchObject({
      ok: true,
      data: {
        base: { name: 'Structure Copy' },
        tableIdMap: { [sourceTable.id]: expect.any(String) },
      },
    });

    const targetBaseId = duplicateBody.data?.base.id;
    const targetTableId = duplicateBody.data?.tableIdMap[sourceTable.id];
    const targetNameFieldId = duplicateBody.data?.fieldIdMap[sourceNameFieldId];
    const targetDoneFieldId = duplicateBody.data?.fieldIdMap[sourceDoneFieldId];
    const targetRichViewId = duplicateBody.data?.viewIdMap[sourceRichViewId];
    expect(targetBaseId).toBeDefined();
    expect(targetTableId).toBeDefined();
    expect(targetNameFieldId).toBeDefined();
    expect(targetDoneFieldId).toBeDefined();
    expect(targetRichViewId).toBeDefined();
    if (
      !targetBaseId ||
      !targetTableId ||
      !targetNameFieldId ||
      !targetDoneFieldId ||
      !targetRichViewId
    )
      return;

    expect(targetTableId).not.toBe(sourceTable.id);
    const targetTable = await ctx.getTableById(targetTableId, targetBaseId);
    expect(targetTable).toMatchObject({
      id: targetTableId,
      baseId: targetBaseId,
      name: 'Projects',
      description: 'Portable project metadata',
      icon: '📋',
      fields: [
        expect.objectContaining({ name: 'Name', type: 'singleLineText' }),
        expect.objectContaining({ name: 'Done', type: 'checkbox' }),
      ],
    });
    const targetView = await client.tables.getView({
      tableId: targetTableId,
      viewId: targetRichViewId,
    });
    expect(targetView.ok).toBe(true);
    if (!targetView.ok) throw new Error(targetView.error.message);
    expect(targetView).toMatchObject({
      ok: true,
      data: {
        view: {
          id: targetRichViewId,
          name: 'Planning',
          description: 'Portable planning view',
          options: { rowHeight: 'short', frozenColumnCount: 1 },
          sort: {
            sortObjs: [{ fieldId: targetNameFieldId, order: 'asc' }],
            manualSort: false,
          },
          group: [{ fieldId: targetDoneFieldId, order: 'desc' }],
          isLocked: true,
          columnMeta: { [targetNameFieldId]: { width: 280 } },
        },
      },
    });
    expect(targetView.data.view.enableShare ?? false).toBe(false);
    expect(targetView.data.view).not.toHaveProperty('shareId');
    expect(targetView.data.view).not.toHaveProperty('shareMeta');
    await expect(ctx.listRecords(targetTableId, { baseId: targetBaseId })).resolves.toEqual([]);
  });

  // v1: "duplicate with records" — withRecords: true; every table keeps its
  // record data, including null (unchecked) checkbox cells (T6520).
  test('[V1 PARITY] duplicates base with records and preserves cell values', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Record Source' }),
    });
    expect(createBaseResponse.status).toBe(201);
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const sourceTable = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Tasks',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'checkbox', name: 'Done' },
      ],
    });
    const nameFieldId = sourceTable.fields[0]!.id;
    const doneFieldId = sourceTable.fields[1]!.id;
    await ctx.createRecord(sourceTable.id, {
      [nameFieldId]: 'Checked',
      [doneFieldId]: true,
    });
    await ctx.createRecord(sourceTable.id, { [nameFieldId]: 'Unchecked' });

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      ok: boolean;
      data?: {
        base: { id: string; name: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
        recordsLength: number;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);
    expect(duplicateBody).toMatchObject({
      ok: true,
      data: {
        base: { name: 'Record Source (Copy)' },
        recordsLength: 2,
      },
    });

    const targetBaseId = duplicateBody.data?.base.id;
    const targetTableId = duplicateBody.data?.tableIdMap[sourceTable.id];
    const targetNameFieldId = duplicateBody.data?.fieldIdMap[nameFieldId];
    const targetDoneFieldId = duplicateBody.data?.fieldIdMap[doneFieldId];
    expect(targetBaseId).toBeDefined();
    expect(targetTableId).toBeDefined();
    expect(targetNameFieldId).toBeDefined();
    expect(targetDoneFieldId).toBeDefined();
    if (!targetBaseId || !targetTableId || !targetNameFieldId || !targetDoneFieldId) return;

    const records = await ctx.listRecords(targetTableId, { baseId: targetBaseId });
    expect(records).toHaveLength(2);
    const checked = records.find((record) => record.fields[targetNameFieldId] === 'Checked');
    const unchecked = records.find((record) => record.fields[targetNameFieldId] === 'Unchecked');
    expect(checked?.fields[targetDoneFieldId]).toBe(true);
    expect(unchecked?.fields[targetDoneFieldId] ?? null).toBeNull();
  });

  // v1: "duplicate base with link field" — two-way link between table1/table2,
  // relationship changed oneMany <-> manyMany before duplicating, lookup on
  // the linked table. Duplicated link cells must reference duplicated record
  // IDs, lookup values must be preserved and continue to update.
  test('[V1 PARITY] duplicates base with link field, lookup field and records', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Link Source' }),
    });
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(createBaseResponse.status).toBe(201);
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const productNameId = `fld${'bdpname'.padEnd(16, '0')}`;
    const productPriceId = `fld${'bdprice'.padEnd(16, '0')}`;
    const orderNameId = `fld${'bdoname'.padEnd(16, '0')}`;
    const orderProductId = `fld${'bdolink'.padEnd(16, '0')}`;
    const orderPriceId = `fld${'bdolook'.padEnd(16, '0')}`;
    const products = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Products',
      fields: [
        { type: 'singleLineText', id: productNameId, name: 'Name', isPrimary: true },
        { type: 'number', id: productPriceId, name: 'Price' },
      ],
      views: [{ type: 'grid' }],
    });
    const orders = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Orders',
      fields: [
        { type: 'singleLineText', id: orderNameId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: orderProductId,
          name: 'Product',
          options: {
            relationship: 'manyOne',
            foreignTableId: products.id,
            lookupFieldId: productNameId,
          },
        },
        {
          type: 'lookup',
          id: orderPriceId,
          name: 'Price lookup',
          options: {
            linkFieldId: orderProductId,
            foreignTableId: products.id,
            lookupFieldId: productPriceId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const product = await ctx.createRecord(products.id, {
      [productNameId]: 'Keyboard',
      [productPriceId]: 99,
    });
    await ctx.createRecord(orders.id, {
      [orderNameId]: 'Order 1',
      [orderProductId]: { id: product.id },
    });
    await ctx.drainOutbox();

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      ok: boolean;
      data?: {
        base: { id: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
      };
      error?: unknown;
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);

    const targetBaseId = duplicateBody.data?.base.id;
    const targetProductsId = duplicateBody.data?.tableIdMap[products.id];
    const targetOrdersId = duplicateBody.data?.tableIdMap[orders.id];
    const targetProductPriceId = duplicateBody.data?.fieldIdMap[productPriceId];
    const targetOrderProductId = duplicateBody.data?.fieldIdMap[orderProductId];
    const targetOrderPriceId = duplicateBody.data?.fieldIdMap[orderPriceId];
    expect(targetBaseId).toBeDefined();
    expect(targetProductsId).toBeDefined();
    expect(targetOrdersId).toBeDefined();
    expect(targetProductPriceId).toBeDefined();
    expect(targetOrderProductId).toBeDefined();
    expect(targetOrderPriceId).toBeDefined();
    if (
      !targetBaseId ||
      !targetProductsId ||
      !targetOrdersId ||
      !targetProductPriceId ||
      !targetOrderProductId ||
      !targetOrderPriceId
    )
      return;

    const [targetProduct] = await ctx.listRecords(targetProductsId, { baseId: targetBaseId });
    const [targetOrder] = await ctx.listRecords(targetOrdersId, { baseId: targetBaseId });
    expect(targetOrder?.fields[targetOrderProductId]).toEqual(
      expect.objectContaining({ id: targetProduct?.id })
    );
    // Native v2 lookup values keep a uniform array shape regardless of link multiplicity.
    expect(targetOrder?.fields[targetOrderPriceId]).toEqual([99]);

    expect(targetProduct).toBeDefined();
    if (!targetProduct) return;
    await ctx.updateRecord(targetProductsId, targetProduct.id, { [targetProductPriceId]: 125 });
    await ctx.drainOutbox();
    const [updatedTargetOrder] = await ctx.listRecords(targetOrdersId, { baseId: targetBaseId });
    expect(updatedTargetOrder?.fields[targetOrderPriceId]).toEqual([125]);
  });

  // v1: "should duplicate base with bidirectional link field" + "duplicates
  // bidirectional link records through v2 stream copy" — the symmetric field
  // pair and the junction table rows must be copied and remapped.
  test('[V1 PARITY] duplicates bidirectional link fields and junction data', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bidirectional Link Source' }),
    });
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(createBaseResponse.status).toBe(201);
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const projectNameId = `fld${'bdproject'.padEnd(16, '0')}`;
    const taskNameId = `fld${'bdtask'.padEnd(16, '0')}`;
    const taskProjectsId = `fld${'bdtwoway'.padEnd(16, '0')}`;
    const projects = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Projects',
      fields: [{ type: 'singleLineText', id: projectNameId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const tasks = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Tasks',
      fields: [
        { type: 'singleLineText', id: taskNameId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: taskProjectsId,
          name: 'Projects',
          options: {
            relationship: 'manyMany',
            foreignTableId: projects.id,
            lookupFieldId: projectNameId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const projectsWithLink = await ctx.getTableById(projects.id, sourceBaseId);
    const symmetricField = projectsWithLink.fields.find(
      (field) =>
        field.type === 'link' &&
        (field.options as { symmetricFieldId?: string }).symmetricFieldId === taskProjectsId
    );
    expect(symmetricField).toBeDefined();
    if (!symmetricField) return;

    const projectA = await ctx.createRecord(projects.id, { [projectNameId]: 'Project A' });
    const projectB = await ctx.createRecord(projects.id, { [projectNameId]: 'Project B' });
    const taskA = await ctx.createRecord(tasks.id, {
      [taskNameId]: 'Task A',
      [taskProjectsId]: [{ id: projectA.id }, { id: projectB.id }],
    });
    const taskB = await ctx.createRecord(tasks.id, {
      [taskNameId]: 'Task B',
      [taskProjectsId]: [{ id: projectB.id }],
    });
    await ctx.drainOutbox();

    const sourceTasks = await ctx.listRecords(tasks.id, { baseId: sourceBaseId });
    expect(
      sourceTasks.find((record) => record.id === taskA.id)?.fields[taskProjectsId]
    ).toMatchObject([{ id: projectA.id }, { id: projectB.id }]);
    expect(
      sourceTasks.find((record) => record.id === taskB.id)?.fields[taskProjectsId]
    ).toMatchObject([{ id: projectB.id }]);

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      data?: {
        base: { id: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);

    const targetBaseId = duplicateBody.data?.base.id;
    const targetProjectsId = duplicateBody.data?.tableIdMap[projects.id];
    const targetTasksId = duplicateBody.data?.tableIdMap[tasks.id];
    const targetTaskProjectsId = duplicateBody.data?.fieldIdMap[taskProjectsId];
    const targetSymmetricFieldId = duplicateBody.data?.fieldIdMap[symmetricField.id];
    expect(targetBaseId).toBeDefined();
    expect(targetProjectsId).toBeDefined();
    expect(targetTasksId).toBeDefined();
    if (
      !targetBaseId ||
      !targetProjectsId ||
      !targetTasksId ||
      !targetTaskProjectsId ||
      !targetSymmetricFieldId
    )
      return;

    const targetTasks = await ctx.listRecords(targetTasksId, { baseId: targetBaseId });
    const targetProjects = await ctx.listRecords(targetProjectsId, { baseId: targetBaseId });
    const targetTaskA = targetTasks.find((record) => record.id === taskA.id);
    const targetTaskB = targetTasks.find((record) => record.id === taskB.id);
    const targetProjectA = targetProjects.find((record) => record.id === projectA.id);
    const targetProjectB = targetProjects.find((record) => record.id === projectB.id);

    expect(targetTaskA?.fields[targetTaskProjectsId]).toMatchObject([
      { id: targetProjectA?.id },
      { id: targetProjectB?.id },
    ]);
    expect(targetTaskB?.fields[targetTaskProjectsId]).toMatchObject([{ id: targetProjectB?.id }]);
    expect(targetProjectA?.fields[targetSymmetricFieldId]).toMatchObject([{ id: targetTaskA?.id }]);
    const targetProjectBLinks = targetProjectB?.fields[targetSymmetricFieldId];
    expect(targetProjectBLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetTaskA?.id }),
        expect.objectContaining({ id: targetTaskB?.id }),
      ])
    );
    expect(targetProjectBLinks).toHaveLength(2);

    const targetProjectsSchema = await ctx.getTableById(targetProjectsId, targetBaseId);
    const targetSymmetricField = targetProjectsSchema.fields.find(
      (field) => field.id === targetSymmetricFieldId
    );
    expect(targetSymmetricField).toMatchObject({
      type: 'link',
      options: expect.objectContaining({
        foreignTableId: targetTasksId,
        symmetricFieldId: targetTaskProjectsId,
      }),
    });
  });

  // v1: "duplicate base with tables which have primary formula field,
  // expression with link field" — formula expression field IDs are remapped
  // and the formula keeps evaluating in the duplicated base.
  test('[V1 PARITY] duplicates primary formula field whose expression references a link field', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Primary Formula Source' }),
    });
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(createBaseResponse.status).toBe(201);
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const categoryNameId = `fld${'bdcatname'.padEnd(16, '0')}`;
    const categories = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Categories',
      fields: [{ type: 'singleLineText', id: categoryNameId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const categoryLinkId = `fld${'bdformlink'.padEnd(16, '0')}`;
    const formulaPrimaryId = `fld${'bdformpri'.padEnd(16, '0')}`;
    const items = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Items',
      fields: [
        {
          type: 'link',
          id: categoryLinkId,
          name: 'Categories',
          options: {
            relationship: 'manyMany',
            foreignTableId: categories.id,
            lookupFieldId: categoryNameId,
            isOneWay: true,
          },
        },
        {
          type: 'formula',
          id: formulaPrimaryId,
          name: 'Display',
          isPrimary: true,
          options: { expression: `{${categoryLinkId}}` },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const category = await ctx.createRecord(categories.id, { [categoryNameId]: 'Hardware' });
    const sourceItem = await ctx.createRecord(items.id, {
      [categoryLinkId]: [{ id: category.id }],
    });
    await ctx.drainOutbox();
    const sourceItemValue = (await ctx.listRecords(items.id, { baseId: sourceBaseId })).find(
      (record) => record.id === sourceItem.id
    )?.fields[formulaPrimaryId];

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      data?: {
        base: { id: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);

    const targetBaseId = duplicateBody.data?.base.id;
    const targetCategoriesId = duplicateBody.data?.tableIdMap[categories.id];
    const targetItemsId = duplicateBody.data?.tableIdMap[items.id];
    const targetCategoryNameId = duplicateBody.data?.fieldIdMap[categoryNameId];
    const targetCategoryLinkId = duplicateBody.data?.fieldIdMap[categoryLinkId];
    const targetFormulaPrimaryId = duplicateBody.data?.fieldIdMap[formulaPrimaryId];
    expect(targetBaseId).toBeDefined();
    expect(targetCategoriesId).toBeDefined();
    expect(targetItemsId).toBeDefined();
    expect(targetCategoryNameId).toBeDefined();
    expect(targetCategoryLinkId).toBeDefined();
    expect(targetFormulaPrimaryId).toBeDefined();
    if (
      !targetBaseId ||
      !targetCategoriesId ||
      !targetItemsId ||
      !targetCategoryNameId ||
      !targetCategoryLinkId ||
      !targetFormulaPrimaryId
    )
      return;

    const sourceFormulaField = items.fields.find((field) => field.id === formulaPrimaryId);
    expect(sourceFormulaField).toMatchObject({ type: 'formula' });
    if (!sourceFormulaField || sourceFormulaField.type !== 'formula') return;
    const targetItemsSchema = await ctx.getTableById(targetItemsId, targetBaseId);
    const targetFormulaField = targetItemsSchema.fields.find(
      (field) => field.id === targetFormulaPrimaryId
    );
    expect(targetFormulaField).toMatchObject({
      type: 'formula',
      isPrimary: true,
      cellValueType: sourceFormulaField?.cellValueType,
      options: expect.objectContaining({
        expression: `{${targetCategoryLinkId}}`,
      }),
    });

    const targetItem = (await ctx.listRecords(targetItemsId, { baseId: targetBaseId })).find(
      (record) => record.id === sourceItem.id
    );
    expect(targetItem?.fields[targetFormulaPrimaryId]).toEqual(sourceItemValue);

    await ctx.updateRecord(targetCategoriesId, category.id, {
      [targetCategoryNameId]: 'Devices',
    });
    await ctx.drainOutbox();
    const updatedTargetItem = (await ctx.listRecords(targetItemsId, { baseId: targetBaseId })).find(
      (record) => record.id === sourceItem.id
    );
    expect(updatedTargetItem?.fields[targetFormulaPrimaryId]).toContain('Devices');
  });

  // v1: "duplicates formula, link, lookup, rollup, bidirectional link, and ai
  // field config through v2" + "should duplicate ai field relative config" —
  // computed chains keep working, aiConfig source field IDs are remapped to
  // the duplicated fields.
  test('[V1 PARITY] duplicates formula, link, lookup, rollup chains and AI field config', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Computed Chain Source' }),
    });
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(createBaseResponse.status).toBe(201);
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const peopleNameId = `fld${'bdpersonname'.padEnd(16, '0')}`;
    const peopleScoreId = `fld${'bdpersonscore'.padEnd(16, '0')}`;
    const doubledScoreId = `fld${'bddoubled'.padEnd(16, '0')}`;
    const aiSummaryId = `fld${'bdaisummary'.padEnd(16, '0')}`;
    const people = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'People',
      fields: [
        { type: 'singleLineText', id: peopleNameId, name: 'Name', isPrimary: true },
        { type: 'number', id: peopleScoreId, name: 'Score' },
        {
          type: 'formula',
          id: doubledScoreId,
          name: 'Doubled Score',
          options: { expression: `{${peopleScoreId}} * 2` },
        },
        {
          type: 'singleLineText',
          id: aiSummaryId,
          name: 'AI Summary',
          aiConfig: {
            modelKey: 'aiGateway@test@teable',
            isAutoFill: true,
            type: 'summary',
            sourceFieldId: peopleNameId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const taskNameId = `fld${'bdctaskname'.padEnd(16, '0')}`;
    const taskOwnerId = `fld${'bdcowner'.padEnd(16, '0')}`;
    const taskOwnerNameId = `fld${'bdcownername'.padEnd(16, '0')}`;
    const taskScoreSumId = `fld${'bdcscoresum'.padEnd(16, '0')}`;
    const tasks = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Tasks',
      fields: [
        { type: 'singleLineText', id: taskNameId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: taskOwnerId,
          name: 'Owners',
          options: {
            relationship: 'manyMany',
            foreignTableId: people.id,
            lookupFieldId: peopleNameId,
          },
        },
        {
          type: 'lookup',
          id: taskOwnerNameId,
          name: 'Owner Name',
          options: {
            linkFieldId: taskOwnerId,
            foreignTableId: people.id,
            lookupFieldId: peopleNameId,
          },
        },
        {
          type: 'rollup',
          id: taskScoreSumId,
          name: 'Owner Score Sum',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: taskOwnerId,
            foreignTableId: people.id,
            lookupFieldId: peopleScoreId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const peopleWithLink = await ctx.getTableById(people.id, sourceBaseId);
    expect(peopleWithLink.fields.find((field) => field.id === aiSummaryId)).toMatchObject({
      aiConfig: expect.objectContaining({ sourceFieldId: peopleNameId }),
    });
    const symmetricOwnerField = peopleWithLink.fields.find(
      (field) =>
        field.type === 'link' &&
        (field.options as { symmetricFieldId?: string }).symmetricFieldId === taskOwnerId
    );
    expect(symmetricOwnerField).toBeDefined();
    if (!symmetricOwnerField) return;

    const alice = await ctx.createRecord(people.id, {
      [peopleNameId]: 'Alice',
      [peopleScoreId]: 11,
    });
    const task = await ctx.createRecord(tasks.id, {
      [taskNameId]: 'Task A',
      [taskOwnerId]: [{ id: alice.id }],
    });
    await ctx.drainOutbox();

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      data?: {
        base: { id: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);

    const targetBaseId = duplicateBody.data?.base.id;
    const targetPeopleId = duplicateBody.data?.tableIdMap[people.id];
    const targetTasksId = duplicateBody.data?.tableIdMap[tasks.id];
    const targetPeopleNameId = duplicateBody.data?.fieldIdMap[peopleNameId];
    const targetPeopleScoreId = duplicateBody.data?.fieldIdMap[peopleScoreId];
    const targetDoubledScoreId = duplicateBody.data?.fieldIdMap[doubledScoreId];
    const targetAiSummaryId = duplicateBody.data?.fieldIdMap[aiSummaryId];
    const targetTaskOwnerId = duplicateBody.data?.fieldIdMap[taskOwnerId];
    const targetTaskOwnerNameId = duplicateBody.data?.fieldIdMap[taskOwnerNameId];
    const targetTaskScoreSumId = duplicateBody.data?.fieldIdMap[taskScoreSumId];
    const targetSymmetricOwnerId = duplicateBody.data?.fieldIdMap[symmetricOwnerField.id];
    expect(targetBaseId).toBeDefined();
    expect(targetPeopleId).toBeDefined();
    expect(targetTasksId).toBeDefined();
    expect(targetPeopleNameId).toBeDefined();
    expect(targetPeopleScoreId).toBeDefined();
    expect(targetDoubledScoreId).toBeDefined();
    expect(targetAiSummaryId).toBeDefined();
    expect(targetTaskOwnerId).toBeDefined();
    expect(targetTaskOwnerNameId).toBeDefined();
    expect(targetTaskScoreSumId).toBeDefined();
    expect(targetSymmetricOwnerId).toBeDefined();
    if (
      !targetBaseId ||
      !targetPeopleId ||
      !targetTasksId ||
      !targetPeopleNameId ||
      !targetPeopleScoreId ||
      !targetDoubledScoreId ||
      !targetAiSummaryId ||
      !targetTaskOwnerId ||
      !targetTaskOwnerNameId ||
      !targetTaskScoreSumId ||
      !targetSymmetricOwnerId
    )
      return;

    const targetPeopleSchema = await ctx.getTableById(targetPeopleId, targetBaseId);
    const targetTasksSchema = await ctx.getTableById(targetTasksId, targetBaseId);
    expect(
      targetPeopleSchema.fields.find((field) => field.id === targetDoubledScoreId)
    ).toMatchObject({
      type: 'formula',
      options: expect.objectContaining({ expression: `{${targetPeopleScoreId}} * 2` }),
    });
    expect(targetPeopleSchema.fields.find((field) => field.id === targetAiSummaryId)).toMatchObject(
      {
        aiConfig: expect.objectContaining({ sourceFieldId: targetPeopleNameId }),
      }
    );
    expect(targetTasksSchema.fields.find((field) => field.id === targetTaskOwnerId)).toMatchObject({
      type: 'link',
      options: expect.objectContaining({ foreignTableId: targetPeopleId }),
    });
    expect(
      targetTasksSchema.fields.find((field) => field.id === targetTaskOwnerNameId)
    ).toMatchObject({
      isLookup: true,
      lookupOptions: expect.objectContaining({
        linkFieldId: targetTaskOwnerId,
        foreignTableId: targetPeopleId,
        lookupFieldId: targetPeopleNameId,
      }),
    });
    expect(
      targetTasksSchema.fields.find((field) => field.id === targetTaskScoreSumId)
    ).toMatchObject({
      type: 'rollup',
      config: expect.objectContaining({
        linkFieldId: targetTaskOwnerId,
        foreignTableId: targetPeopleId,
        lookupFieldId: targetPeopleScoreId,
      }),
    });

    const targetPerson = (await ctx.listRecords(targetPeopleId, { baseId: targetBaseId })).find(
      (record) => record.id === alice.id
    );
    const targetTask = (await ctx.listRecords(targetTasksId, { baseId: targetBaseId })).find(
      (record) => record.id === task.id
    );
    expect(targetPerson?.fields[targetDoubledScoreId]).toBe(22);
    expect(targetPerson?.fields[targetSymmetricOwnerId]).toMatchObject([{ id: targetTask?.id }]);
    expect(targetTask?.fields[targetTaskOwnerId]).toMatchObject([{ id: targetPerson?.id }]);
    expect(targetTask?.fields[targetTaskOwnerNameId]).toEqual(['Alice']);
    expect(targetTask?.fields[targetTaskScoreSumId]).toBe(11);

    await ctx.updateRecord(targetPeopleId, alice.id, {
      [targetPeopleNameId]: 'Alice Updated',
      [targetPeopleScoreId]: 13,
    });
    await ctx.drainOutbox();
    const updatedTargetPerson = (
      await ctx.listRecords(targetPeopleId, { baseId: targetBaseId })
    ).find((record) => record.id === alice.id);
    const updatedTargetTask = (await ctx.listRecords(targetTasksId, { baseId: targetBaseId })).find(
      (record) => record.id === task.id
    );
    expect(updatedTargetPerson?.fields[targetDoubledScoreId]).toBe(26);
    expect(updatedTargetTask?.fields[targetTaskOwnerNameId]).toEqual(['Alice Updated']);
    expect(updatedTargetTask?.fields[targetTaskScoreSumId]).toBe(13);
  });

  // v1: "should autoNumber work in a duplicated table" — existing autoNumber
  // values are copied and new records continue the sequence.
  test('[V1 PARITY] keeps autoNumber sequence working in a duplicated base', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Auto Number Source' }),
    });
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(createBaseResponse.status).toBe(201);
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const sourceTable = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Tickets',
      fields: [
        { type: 'singleLineText', name: 'Title' },
        { type: 'autoNumber', name: 'No.' },
      ],
      views: [{ type: 'grid' }],
    });
    const sourceTitleId = sourceTable.fields[0]!.id;
    const sourceAutoNumberId = sourceTable.fields[1]!.id;
    await ctx.createRecord(sourceTable.id, { [sourceTitleId]: 'First' });
    await ctx.createRecord(sourceTable.id, { [sourceTitleId]: 'Second' });

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      data?: {
        base: { id: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);

    const targetBaseId = duplicateBody.data?.base.id;
    const targetTableId = duplicateBody.data?.tableIdMap[sourceTable.id];
    const targetTitleId = duplicateBody.data?.fieldIdMap[sourceTitleId];
    const targetAutoNumberId = duplicateBody.data?.fieldIdMap[sourceAutoNumberId];
    expect(targetBaseId).toBeDefined();
    expect(targetTableId).toBeDefined();
    expect(targetTitleId).toBeDefined();
    expect(targetAutoNumberId).toBeDefined();
    if (!targetBaseId || !targetTableId || !targetTitleId || !targetAutoNumberId) return;

    const copiedRecords = await ctx.listRecords(targetTableId, { baseId: targetBaseId });
    const copiedNumbers = copiedRecords
      .map((record) => record.fields[targetAutoNumberId])
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => left - right);
    expect(copiedNumbers).toEqual([1, 2]);

    const third = await ctx.createRecord(targetTableId, { [targetTitleId]: 'Third' });
    const latestRecords = await ctx.listRecords(targetTableId, { baseId: targetBaseId });
    expect(latestRecords.find((record) => record.id === third.id)?.fields[targetAutoNumberId]).toBe(
      3
    );
  });

  /**
   * Space, node, plugin and last-visit behavior belongs to the Nest host
   * coordinator rather than the same-container v2 HTTP harness. Executable
   * `forceV2All` coverage lives in:
   * community/apps/nestjs-backend/test/base-duplicate.e2e-spec.ts
   *
   * - cross-space/cross-base link and lookup downgrade,
   * - duplication into another space,
   * - folder, dashboard and plugin duplication,
   * - selected nodes with parent-folder preservation,
   * - disconnected link and lookup conversion for a partial graph,
   * - last-visit seeding for the recent-base list.
   */

  // v1: "should duplicate link field data correctly with multiple records" —
  // one-way multi-value link cells across several records stay consistent
  // after record ID remapping. Bidirectional data is covered separately above.
  test('[V1 PARITY] duplicates link field data correctly with multiple records', async () => {
    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Multi-record Link Source' }),
    });
    const createBaseBody = (await createBaseResponse.json()) as {
      data?: { base: { id: string } };
    };
    const sourceBaseId = createBaseBody.data?.base.id;
    expect(createBaseResponse.status).toBe(201);
    expect(sourceBaseId).toBeDefined();
    if (!sourceBaseId) return;

    const categoryNameId = `fld${'bdmulticat'.padEnd(16, '0')}`;
    const productNameId = `fld${'bdmultiprod'.padEnd(16, '0')}`;
    const productCategoriesId = `fld${'bdmultilink'.padEnd(16, '0')}`;
    const categories = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Categories',
      fields: [{ type: 'singleLineText', id: categoryNameId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const products = await ctx.createTable({
      baseId: sourceBaseId,
      name: 'Products',
      fields: [
        { type: 'singleLineText', id: productNameId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: productCategoriesId,
          name: 'Categories',
          options: {
            relationship: 'manyMany',
            foreignTableId: categories.id,
            lookupFieldId: categoryNameId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const categoryA = await ctx.createRecord(categories.id, { [categoryNameId]: 'Category A' });
    const categoryB = await ctx.createRecord(categories.id, { [categoryNameId]: 'Category B' });
    await ctx.createRecord(products.id, {
      [productNameId]: 'Product A',
      [productCategoriesId]: [{ id: categoryA.id }, { id: categoryB.id }],
    });
    await ctx.createRecord(products.id, {
      [productNameId]: 'Product B',
      [productCategoriesId]: [{ id: categoryB.id }],
    });
    await ctx.createRecord(products.id, { [productNameId]: 'Product C' });

    const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceBaseId, withRecords: true }),
    });
    const duplicateBody = (await duplicateResponse.json()) as {
      data?: {
        base: { id: string };
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
      };
    };
    expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);

    const targetBaseId = duplicateBody.data?.base.id;
    const targetCategoriesId = duplicateBody.data?.tableIdMap[categories.id];
    const targetProductsId = duplicateBody.data?.tableIdMap[products.id];
    const targetCategoryNameId = duplicateBody.data?.fieldIdMap[categoryNameId];
    const targetProductNameId = duplicateBody.data?.fieldIdMap[productNameId];
    const targetProductCategoriesId = duplicateBody.data?.fieldIdMap[productCategoriesId];
    expect(targetBaseId).toBeDefined();
    expect(targetCategoriesId).toBeDefined();
    expect(targetProductsId).toBeDefined();
    expect(targetCategoryNameId).toBeDefined();
    expect(targetProductNameId).toBeDefined();
    expect(targetProductCategoriesId).toBeDefined();
    if (
      !targetBaseId ||
      !targetCategoriesId ||
      !targetProductsId ||
      !targetCategoryNameId ||
      !targetProductNameId ||
      !targetProductCategoriesId
    )
      return;

    const targetCategories = await ctx.listRecords(targetCategoriesId, { baseId: targetBaseId });
    const targetProducts = await ctx.listRecords(targetProductsId, { baseId: targetBaseId });
    const targetCategoryA = targetCategories.find(
      (record) => record.fields[targetCategoryNameId] === 'Category A'
    );
    const targetCategoryB = targetCategories.find(
      (record) => record.fields[targetCategoryNameId] === 'Category B'
    );
    const targetProductA = targetProducts.find(
      (record) => record.fields[targetProductNameId] === 'Product A'
    );
    const targetProductB = targetProducts.find(
      (record) => record.fields[targetProductNameId] === 'Product B'
    );
    const targetProductC = targetProducts.find(
      (record) => record.fields[targetProductNameId] === 'Product C'
    );

    expect(targetProductA?.fields[targetProductCategoriesId]).toMatchObject([
      { id: targetCategoryA?.id },
      { id: targetCategoryB?.id },
    ]);
    expect(targetProductB?.fields[targetProductCategoriesId]).toMatchObject([
      { id: targetCategoryB?.id },
    ]);
    const emptyLinkValue = targetProductC?.fields[targetProductCategoriesId];
    expect(
      emptyLinkValue == null || (Array.isArray(emptyLinkValue) && emptyLinkValue.length === 0)
    ).toBe(true);

    const targetProductsSchema = await ctx.getTableById(targetProductsId, targetBaseId);
    expect(
      targetProductsSchema.fields.find((field) => field.id === targetProductCategoriesId)
    ).toMatchObject({
      type: 'link',
      options: expect.objectContaining({
        relationship: 'manyMany',
        foreignTableId: targetCategoriesId,
        lookupFieldId: targetCategoryNameId,
        isOneWay: true,
      }),
    });
  });
});
