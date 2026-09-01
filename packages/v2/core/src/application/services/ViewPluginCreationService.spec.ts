import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IViewPluginRepository } from '../../ports/ViewPluginRepository';
import { ViewPluginCreationService } from './ViewPluginCreationService';

const context: IExecutionContext = {
  actorId: ActorId.create('actor')._unsafeUnwrap(),
};

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Plugins')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildRepository = (): IViewPluginRepository => ({
  findViewPlugin: vi.fn(async () =>
    ok({
      id: 'plg-view',
      name: 'Plugin default',
      logo: 'https://example.test/logo.png',
    })
  ),
  insertViewPluginInstallation: vi.fn(async () => ok(undefined)),
  findViewPluginInstallationByViewId: vi.fn(async () =>
    ok({
      storage: JSON.stringify({ copied: true }),
    })
  ),
  getViewPluginInstallation: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
  updateViewPluginStorage: vi.fn(async () => err(domainError.notFound({ message: 'Not used' }))),
});

describe('ViewPluginCreationService', () => {
  it('leaves non-Plugin creation input untouched', async () => {
    const repository = buildRepository();
    const service = new ViewPluginCreationService(repository);
    const input = { type: 'grid' as const, name: 'Grid' };

    const prepared = await service.prepare(context, buildTable(), input);

    expect(prepared._unsafeUnwrap()).toEqual({ input });
    expect(repository.findViewPlugin).not.toHaveBeenCalled();
  });

  it('resolves Plugin defaults and completes the installation from the created View', async () => {
    const repository = buildRepository();
    const service = new ViewPluginCreationService(repository);
    const table = buildTable();

    const prepared = (
      await service.prepare(context, table, {
        type: 'plugin',
        name: '',
        options: {
          pluginId: 'plg-view',
          pluginInstallId: 'ignored',
          pluginLogo: 'ignored',
        },
      })
    )._unsafeUnwrap();
    const created = table.createView(prepared.input)._unsafeUnwrap().view;
    const installation = service.completeInstallation(prepared, created);

    expect(prepared.input).toMatchObject({
      type: 'plugin',
      name: 'Plugin default',
      options: {
        pluginId: 'plg-view',
        pluginLogo: 'https://example.test/logo.png',
      },
    });
    expect(prepared.input.options).not.toMatchObject({ pluginInstallId: 'ignored' });
    expect(installation).toMatchObject({
      pluginId: 'plg-view',
      baseId: table.baseId().toString(),
      viewId: created.id().toString(),
      name: 'Plugin default',
    });
    expect(installation?.id).toBe(
      (prepared.input.options as { pluginInstallId: string }).pluginInstallId
    );
  });

  it('rejects a Plugin View without pluginId and propagates repository failures', async () => {
    const missingIdService = new ViewPluginCreationService(buildRepository());
    const missingId = await missingIdService.prepare(context, buildTable(), {
      type: 'plugin',
      options: {},
    });
    expect(missingId.isErr()).toBe(true);

    const repository = buildRepository();
    vi.mocked(repository.findViewPlugin).mockResolvedValue(
      err(domainError.notFound({ message: 'Plugin not found' }))
    );
    const missingPluginService = new ViewPluginCreationService(repository);
    const missingPlugin = await missingPluginService.prepare(context, buildTable(), {
      type: 'plugin',
      options: { pluginId: 'missing' },
    });
    expect(missingPlugin._unsafeUnwrapErr().code).toBe('not_found');
  });

  it('leaves non-Plugin duplication input empty without touching the integration repository', async () => {
    const repository = buildRepository();
    const service = new ViewPluginCreationService(repository);
    const table = buildTable();

    const prepared = await service.prepareDuplicate(context, table, table.views()[0]!.id());

    expect(prepared._unsafeUnwrap()).toEqual({ input: {} });
    expect(repository.findViewPlugin).not.toHaveBeenCalled();
    expect(repository.findViewPluginInstallationByViewId).not.toHaveBeenCalled();
  });

  it('prepares a new Plugin installation and preserves the source storage by View identity', async () => {
    const repository = buildRepository();
    const service = new ViewPluginCreationService(repository);
    const table = buildTable();
    const source = table
      .createView({
        type: 'plugin',
        name: 'Plugin',
        options: {
          pluginId: 'plg-view',
          pluginInstallId: 'pli-stale-option',
          pluginLogo: 'old-logo',
        },
      })
      ._unsafeUnwrap();
    const currentTable = source.updateResult.table;

    const prepared = (
      await service.prepareDuplicate(context, currentTable, source.view.id())
    )._unsafeUnwrap();
    const duplicated = currentTable
      .duplicateView(source.view.id(), prepared.input)
      ._unsafeUnwrap().view;
    const installation = service.completeInstallation(prepared, duplicated);

    expect(repository.findViewPluginInstallationByViewId).toHaveBeenCalledWith(
      context,
      source.view.id().toString()
    );
    expect(prepared.input.pluginOptions).toMatchObject({
      pluginId: 'plg-view',
      pluginLogo: 'https://example.test/logo.png',
    });
    expect(prepared.input.pluginOptions?.pluginInstallId).not.toBe('pli-stale-option');
    expect(installation).toMatchObject({
      id: prepared.input.pluginOptions?.pluginInstallId,
      viewId: duplicated.id().toString(),
      name: 'Plugin 2',
      storage: JSON.stringify({ copied: true }),
    });
  });

  it('propagates a missing source Plugin installation', async () => {
    const repository = buildRepository();
    vi.mocked(repository.findViewPluginInstallationByViewId).mockResolvedValue(
      err(domainError.notFound({ message: 'Plugin installation not found' }))
    );
    const service = new ViewPluginCreationService(repository);
    const table = buildTable();
    const source = table
      .createView({
        type: 'plugin',
        options: {
          pluginId: 'plg-view',
          pluginInstallId: 'pli-source',
          pluginLogo: 'old-logo',
        },
      })
      ._unsafeUnwrap();

    const result = await service.prepareDuplicate(
      context,
      source.updateResult.table,
      source.view.id()
    );

    expect(result._unsafeUnwrapErr().code).toBe('not_found');
  });
});
