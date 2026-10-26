import {
  apiErrorResponseDtoSchema,
  createRecordOkResponseSchema,
  createRecordsOkResponseSchema,
  deleteFieldOkResponseSchema,
  submitRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import {
  FieldOperationKind,
  ok,
  RecordWriteOperationKind,
  v2CoreTokens,
  type IFieldOperationPlugin,
  type IRecordWritePlugin,
  type TableQueryService,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type OrderInput = {
  viewId: string;
  anchorId: string;
  position: 'before' | 'after';
};

type CreateOperation = 'createRecord' | 'createRecords' | 'submitRecord';

/**
 * T8080: the create paths (`CreateRecordHandler`, `CreateRecordsHandler`,
 * `SubmitRecordHandler`) auto-create select options from `typecast` input, i.e.
 * they write table metadata. Before this fix they bypassed
 * `ITableSchemaCoordination` entirely, so a create could commit inside a
 * field-deletion lease and two concurrent creates could build their option list
 * from the same stale metadata and drop each other's options.
 *
 * Every race below uses real HTTP requests and real PostgreSQL advisory locks;
 * blocked writers are observed through `pg_locks` instead of sleeping.
 */

type Gate = {
  wait: Promise<void>;
  open: () => void;
};

const createGate = (): Gate => {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { wait: promise, open: resolve };
};

const delay = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

interface CreateFixture {
  tableId: string;
  nameFieldId: string;
  statusFieldId: string;
  markerFieldId: string;
  deleteTargetFieldId: string;
  formId: string;
  gridViewId: string;
}

const createFixture = async (ctx: SharedTestContext, suffix: string): Promise<CreateFixture> => {
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `T8080 create coordination ${suffix} ${Date.now()}`,
    fields: [
      { name: 'Name', type: 'singleLineText', isPrimary: true },
      {
        name: 'Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'Alpha', color: 'blueLight1' },
            { name: 'Beta', color: 'greenLight1' },
          ],
        },
      },
      { name: 'Delete target', type: 'singleLineText' },
      { name: 'Marker', type: 'singleLineText' },
    ],
    views: [
      { type: 'grid', name: 'Grid' },
      { type: 'form', name: 'Create form' },
    ],
  });

  const nameField = table.fields.find((field) => field.name === 'Name');
  const statusField = table.fields.find((field) => field.name === 'Status');
  const deleteTargetField = table.fields.find((field) => field.name === 'Delete target');
  const markerField = table.fields.find((field) => field.name === 'Marker');
  const form = table.views.find((view) => view.type === 'form');
  const grid = table.views.find((view) => view.type === 'grid');
  expect(nameField?.id).toBeTruthy();
  expect(statusField?.id).toBeTruthy();
  expect(deleteTargetField?.id).toBeTruthy();
  expect(markerField?.id).toBeTruthy();
  expect(form?.id).toBeTruthy();
  expect(grid?.id).toBeTruthy();

  const formMetaResponse = await fetch(`${ctx.baseUrl}/tables/updateViewColumnMeta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId: table.id,
      viewId: form!.id,
      columnMeta: [{ fieldId: nameField!.id, columnMeta: { required: true } }],
    }),
  });
  expect(formMetaResponse.status).toBe(200);

  return {
    tableId: table.id,
    nameFieldId: nameField!.id,
    statusFieldId: statusField!.id,
    markerFieldId: markerField!.id,
    deleteTargetFieldId: deleteTargetField!.id,
    formId: form!.id,
    gridViewId: grid!.id,
  };
};

const countSchemaCoordinationWaiters = async (ctx: SharedTestContext): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM pg_locks locks
    JOIN pg_stat_activity activity ON activity.pid = locks.pid
    WHERE locks.locktype = 'advisory'
      AND NOT locks.granted
      AND activity.application_name = 'teable-v2-schema-coordination'
  `.execute(ctx.testContainer.db);
  return Number(result.rows[0]?.count ?? 0);
};

