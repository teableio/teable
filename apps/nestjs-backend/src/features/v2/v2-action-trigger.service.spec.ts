import { getActionTriggerChannel } from '@teable/core';
import {
  BaseId,
  FieldCreated,
  FieldId,
  FieldUpdated,
  RecordId,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  TableActionTriggerRequested,
  TableId,
  type IExecutionContext,
  type IEventHandler,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';
import type { ShareDbService } from '../../share-db/share-db.service';
import { V2ActionTriggerService } from './v2-action-trigger.service';

type IPresencePayload = Array<{ actionKey: string; payload?: Record<string, unknown> }>;

const defaultTimeZone = 'UTC';
const defaultDateFormat = 'YYYY-MM-DD';
const sourceFieldId = 'fldSource0000000001';
const streamedDeleteOperationId = 'req-delete-stream-test';

const waitForPresenceFlush = async () => {
  await new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(() => resolve());
      return;
    }
    setTimeout(() => resolve(), 0);
  });
};

const fieldUpdateSemantics = {
  type: {
    realtimePath: ['type'],
    presencePath: ['type'],
    mayRequirePresence: true,
  },
  options: {
    realtimePath: ['options'],
    presencePath: ['options'],
    mayRequirePresence: true,
  },
  formatting: {
    realtimePath: ['options'],
    presencePath: ['options', 'formatting'],
    mayRequirePresence: true,
  },
} as const;

const createIds = () => {
  return {
    baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
    tableId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
    fieldId: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
  };
};

