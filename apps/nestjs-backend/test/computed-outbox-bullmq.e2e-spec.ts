/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '@teable/v2-adapter-table-repository-postgres';
import { vi } from 'vitest';

import { ComputedOutboxWakeupHandler } from '../src/features/v2/computed-outbox-trigger/computed-outbox-wakeup.handler';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

const describeBullMq =
  process.env.V2_COMPUTED_OUTBOX_BULLMQ_E2E === 'true' ? describe : describe.skip;

const waitFor = async (assertion: () => Promise<void>, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for computed update');
};

describeBullMq('BullMQ computed outbox (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  }, 120_000);

  it(
    'runs a committed cross-table update through BullMQ wake-up delivery',
    { timeout: 180_000 },
    async () => {
      const source = await createTable(baseId, {
        name: `bullmq_outbox_source_${Date.now()}`,
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'Before' } }],
      });
      const target = await createTable(baseId, {
        name: `bullmq_outbox_target_${Date.now()}`,
        records: [{ fields: {} }],
      });

      try {
        const titleFieldId = source.fields.find((field) => field.name === 'Title')!.id;
        const linkField = await createField(target.id, {
          name: 'Source',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: source.id,
          },
        } as IFieldRo);
        const lookupField = await createField(target.id, {
          name: 'Source title lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: source.id,
            linkFieldId: linkField.id,
            lookupFieldId: titleFieldId,
          },
        } as IFieldRo);
        await updateRecordByApi(target.id, target.records[0].id, linkField.id, [
          { id: source.records[0].id },
        ]);
        await waitFor(async () => {
          const record = await getRecord(target.id, target.records[0].id);
          expect(record.fields[lookupField.id]).toEqual(['Before']);
        });

        const container = await app.get(V2ContainerService).getContainerForBase(baseId);
        const worker = container.resolve<ComputedUpdateWorker>(
          v2RecordRepositoryPostgresTokens.computedUpdateWorker
        );
        const handler = app.get(ComputedOutboxWakeupHandler);
        const queueDelivery = vi.spyOn(handler, 'handle');
        const queueTrigger = vi.spyOn(worker, 'runTaskById');
        // runOnce may fire from post-process drain after a successful BullMQ task, and/or
        // from hybrid push scheduleDispatch. That is not a background poller loop.

        await updateRecordByApi(source.id, source.records[0].id, titleFieldId, 'After');

        await waitFor(async () => {
          const record = await getRecord(target.id, target.records[0].id);
          expect(record.fields[lookupField.id]).toEqual(['After']);
        });
        // Cross-table readiness is delivered via BullMQ wake-up (not only local polling).
        expect(queueDelivery).toHaveBeenCalledWith(
          expect.objectContaining({ baseId, taskId: expect.any(String) })
        );
        expect(queueTrigger).toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, target.id);
        await permanentDeleteTable(baseId, source.id);
      }
    }
  );
});