/** Pauses a real create request after it has acquired its coordination lease. */
const createMarkerGatePlugin = (options: {
  name: string;
  tableId: string;
  markerFieldId: string;
  marker: string;
  entered: Gate;
  gate: Gate;
}): IRecordWritePlugin => {
  const run = async (context: Parameters<NonNullable<IRecordWritePlugin['guard']>>[0]) => {
    if (
      context.kind !== RecordWriteOperationKind.createOne &&
      context.kind !== RecordWriteOperationKind.createMany &&
      context.kind !== RecordWriteOperationKind.submit
    )
      return ok(undefined);
    if (context.table.id().toString() !== options.tableId) return ok(undefined);
    const payload = context.payload;
    const hasMarker =
      'fieldValues' in payload
        ? payload.fieldValues.get(options.markerFieldId) === options.marker
        : payload.recordsFieldValues.some(
            (fieldValues) => fieldValues.get(options.markerFieldId) === options.marker
          );
    if (!hasMarker) return ok(undefined);
    options.entered.open();
    await options.gate.wait;
    return ok(undefined);
  };

  return {
    name: options.name,
    supports: (operation) =>
      operation === RecordWriteOperationKind.createOne ||
      operation === RecordWriteOperationKind.createMany ||
      operation === RecordWriteOperationKind.submit,
    guard: run,
  };
};

const createDeleteGatePlugin = (options: {
  name: string;
  tableId: string;
  fieldId: string;
  entered: Gate;
  gate: Gate;
}): IFieldOperationPlugin => ({
  name: options.name,
  supports: (operation) => operation === FieldOperationKind.delete,
  beforePersist: async (context) => {
    if (context.kind !== FieldOperationKind.delete) return ok(undefined);
    if (context.table.id().toString() !== options.tableId) return ok(undefined);
    if (context.payload.fieldId.toString() !== options.fieldId) return ok(undefined);
    options.entered.open();
    await options.gate.wait;
    return ok(undefined);
  },
});

const addRecordPlugin = (ctx: SharedTestContext, plugin: IRecordWritePlugin): (() => void) => {
  const plugins = ctx.testContainer.container.resolve<IRecordWritePlugin[]>(
    v2CoreTokens.recordWritePlugins
  );
  plugins.push(plugin);
  return () => {
    const index = plugins.indexOf(plugin);
    if (index >= 0) plugins.splice(index, 1);
  };
};

const addFieldPlugin = (ctx: SharedTestContext, plugin: IFieldOperationPlugin): (() => void) => {
  const plugins = ctx.testContainer.container.resolve<IFieldOperationPlugin[]>(
    v2CoreTokens.fieldOperationPlugins
  );
  plugins.push(plugin);
  return () => {
    const index = plugins.indexOf(plugin);
    if (index >= 0) plugins.splice(index, 1);
  };
};

const submitCreate = (
  ctx: SharedTestContext,
  tableId: string,
  fields: Record<string, unknown>,
  typecast = true,
  order?: OrderInput,
  requestId?: string
): Promise<Response> =>
  fetch(`${ctx.baseUrl}/tables/createRecord`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    body: JSON.stringify({
      tableId,
      fieldKeyType: 'name',
      fields,
      typecast,
      ...(order ? { order } : {}),
    }),
  });

const submitCreates = (
  ctx: SharedTestContext,
  tableId: string,
  records: Array<{ fields: Record<string, unknown> }>,
  typecast = true,
  order?: OrderInput,
  requestId?: string
): Promise<Response> =>
  fetch(`${ctx.baseUrl}/tables/createRecords`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    body: JSON.stringify({
      tableId,
      fieldKeyType: 'name',
      records,
      typecast,
      ...(order ? { order } : {}),
    }),
  });

