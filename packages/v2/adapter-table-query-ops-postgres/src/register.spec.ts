import { v2CoreTokens } from '@teable/v2-core';
import { container } from '@teable/v2-di';
import { v2TableOpsTokens } from '@teable/v2-table-query-ops';
import { describe, expect, it } from 'vitest';

import {
  disposeTableQueryObservationPublisher,
  registerV2TableOpsPostgresAdapter,
} from './register';
import { v2TableOpsPostgresTokens } from './tokens';

const fakeDb = {} as never;

describe('registerV2TableOpsPostgresAdapter observation publisher lifecycle', () => {
  it('owns and disposes the fallback buffered publisher', async () => {
    const child = container.createChildContainer();
    child.registerInstance(v2CoreTokens.tableRepository, {} as never);
    const listenersBefore = process.listenerCount('beforeExit');
    await registerV2TableOpsPostgresAdapter(child, {
      metaDb: fakeDb,
      dataDb: fakeDb,
      observationDb: fakeDb,
      ensureSchema: false,
    });

    expect(child.isRegistered(v2TableOpsPostgresTokens.observationPublisherLifecycle)).toBe(true);
    expect(process.listenerCount('beforeExit')).toBe(listenersBefore + 1);

    await disposeTableQueryObservationPublisher(child);

    expect(process.listenerCount('beforeExit')).toBe(listenersBefore);
  });

  it('disposes the previous fallback before registering another one', async () => {
    const child = container.createChildContainer();
    child.registerInstance(v2CoreTokens.tableRepository, {} as never);
    const listenersBefore = process.listenerCount('beforeExit');

    await registerV2TableOpsPostgresAdapter(child, {
      metaDb: fakeDb,
      dataDb: fakeDb,
      observationDb: fakeDb,
      ensureSchema: false,
    });
    await registerV2TableOpsPostgresAdapter(child, {
      metaDb: fakeDb,
      dataDb: fakeDb,
      observationDb: fakeDb,
      ensureSchema: false,
    });

    expect(process.listenerCount('beforeExit')).toBe(listenersBefore + 1);
    await disposeTableQueryObservationPublisher(child);
    expect(process.listenerCount('beforeExit')).toBe(listenersBefore);
  });

  it('keeps the previous fallback alive when replacement config is invalid', async () => {
    const child = container.createChildContainer();
    child.registerInstance(v2CoreTokens.tableRepository, {} as never);
    const listenersBefore = process.listenerCount('beforeExit');
    await registerV2TableOpsPostgresAdapter(child, {
      metaDb: fakeDb,
      dataDb: fakeDb,
      observationDb: fakeDb,
      ensureSchema: false,
    });

    await expect(
      registerV2TableOpsPostgresAdapter(child, {
        metaDb: fakeDb,
        observationBuffer: { maxPendingKeys: 0 },
      })
    ).rejects.toThrow('Invalid v2 table ops postgres adapter config');

    expect(process.listenerCount('beforeExit')).toBe(listenersBefore + 1);
    await disposeTableQueryObservationPublisher(child);
    expect(process.listenerCount('beforeExit')).toBe(listenersBefore);
  });

  it('does not register a product-pool observation database when persistence is disabled', async () => {
    const child = container.createChildContainer();
    child.registerInstance(v2CoreTokens.tableRepository, {} as never);
    const observationPublisher = { publish: () => undefined };
    const observationReader = { findRecent: async () => undefined } as never;
    const observationSink = { record: async () => undefined } as never;

    await registerV2TableOpsPostgresAdapter(child, {
      metaDb: fakeDb,
      dataDb: fakeDb,
      observationDisabled: true,
      observationPublisher,
      observationReader,
      observationSink,
      ensureSchema: false,
    });

    expect(child.isRegistered(v2TableOpsPostgresTokens.observationDb)).toBe(false);
    expect(child.resolve(v2TableOpsTokens.observationPublisher)).toBe(observationPublisher);
    expect(child.resolve(v2TableOpsTokens.observationReader)).toBe(observationReader);
    expect(child.resolve(v2TableOpsTokens.observationSink)).toBe(observationSink);
  });
});
