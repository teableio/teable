import {
  ActorId,
  BaseId,
  domainError,
  err,
  FieldId,
  FieldKeyType,
  ok,
  RecordWriteOperationKind,
  registerRecordWritePlugin,
  TableId,
  v2CoreTokens,
  type IRecordWritePlugin,
  type RecordWritePluginContextMap,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it, vi } from 'vitest';
import { CrossBaseLinkAccessPluginRegistrar } from './cross-base-link-access.plugin-registrar';

const USER_ID = `usr${'u'.repeat(16)}`;
const TARGET_ID = `tbl${'t'.repeat(16)}`;
const BASE_ID = `bse${'b'.repeat(16)}`;
const createContext = (): RecordWritePluginContextMap['createMany'] => ({
  kind: RecordWriteOperationKind.createMany,
  executionContext: { actorId: ActorId.create(USER_ID)._unsafeUnwrap() },
  table: {
    id: () => TableId.create(TARGET_ID)._unsafeUnwrap(),
    baseId: () => BaseId.create(BASE_ID)._unsafeUnwrap(),
  } as never,
  payload: {
    recordsFieldValues: [new Map()],
    fieldKeyType: FieldKeyType.Id,
    typecast: true,
    recordCount: 1,
    linkTitleSource: {
      baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
      tableId: TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap(),
      fieldId: FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap(),
    },
  },
  isTransactionBound: true,
});

const createContainer = () => {
  const store = new Map<unknown, unknown>();
  store.set(v2CoreTokens.recordWriteSideEffectService, {
    wouldUpdateTableMetadata: () => ok(false),
  });
  return {
    isRegistered: (token: unknown) => store.has(token),
    resolve: (token: unknown) => store.get(token),
    registerInstance: (token: unknown, value: unknown) => store.set(token, value),
  } as unknown as DependencyContainer;
};

const createRegistrar = () => {
  const validPermissions = vi.fn().mockResolvedValue(['record|create']);
  const registrar = new CrossBaseLinkAccessPluginRegistrar(
    { assertForeignTablesReadable: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    { get: (key: string) => (key === 'user.id' ? USER_ID : undefined) } as never,
    { validPermissions } as never
  );
  return { registrar, validPermissions };
};

const getPlugins = (container: DependencyContainer) =>
  container.resolve<IRecordWritePlugin[]>(v2CoreTokens.recordWritePlugins);

describe('CrossBaseLinkAccessPluginRegistrar target create policy', () => {
  it('registers the Community target-create gate on every container', async () => {
    const { registrar, validPermissions } = createRegistrar();
    for (const container of [createContainer(), createContainer()]) {
      registrar.registerProjections(container);
      const gate = getPlugins(container).find(
        (plugin) => plugin.name === 'linkTitleRecordCreatePermission'
      );
      expect(gate).toBeDefined();
      expect((await gate!.prepare!(createContext())).isOk()).toBe(true);
    }
    expect(validPermissions).toHaveBeenCalledTimes(2);
    expect(validPermissions).toHaveBeenCalledWith(TARGET_ID, ['record|create']);
  });

  it.each([false, true])(
    'pairs the actual host policy regardless of registrar order (host first=%s)',
    async (hostFirst) => {
      const { registrar, validPermissions } = createRegistrar();
      const hostGuard = vi.fn(() =>
        err(domainError.forbidden({ message: 'Host denies target creation' }))
      );
      const host: IRecordWritePlugin = {
        name: 'hostRecordCreate',
        supports: (kind) => kind === RecordWriteOperationKind.createMany,
        prepare: () => ok(undefined),
        guard: hostGuard,
      };
      registrar.installHostRecordCreatePolicy(host);
      const container = createContainer();
      if (hostFirst) registerRecordWritePlugin(container, host);
      registrar.registerProjections(container);
      if (!hostFirst) registerRecordWritePlugin(container, host);
      const plugins = getPlugins(container);
      expect(plugins.filter((plugin) => plugin.name === host.name)).toEqual([host]);
      const gate = plugins.find((plugin) => plugin.name === 'linkTitleRecordCreatePermission')!;
      expect((await gate.prepare!(createContext())).isOk()).toBe(true);
      const installedHost = plugins.find((plugin) => plugin.name === host.name)!;
      const prepared = (await installedHost.prepare!(createContext()))._unsafeUnwrap();
      expect((await installedHost.guard!(createContext(), prepared)).isErr()).toBe(true);
      expect(hostGuard).toHaveBeenCalledTimes(1);
      expect(validPermissions).not.toHaveBeenCalled();
    }
  );

  it('fails closed when another plugin occupies the host policy name', () => {
    const { registrar } = createRegistrar();
    const host: IRecordWritePlugin = { name: 'hostRecordCreate', supports: () => true };
    registrar.installHostRecordCreatePolicy(host);
    const container = createContainer();
    registerRecordWritePlugin(container, { ...host });
    expect(() => registrar.registerProjections(container)).toThrow('does not match');
    expect(
      getPlugins(container).some((plugin) => plugin.name === 'linkTitleRecordCreatePermission')
    ).toBe(false);
  });

  it('rejects a host policy without createMany support and conflicting installations', () => {
    const { registrar } = createRegistrar();
    expect(() =>
      registrar.installHostRecordCreatePolicy({ name: 'readOnly', supports: () => false })
    ).toThrow('support createMany');
    const host: IRecordWritePlugin = { name: 'hostRecordCreate', supports: () => true };
    registrar.installHostRecordCreatePolicy(host);
    expect(() => registrar.installHostRecordCreatePolicy(host)).not.toThrow();
    expect(() => registrar.installHostRecordCreatePolicy({ ...host })).toThrow('already installed');
  });
});