const submitFormCreate = (
  ctx: SharedTestContext,
  fixture: CreateFixture,
  fields: Record<string, unknown>,
  typecast = true
): Promise<Response> =>
  fetch(`${ctx.baseUrl}/tables/submitRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId: fixture.tableId, formId: fixture.formId, fields, typecast }),
  });

const submitDeleteField = (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string
): Promise<Response> =>
  fetch(`${ctx.baseUrl}/tables/deleteField`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseId: ctx.baseId, tableId, fieldId }),
  });

const readStatusChoices = async (ctx: SharedTestContext, fixture: CreateFixture) => {
  const table = await ctx.getTableById(fixture.tableId);
  const status = table.fields.find((field) => field.id === fixture.statusFieldId);
  const options = status?.options;
  if (!options || typeof options !== 'object' || !('choices' in options)) return [];
  const { choices } = options;
  if (!Array.isArray(choices)) return [];
  return choices.map((choice: unknown) =>
    choice && typeof choice === 'object' && 'name' in choice ? String(choice.name) : ''
  );
};

const parseCreatedIds = async (
  response: Response,
  operation: CreateOperation
): Promise<string[]> => {
  expect(response.status).toBe(201);
  const body = await response.json();
  if (operation === 'createRecord') {
    return [createRecordOkResponseSchema.parse(body).data.record.id];
  }
  if (operation === 'createRecords') {
    return createRecordsOkResponseSchema.parse(body).data.records.map((record) => record.id);
  }
  return [submitRecordOkResponseSchema.parse(body).data.record.id];
};

const expectFieldDeletion = async (response: Response): Promise<void> => {
  expect(response.ok).toBe(true);
  expect(deleteFieldOkResponseSchema.parse(await response.json()).ok).toBe(true);
};

const expectValidation = async (response: Response): Promise<void> => {
  expect([400, 404]).toContain(response.status);
  const body = apiErrorResponseDtoSchema.parse(await response.json());
  expect(body.error.code).toMatch(/field/);
};

/**
 * Builds the view row-order column and index before a race starts. Preparation
 * runs outside the schema lease and `CREATE INDEX CONCURRENTLY` waits for open
 * transactions, so a first-use ordered create must not race the deletion gate.
 */
const warmOrderColumn = async (
  ctx: SharedTestContext,
  fixture: CreateFixture,
  anchorId: string
): Promise<void> => {
  const response = await submitCreate(
    ctx,
    fixture.tableId,
    { Name: 'order-warmup', Status: 'Alpha' },
    false,
    { viewId: fixture.gridViewId, anchorId, position: 'before' }
  );
  expect(await parseCreatedIds(response, 'createRecord')).toHaveLength(1);
};
const installSharedReadBarrier = (ctx: SharedTestContext, tableId: string, gateOnRead: number) => {
  const tableQueryService = ctx.testContainer.container.resolve<TableQueryService>(
    v2CoreTokens.tableQueryService
  );
  const sharedReadsReady = createGate();
  const readsByRequest = new Map<string, number>();
  let gatedRequests = 0;
  const originalGetById = tableQueryService.getById.bind(tableQueryService);
  const tableQuerySpy = vi
    .spyOn(tableQueryService, 'getById')
    .mockImplementation(async (context, id) => {
      const result = await originalGetById(context, id);
      if (id.toString() !== tableId) return result;

      const requestKey = context.requestId ?? 'unidentified-request';
      const reads = (readsByRequest.get(requestKey) ?? 0) + 1;
      readsByRequest.set(requestKey, reads);
      if (reads !== gateOnRead) return result;

      gatedRequests += 1;
      if (gatedRequests === 2) sharedReadsReady.open();
      await sharedReadsReady.wait;
      return result;
    });
  return {
    sharedReadsComplete: sharedReadsReady.wait,
    remove: () => {
      sharedReadsReady.open();
      tableQuerySpy.mockRestore();
    },
  };
};
describe('[T8080] typecast record creates coordinate table schema writes (e2e, postgres)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 60_000);

  it.each([
    { operation: 'createRecord' as const, suffix: 'ordered single' },
    { operation: 'createRecords' as const, suffix: 'ordered many' },
  ])(
    'ordered $operation waits for unrelated field deletion, then succeeds with fresh metadata ($suffix)',
    async ({ operation, suffix }) => {
      const fixture = await createFixture(ctx, suffix);
      const anchorResponse = await submitCreate(
        ctx,
        fixture.tableId,
        { Name: 'anchor', Status: 'Alpha' },
        false
      );
      const anchorIds = await parseCreatedIds(anchorResponse, 'createRecord');
      const anchorId = anchorIds[0];
      expect(anchorId).toBeTruthy();
      await warmOrderColumn(ctx, fixture, anchorId!);
      const deleteEntered = createGate();
      const deleteGate = createGate();
      const removeFieldPlugin = addFieldPlugin(
        ctx,
        createDeleteGatePlugin({
          name: `e2e-ordered-delete-${Date.now()}`,
          tableId: fixture.tableId,
          fieldId: fixture.deleteTargetFieldId,
          entered: deleteEntered,
          gate: deleteGate,
        })
      );
      let deletePromise: Promise<Response> | undefined;
      let createPromise: Promise<Response> | undefined;
      let invalidPromise: Promise<Response> | undefined;
      try {
        deletePromise = submitDeleteField(ctx, fixture.tableId, fixture.deleteTargetFieldId);
        await deleteEntered.wait;
        const order = {
          viewId: fixture.gridViewId,
          anchorId: anchorId!,
          position: 'before' as const,
        };
        if (operation === 'createRecord') {
          createPromise = submitCreate(
            ctx,
            fixture.tableId,
            { Name: 'ordered', Status: 'Gamma' },
            true,
            order
          );
        } else {
          createPromise = submitCreates(
            ctx,
            fixture.tableId,
            [
              { fields: { Name: 'ordered-1', Status: 'Gamma' } },
              { fields: { Name: 'ordered-2', Status: 'Gamma' } },
            ],
            true,
            order
          );
        }
        invalidPromise = submitCreate(
          ctx,
          fixture.tableId,
          { Name: 'invalid-waiter', 'Delete target': 'gone' },
          true,
          order
        );
        await vi.waitFor(
          async () => {
            expect(await countSchemaCoordinationWaiters(ctx)).toBeGreaterThan(0);
          },
          { timeout: 10_000, interval: 25 }
        );
        let createSettled = false;
        void createPromise.then(() => {
          createSettled = true;
        });
        await delay(300);
        expect(createSettled).toBe(false);
        deleteGate.open();
        await expectFieldDeletion(await deletePromise);
        const createdIds = await parseCreatedIds(await createPromise, operation);
        expect(createdIds).toHaveLength(operation === 'createRecord' ? 1 : 2);
        await expectValidation(await invalidPromise);
        const tableAfter = await ctx.getTableById(fixture.tableId);
        expect(tableAfter.fields.map((field) => field.id)).not.toContain(
          fixture.deleteTargetFieldId
        );
        expect(tableAfter.fields.map((field) => field.id)).toEqual(
          expect.arrayContaining([
            fixture.nameFieldId,
            fixture.statusFieldId,
            fixture.markerFieldId,
          ])
        );
        const records = await ctx.listRecords(fixture.tableId);
        expect(records.map((record) => record.id)).toEqual(
          expect.arrayContaining([anchorId!, ...createdIds])
        );
        expect(
          records.find((record) => record.fields[fixture.nameFieldId] === 'invalid-waiter')
        ).toBeUndefined();
        for (const id of createdIds) {
          expect(records.find((record) => record.id === id)?.fields[fixture.statusFieldId]).toBe(
            'Gamma'
          );
          expect(records.find((record) => record.id === id)?.fields).not.toHaveProperty(
            fixture.deleteTargetFieldId
          );
        }
      } finally {
        deleteGate.open();
        removeFieldPlugin();
        if (deletePromise) await deletePromise;
        if (createPromise) await createPromise;
        if (invalidPromise) await invalidPromise;
      }
    }
  );

  it.each([{ ordered: false }, { ordered: true }])(
    'reloads metadata under exclusive after both concurrent writers first read shared metadata (ordered=$ordered)',
    async ({ ordered }) => {
      const fixture = await createFixture(ctx, `both-shared-reads-${ordered}`);
      let order: OrderInput | undefined;
      if (ordered) {
        const [anchorId] = await parseCreatedIds(
          await submitCreate(ctx, fixture.tableId, { Name: 'anchor', Status: 'Alpha' }, false),
          'createRecord'
        );
        await warmOrderColumn(ctx, fixture, anchorId!);
        order = { viewId: fixture.gridViewId, anchorId: anchorId!, position: 'before' };
      }
      // Ordered creates read once for order preparation and once under shared.
      const barrier = installSharedReadBarrier(ctx, fixture.tableId, ordered ? 2 : 1);
      const firstPromise = submitCreate(
        ctx,
        fixture.tableId,
        { Name: 'first', Status: 'Gamma' },
        true,
        order,
        `first-${ordered}`
      );
      const secondPromise = submitCreate(
        ctx,
        fixture.tableId,
        { Name: 'second', Status: 'Delta' },
        true,
        order,
        `second-${ordered}`
      );
      try {
        await barrier.sharedReadsComplete;
        const firstResponse = await firstPromise;
        const secondResponse = await secondPromise;
        expect(await parseCreatedIds(firstResponse, 'createRecord')).toHaveLength(1);
        expect(await parseCreatedIds(secondResponse, 'createRecord')).toHaveLength(1);
        const choices = await readStatusChoices(ctx, fixture);
        expect(choices).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'Gamma', 'Delta']));
        expect(new Set(choices).size).toBe(choices.length);
      } finally {
        barrier.remove();
        await Promise.all([firstPromise, secondPromise]);
      }
    }
  );

  it.each([
    { operation: 'createRecord' as const, typecast: false, ordered: false },
    { operation: 'createRecord' as const, typecast: true, ordered: false },
    { operation: 'createRecords' as const, typecast: false, ordered: false },
    { operation: 'createRecords' as const, typecast: true, ordered: false },
    { operation: 'createRecord' as const, typecast: false, ordered: true },
    { operation: 'createRecord' as const, typecast: true, ordered: true },
    { operation: 'createRecords' as const, typecast: false, ordered: true },
    { operation: 'createRecords' as const, typecast: true, ordered: true },
  ])(
    'keeps $operation with existing option shared (typecast=$typecast ordered=$ordered)',
    async ({ operation, typecast, ordered }) => {
      const fixture = await createFixture(ctx, `shared-${operation}-${typecast}-${ordered}`);
      let anchorId: string | undefined;
      if (ordered) {
        const anchorIds = await parseCreatedIds(
          await submitCreate(ctx, fixture.tableId, { Name: 'anchor', Status: 'Alpha' }, false),
          'createRecord'
        );
        anchorId = anchorIds[0];
        expect(anchorId).toBeTruthy();
        await warmOrderColumn(ctx, fixture, anchorId!);
      }
      const ordinaryEntered = createGate();
      const ordinaryGate = createGate();
      const removePlugin = addRecordPlugin(
        ctx,
        createMarkerGatePlugin({
          name: `e2e-shared-${Date.now()}`,
          tableId: fixture.tableId,
          markerFieldId: fixture.markerFieldId,
          marker: 'ordinary',
          entered: ordinaryEntered,
          gate: ordinaryGate,
        })
      );
      const deleteEntered = createGate();
      const deleteGate = createGate();
      const removeDeletePlugin = addFieldPlugin(
        ctx,
        createDeleteGatePlugin({
          name: `e2e-shared-delete-${Date.now()}`,
          tableId: fixture.tableId,
          fieldId: fixture.deleteTargetFieldId,
          entered: deleteEntered,
          gate: deleteGate,
        })
      );
      let ordinaryPromise: Promise<Response> | undefined;
      let deletePromise: Promise<Response> | undefined;
      try {
        const order = ordered
          ? { viewId: fixture.gridViewId, anchorId: anchorId!, position: 'before' as const }
          : undefined;
        if (operation === 'createRecord') {
          ordinaryPromise = submitCreate(
            ctx,
            fixture.tableId,
            { Name: 'ordinary', Status: 'Alpha', Marker: 'ordinary' },
            typecast,
            order
          );
        } else {
          ordinaryPromise = submitCreates(
            ctx,
            fixture.tableId,
            [
              { fields: { Name: 'ordinary-1', Status: 'Alpha', Marker: 'ordinary' } },
              { fields: { Name: 'ordinary-2', Status: 'Alpha' } },
            ],
            typecast,
            order
          );
        }
        await ordinaryEntered.wait;
        deletePromise = submitDeleteField(ctx, fixture.tableId, fixture.deleteTargetFieldId);
        await vi.waitFor(
          async () => {
            expect(await countSchemaCoordinationWaiters(ctx)).toBeGreaterThan(0);
          },
          { timeout: 10_000, interval: 25 }
        );
        ordinaryGate.open();
        expect(await parseCreatedIds(await ordinaryPromise, operation)).toHaveLength(
          operation === 'createRecord' ? 1 : 2
        );
        await deleteEntered.wait;
        deleteGate.open();
        await expectFieldDeletion(await deletePromise);
        expect(await readStatusChoices(ctx, fixture)).toEqual(['Alpha', 'Beta']);
      } finally {
        ordinaryGate.open();
        deleteGate.open();
        removePlugin();
        removeDeletePlugin();
        await Promise.all([
          ordinaryPromise?.catch(() => undefined),
          deletePromise?.catch(() => undefined),
        ]);
      }
    }
  );

  it('covers submitRecord with configured form visibility and required input', async () => {
    const fixture = await createFixture(ctx, 'submit-form');
    const response = await submitFormCreate(
      ctx,
      fixture,
      {
        [fixture.nameFieldId]: 'submitted',
        [fixture.statusFieldId]: 'Gamma',
      },
      true
    );
    const [recordId] = await parseCreatedIds(response, 'submitRecord');
    expect(
      (await ctx.listRecords(fixture.tableId)).find((record) => record.id === recordId)?.fields[
        fixture.statusFieldId
      ]
    ).toBe('Gamma');
    expect(await readStatusChoices(ctx, fixture)).toEqual(expect.arrayContaining(['Gamma']));
  });

  it('rejects a post-delete write using the deleted field and does not create a record', async () => {
    const fixture = await createFixture(ctx, 'post-delete-validation');
    await expectFieldDeletion(await submitDeleteField(ctx, fixture.tableId, fixture.markerFieldId));
    const before = await ctx.listRecords(fixture.tableId);
    await expectValidation(
      await submitCreate(ctx, fixture.tableId, { Name: 'invalid', Marker: 'gone' }, true)
    );
    expect(await ctx.listRecords(fixture.tableId)).toHaveLength(before.length);
  });
});
