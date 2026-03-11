/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, getActionTriggerChannel } from '@teable/core';
import { axios, X_CANARY_HEADER } from '@teable/openapi';
import type { Connection } from 'sharedb/lib/client';
import { ShareDbService } from '../src/share-db/share-db.service';
import {
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

type ActionTrigger = {
  actionKey: string;
  payload?: Record<string, unknown>;
};

let fieldIdCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const createConnection = (
  shareDbService: ShareDbService,
  cookie: string,
  port: string
): Connection => {
  return shareDbService.connect(undefined, {
    url: `ws://localhost:${port}/socket`,
    headers: { cookie },
  });
};

const collectActionTriggers = async (params: {
  shareDbService: ShareDbService;
  cookie: string;
  port: string;
  tableId: string;
  act: () => Promise<unknown>;
  idleMs?: number;
  timeoutMs?: number;
  until?: (actions: ReadonlyArray<ActionTrigger>) => boolean;
}): Promise<ActionTrigger[]> => {
  const {
    shareDbService,
    cookie,
    port,
    tableId,
    act,
    idleMs = 300,
    timeoutMs = 5000,
    until,
  } = params;

  return new Promise<ActionTrigger[]>((resolve, reject) => {
    const connection = createConnection(shareDbService, cookie, port);
    const presence = connection.getPresence(getActionTriggerChannel(tableId));
    const received: ActionTrigger[] = [];
    let capture = false;
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      if (idleTimer) clearTimeout(idleTimer);
      presence.removeListener('receive', onReceive);
      try {
        presence.unsubscribe();
        presence.destroy();
      } catch {}
      connection.close();
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(received);
    };

    const onReceive = (_id: string, batch: ActionTrigger[]) => {
      if (!capture) {
        return;
      }
      received.push(...batch);
      if (until?.(received)) {
        finish();
        return;
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), idleMs);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Action trigger timeout'));
    }, timeoutMs);

    presence.subscribe(async (error: unknown) => {
      if (error) {
        finish(error);
        return;
      }

      presence.on('receive', onReceive);

      try {
        capture = true;
        await act();
      } catch (actError) {
        finish(actError);
      }
    });
  });
};

describe('V2 action trigger field conversion (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  const tableIds = new Set<string>();
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    for (const tableId of [...tableIds].reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
    await app.close();
  });

  it('emits setField and setRecord presence for type conversion without record events', async () => {
    const table = await createTable(baseId, {
      name: 'v2-action-trigger-field-conversion',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount Text', type: FieldType.SingleLineText },
      ],
    });
    tableIds.add(table.id);

    const amountFieldId = table.fields.find((field) => field.name === 'Amount Text')?.id;
    if (!amountFieldId) {
      throw new Error('Amount Text field not found');
    }

    await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [amountFieldId]: '100' } }, { fields: { [amountFieldId]: '' } }],
    });

    const actions = await collectActionTriggers({
      shareDbService,
      cookie,
      port,
      tableId: table.id,
      until: (actions) =>
        actions.some((action) => action.actionKey === 'setField') &&
        actions.some((action) => action.actionKey === 'setRecord'),
      act: async () => {
        const response = await axios.put(
          `/table/${table.id}/field/${amountFieldId}/convert`,
          {
            name: 'Amount Text',
            type: FieldType.Number,
          },
          {
            headers: {
              [X_CANARY_HEADER]: 'true',
            },
          }
        );

        expect(response.status).toBe(200);
        expect(response.headers['x-teable-v2']).toBe('true');
      },
    });

    expect(actions.some((action) => action.actionKey === 'setField')).toBe(true);
    expect(actions.some((action) => action.actionKey === 'setRecord')).toBe(true);

    const setFieldAction = actions.find((action) => action.actionKey === 'setField');
    expect(setFieldAction?.payload).toMatchObject({
      tableId: table.id,
      field: {
        id: amountFieldId,
      },
    });

    const updatedProperties = (setFieldAction?.payload?.field as { updatedProperties?: string[] })
      ?.updatedProperties;
    expect(updatedProperties).toEqual(expect.arrayContaining(['type']));

    const setRecordAction = actions.find((action) => action.actionKey === 'setRecord');
    expect(setRecordAction?.payload).toMatchObject({
      tableId: table.id,
      fieldIds: [amountFieldId],
    });
  });

  it('emits setRecord for host tables when foreign schema updates recompute lookup values', async () => {
    const optionOpen = { id: 'choOpen', name: 'Open', color: 'blueBright' as const };
    const optionDone = { id: 'choDone', name: 'Done', color: 'greenBright' as const };

    const foreignTable = await createTable(baseId, {
      name: 'v2-action-trigger-foreign-schema-source',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          name: 'Status',
          type: 'singleSelect',
          options: { choices: [optionOpen, optionDone] },
        },
      ],
    });
    tableIds.add(foreignTable.id);

    const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.name === 'Name')?.id;
    const foreignStatusFieldId = foreignTable.fields.find((field) => field.name === 'Status')?.id;
    if (!foreignPrimaryFieldId || !foreignStatusFieldId) {
      throw new Error('Foreign fields not found');
    }

    const hostPrimaryFieldId = createFieldId();
    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    const hostTable = await createTable(baseId, {
      name: 'v2-action-trigger-foreign-schema-host',
      fields: [
        {
          id: hostPrimaryFieldId,
          name: 'Name',
          type: 'singleLineText',
          isPrimary: true,
        },
        {
          id: linkFieldId,
          name: 'Link',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      ],
    });
    tableIds.add(hostTable.id);

    await createField(hostTable.id, {
      id: lookupFieldId,
      name: 'Lookup Status',
      type: FieldType.SingleSelect,
      isLookup: true,
      lookupOptions: {
        linkFieldId,
        foreignTableId: foreignTable.id,
        lookupFieldId: foreignStatusFieldId,
      },
    });

    const foreignRecord = await createRecords(foreignTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [foreignPrimaryFieldId]: 'Source 1',
            [foreignStatusFieldId]: 'Open',
          },
        },
      ],
    });

    await createRecords(hostTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [hostPrimaryFieldId]: 'Host 1',
            [linkFieldId]: { id: foreignRecord.records[0].id },
          },
        },
      ],
    });

    const actions = await collectActionTriggers({
      shareDbService,
      cookie,
      port,
      tableId: hostTable.id,
      until: (actions) => actions.some((action) => action.actionKey === 'setRecord'),
      act: async () => {
        const response = await axios.put(
          `/table/${foreignTable.id}/field/${foreignStatusFieldId}/convert`,
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [{ ...optionOpen, name: 'Closed' }, optionDone],
            },
          },
          {
            headers: {
              [X_CANARY_HEADER]: 'true',
            },
          }
        );

        expect(response.status).toBe(200);
        expect(response.headers['x-teable-v2']).toBe('true');
      },
    });

    expect(actions.some((action) => action.actionKey === 'setRecord')).toBe(true);
    expect(actions.some((action) => action.actionKey === 'setField')).toBe(false);

    const setRecordAction = actions.find((action) => action.actionKey === 'setRecord');
    expect(setRecordAction?.payload).toMatchObject({
      tableId: hostTable.id,
      fieldIds: [lookupFieldId],
    });
  });
});