describe('V2ActionTriggerService', () => {
  it('emits setField presence payload with changed new values', async () => {
    let channelSubmitted: string | undefined;
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
                submitted = data;
                cb?.();
              },
            }),
          };
        },
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2FieldUpdatedActionTriggerProjection'
    )?.instance as IEventHandler<FieldUpdated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const event = FieldUpdated.create({
      baseId,
      tableId,
      fieldId,
      updatedProperties: ['type', 'options'],
      changes: {
        type: { oldValue: 'singleLineText', newValue: 'singleSelect' },
        options: {
          oldValue: { showAs: { type: 'url' } },
          newValue: { choices: [{ id: 'opt1', name: 'Open' }] },
        },
      },
      propertySemantics: {
        type: fieldUpdateSemantics.type,
        options: fieldUpdateSemantics.options,
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(channelSubmitted).toBe(getActionTriggerChannel(tableId.toString()));
    expect(submitted).toEqual([
      {
        actionKey: 'setField',
        payload: {
          tableId: tableId.toString(),
          field: {
            id: fieldId.toString(),
            updatedProperties: ['type', 'options'],
            type: 'singleSelect',
            options: {
              choices: [{ id: 'opt1', name: 'Open' }],
            },
          },
        },
      },
    ]);
  });

  it('emits addField and setRecord presence payloads for field created', async () => {
    let channelSubmitted: string | undefined;
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
                submitted = data;
                cb?.();
              },
            }),
          };
        },
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2FieldCreatedActionTriggerProjection'
    )?.instance as IEventHandler<FieldCreated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const event = FieldCreated.create({
      baseId,
      tableId,
      fieldId,
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(channelSubmitted).toBe(getActionTriggerChannel(tableId.toString()));
    expect(submitted).toEqual([
      {
        actionKey: 'addField',
        payload: {
          tableId: tableId.toString(),
          field: {
            id: fieldId.toString(),
          },
        },
      },
      {
        actionKey: 'setRecord',
        payload: {
          tableId: tableId.toString(),
          fieldIds: [fieldId.toString()],
        },
      },
    ]);
  });

  it('emits setField presence payload for formatting-only field updates', async () => {
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
              submitted = data;
              cb?.();
            },
          }),
        }),
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2FieldUpdatedActionTriggerProjection'
    )?.instance as IEventHandler<FieldUpdated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const event = FieldUpdated.create({
      baseId,
      tableId,
      fieldId,
      updatedProperties: ['formatting'],
      changes: {
        formatting: {
          oldValue: {
            date: defaultDateFormat,
            time: 'None',
            timeZone: defaultTimeZone,
          },
          newValue: {
            date: defaultDateFormat,
            time: 'hh:mm A',
            timeZone: defaultTimeZone,
          },
        },
      },
      propertySemantics: {
        formatting: fieldUpdateSemantics.formatting,
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();
    expect(submitted).toEqual([
      {
        actionKey: 'setField',
        payload: {
          tableId: tableId.toString(),
          field: {
            id: fieldId.toString(),
            updatedProperties: ['formatting'],
            options: {
              formatting: {
                date: defaultDateFormat,
                time: 'hh:mm A',
                timeZone: defaultTimeZone,
              },
            },
          },
        },
      },
    ]);
  });

  it('emits deleteRecord payload with record ids when large delete skips realtime fan-out', async () => {
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
              submitted = data;
              cb?.();
            },
          }),
        }),
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2RecordsDeletedActionTriggerProjection'
    )?.instance as IEventHandler<RecordsDeleted> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId } = createIds();
    const recordIds = Array.from({ length: 1001 }, (_, index) =>
      RecordId.create(`rec${index.toString().padStart(16, '0')}`)._unsafeUnwrap()
    );
    const event = RecordsDeleted.create({
      baseId,
      tableId,
      recordIds,
      recordSnapshots: recordIds.map((recordId) => ({
        id: recordId.toString(),
        fields: {},
      })),
      orchestration: {
        operationId: streamedDeleteOperationId,
        groupId: streamedDeleteOperationId,
        totalRecordCount: recordIds.length,
        totalChunkCount: 3,
        chunkIndex: 1,
        scope: 'chunk',
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(submitted).toEqual([
      {
        actionKey: 'deleteRecord',
        payload: {
          tableId: tableId.toString(),
          recordIds: recordIds.map((recordId) => recordId.toString()),
          skipRealtime: true,
          operationId: streamedDeleteOperationId,
          groupId: streamedDeleteOperationId,
          totalRecordCount: recordIds.length,
          totalChunkCount: 3,
          chunkIndex: 1,
          scope: 'chunk',
        },
      },
    ]);
  });

  it('emits addRecord payload with record ids when streamed create reaches the total threshold', async () => {
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
              submitted = data;
              cb?.();
            },
          }),
        }),
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2RecordsBatchCreatedActionTriggerProjection'
    )?.instance as IEventHandler<RecordsBatchCreated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId } = createIds();
    const event = RecordsBatchCreated.create({
      baseId,
      tableId,
      records: Array.from({ length: 200 }, (_, index) => ({
        recordId: `rec${index.toString().padStart(16, '0')}`,
        fields: [],
      })),
      orchestration: {
        operationId: 'streamed-create-operation',
        groupId: 'streamed-create-group',
        totalRecordCount: 1000,
        totalChunkCount: 5,
        chunkIndex: 0,
        scope: 'chunk',
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(submitted).toEqual([
      {
        actionKey: 'addRecord',
        payload: {
          tableId: tableId.toString(),
          recordIds: event.records.map((record) => record.recordId),
          skipRealtime: true,
          operationId: 'streamed-create-operation',
          groupId: 'streamed-create-group',
          totalRecordCount: 1000,
          totalChunkCount: 5,
          chunkIndex: 0,
          scope: 'chunk',
        },
      },
    ]);
  });

  it('does not emit setField action for unrelated field property updates', async () => {
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
              submitted = data;
              cb?.();
            },
          }),
        }),
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2FieldUpdatedActionTriggerProjection'
    )?.instance as IEventHandler<FieldUpdated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const event = FieldUpdated.create({
      baseId,
      tableId,
      fieldId,
      updatedProperties: ['description'],
      changes: {
        description: { oldValue: 'old', newValue: 'new' },
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();
    expect(submitted).toBeUndefined();
  });

  it('emits requested action trigger payload for schema-driven presence events', async () => {
    let channelSubmitted: string | undefined;
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
                submitted = data;
                cb?.();
              },
            }),
          };
        },
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2TableActionTriggerRequestedProjection'
    )?.instance as IEventHandler<TableActionTriggerRequested> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId } = createIds();
    const event = TableActionTriggerRequested.create({
      baseId,
      tableId,
      actionKey: 'setField',
      payload: {
        tableId: tableId.toString(),
        field: {
          id: sourceFieldId,
        },
        fieldIds: [sourceFieldId, 'fldComputed00000002'],
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(channelSubmitted).toBe(getActionTriggerChannel(tableId.toString()));
    expect(submitted).toEqual([
      {
        actionKey: 'setField',
        payload: {
          tableId: tableId.toString(),
          field: {
            id: sourceFieldId,
          },
          fieldIds: [sourceFieldId, 'fldComputed00000002'],
        },
      },
    ]);
  });

  it('emits setRecord presence payload with fieldIds for large batch updates', async () => {
    let channelSubmitted: string | undefined;
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
                submitted = data;
                cb?.();
              },
            }),
          };
        },
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2RecordsBatchUpdatedActionTriggerProjection'
    )?.instance as IEventHandler<RecordsBatchUpdated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const event = RecordsBatchUpdated.create({
      baseId,
      tableId,
      source: 'user',
      updates: Array.from({ length: 1001 }, (_, index) => ({
        recordId: `rec${index.toString().padStart(16, '0')}`,
        oldVersion: 1,
        newVersion: 2,
        changes: [
          {
            fieldId: fieldId.toString(),
            oldValue: `old-${index}`,
            newValue: `new-${index}`,
          },
        ],
      })),
      orchestration: {
        operationId: 'large-update-operation',
        groupId: 'large-update-group',
        totalRecordCount: 1001,
        totalChunkCount: 3,
        chunkIndex: 1,
        scope: 'chunk',
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(channelSubmitted).toBe(getActionTriggerChannel(tableId.toString()));
    expect(submitted).toEqual([
      {
        actionKey: 'setRecord',
        payload: {
          tableId: tableId.toString(),
          fieldIds: [fieldId.toString()],
          recordIds: event.updates.map((update) => update.recordId),
          skipRealtime: true,
          operationId: 'large-update-operation',
          groupId: 'large-update-group',
          totalRecordCount: 1001,
          totalChunkCount: 3,
          chunkIndex: 1,
          scope: 'chunk',
        },
      },
    ]);
  });

  it('emits setRecord presence payload with fieldIds when streamed updates reach the total threshold', async () => {
    let submitted: IPresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
              submitted = data;
              cb?.();
            },
          }),
        }),
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const projection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2RecordsBatchUpdatedActionTriggerProjection'
    )?.instance as IEventHandler<RecordsBatchUpdated> | undefined;

    expect(projection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const event = RecordsBatchUpdated.create({
      baseId,
      tableId,
      source: 'user',
      updates: Array.from({ length: 200 }, (_, index) => ({
        recordId: `rec${index.toString().padStart(16, '0')}`,
        oldVersion: 1,
        newVersion: 2,
        changes: [
          {
            fieldId: fieldId.toString(),
            oldValue: `old-${index}`,
            newValue: `new-${index}`,
          },
        ],
      })),
      orchestration: {
        operationId: 'streamed-update-operation',
        groupId: 'streamed-update-group',
        totalRecordCount: 1000,
        totalChunkCount: 5,
        chunkIndex: 0,
        scope: 'chunk',
      },
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);
    await waitForPresenceFlush();

    expect(submitted).toEqual([
      {
        actionKey: 'setRecord',
        payload: {
          tableId: tableId.toString(),
          fieldIds: [fieldId.toString()],
          recordIds: event.updates.map((update) => update.recordId),
          skipRealtime: true,
          operationId: 'streamed-update-operation',
          groupId: 'streamed-update-group',
          totalRecordCount: 1000,
          totalChunkCount: 5,
          chunkIndex: 0,
          scope: 'chunk',
        },
      },
    ]);
  });

  it('batches field patch and schema-refresh setField actions into one presence submit for schema-driven updates', async () => {
    const submissions: IPresencePayload[] = [];

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: IPresencePayload, cb?: (error?: unknown) => void) => {
              submissions.push(data);
              cb?.();
            },
          }),
        }),
      }),
    } as unknown as ShareDbService;

    const registered: Array<{ instance: unknown }> = [];
    const container = {
      registerInstance: (_token: unknown, instance: unknown) => {
        registered.push({ instance });
        return container;
      },
    } as unknown as DependencyContainer;

    const service = new V2ActionTriggerService(shareDbService);
    service.registerProjections(container);

    const fieldUpdatedProjection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2FieldUpdatedActionTriggerProjection'
    )?.instance as IEventHandler<FieldUpdated> | undefined;
    const actionTriggerProjection = registered.find(
      (item) =>
        (item.instance as { constructor?: { name?: string } }).constructor?.name ===
        'V2TableActionTriggerRequestedProjection'
    )?.instance as IEventHandler<TableActionTriggerRequested> | undefined;

    expect(fieldUpdatedProjection).toBeDefined();
    expect(actionTriggerProjection).toBeDefined();

    const { baseId, tableId, fieldId } = createIds();
    const fieldUpdatedEvent = FieldUpdated.create({
      baseId,
      tableId,
      fieldId,
      updatedProperties: ['type', 'options'],
      changes: {
        type: { oldValue: 'singleLineText', newValue: 'number' },
        options: {
          oldValue: { showAs: { type: 'number' } },
          newValue: { formatting: { decimal: 0 } },
        },
      },
      propertySemantics: {
        type: fieldUpdateSemantics.type,
        options: fieldUpdateSemantics.options,
      },
    });
    const schemaRefreshEvent = TableActionTriggerRequested.create({
      baseId,
      tableId,
      actionKey: 'setField',
      payload: {
        tableId: tableId.toString(),
        field: {
          id: fieldId.toString(),
        },
        fieldIds: [fieldId.toString()],
      },
    });

    const fieldResult = await fieldUpdatedProjection?.handle(
      {} as IExecutionContext,
      fieldUpdatedEvent
    );
    const actionResult = await actionTriggerProjection?.handle(
      {} as IExecutionContext,
      schemaRefreshEvent
    );
    expect(fieldResult?.isOk()).toBe(true);
    expect(actionResult?.isOk()).toBe(true);

    await waitForPresenceFlush();

    expect(submissions).toEqual([
      [
        {
          actionKey: 'setField',
          payload: {
            tableId: tableId.toString(),
            field: {
              id: fieldId.toString(),
              updatedProperties: ['type', 'options'],
              type: 'number',
              options: {
                formatting: { decimal: 0 },
              },
            },
          },
        },
        {
          actionKey: 'setField',
          payload: {
            tableId: tableId.toString(),
            field: {
              id: fieldId.toString(),
            },
            fieldIds: [fieldId.toString()],
          },
        },
      ],
    ]);
  });
});
