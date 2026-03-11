import { getActionTriggerChannel } from '@teable/core';
import {
  BaseId,
  FieldCreated,
  FieldId,
  FieldUpdated,
  TableActionTriggerRequested,
  TableId,
  type IExecutionContext,
  type IEventHandler,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';
import type { ShareDbService } from '../../share-db/share-db.service';
import { V2ActionTriggerService } from './v2-action-trigger.service';

type PresencePayload = Array<{ actionKey: string; payload?: Record<string, unknown> }>;

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
    let submitted: PresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: PresencePayload, cb?: (error?: unknown) => void) => {
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
    let submitted: PresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: PresencePayload, cb?: (error?: unknown) => void) => {
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
      },
    ]);
  });

  it('emits setField presence payload for formatting-only field updates', async () => {
    let submitted: PresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: PresencePayload, cb?: (error?: unknown) => void) => {
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
            date: 'YYYY-MM-DD',
            time: 'None',
            timeZone: 'UTC',
          },
          newValue: {
            date: 'YYYY-MM-DD',
            time: 'hh:mm A',
            timeZone: 'UTC',
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
                date: 'YYYY-MM-DD',
                time: 'hh:mm A',
                timeZone: 'UTC',
              },
            },
          },
        },
      },
    ]);
  });

  it('does not emit setField action for unrelated field property updates', async () => {
    let submitted: PresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: PresencePayload, cb?: (error?: unknown) => void) => {
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
    let submitted: PresencePayload | undefined;

    const shareDbService = {
      connect: () => ({
        getPresence: (channel: string) => {
          channelSubmitted = channel;
          return {
            create: () => ({
              submit: (data: PresencePayload, cb?: (error?: unknown) => void) => {
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
      actionKey: 'setRecord',
      payload: {
        tableId: tableId.toString(),
        fieldIds: ['fldSource0000000001', 'fldComputed00000002'],
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
          fieldIds: ['fldSource0000000001', 'fldComputed00000002'],
        },
      },
    ]);
  });

  it('batches setField and setRecord into one presence submit for schema-driven updates', async () => {
    const submissions: PresencePayload[] = [];

    const shareDbService = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            submit: (data: PresencePayload, cb?: (error?: unknown) => void) => {
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
    const setRecordEvent = TableActionTriggerRequested.create({
      baseId,
      tableId,
      actionKey: 'setRecord',
      payload: {
        tableId: tableId.toString(),
        fieldIds: [fieldId.toString()],
      },
    });

    const fieldResult = await fieldUpdatedProjection?.handle(
      {} as IExecutionContext,
      fieldUpdatedEvent
    );
    const actionResult = await actionTriggerProjection?.handle(
      {} as IExecutionContext,
      setRecordEvent
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
          actionKey: 'setRecord',
          payload: {
            tableId: tableId.toString(),
            fieldIds: [fieldId.toString()],
          },
        },
      ],
    ]);
  });
});
