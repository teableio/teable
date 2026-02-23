import { getActionTriggerChannel } from '@teable/core';
import {
  BaseId,
  FieldId,
  FieldUpdated,
  TableId,
  type IExecutionContext,
  type IEventHandler,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';
import type { ShareDbService } from '../../share-db/share-db.service';
import { V2ActionTriggerService } from './v2-action-trigger.service';

type PresencePayload = Array<{ actionKey: string; payload?: Record<string, unknown> }>;

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
    });

    const result = await projection?.handle({} as IExecutionContext, event);
    expect(result?.isOk()).toBe(true);

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
    expect(submitted).toBeUndefined();
  });
});
