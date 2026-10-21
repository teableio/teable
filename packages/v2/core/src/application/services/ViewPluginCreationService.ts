import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { generatePrefixedId } from '../../domain/shared/IdGenerator';
import type {
  Table,
  TableCreateViewInput,
  TableDuplicateViewOptions,
} from '../../domain/table/Table';
import type { View } from '../../domain/table/views/View';
import type { ViewId } from '../../domain/table/views/ViewId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import {
  type IViewPluginRepository,
  type ViewPluginInstallation,
} from '../../ports/ViewPluginRepository';

type ViewPluginInstallationSeed = Omit<ViewPluginInstallation, 'viewId' | 'name'>;

export type PreparedViewCreation = {
  readonly input: TableCreateViewInput;
  readonly pluginInstallation?: ViewPluginInstallationSeed;
};

export type PreparedViewDuplication = {
  readonly input: TableDuplicateViewOptions;
  readonly pluginInstallation?: ViewPluginInstallationSeed;
};

@injectable()
export class ViewPluginCreationService {
  constructor(
    @inject(v2CoreTokens.viewPluginRepository)
    private readonly viewPluginRepository: IViewPluginRepository
  ) {}

  async prepare(
    context: IExecutionContext,
    table: Table,
    input: TableCreateViewInput
  ): Promise<Result<PreparedViewCreation, DomainError>> {
    if (input.type !== 'plugin') return ok({ input });

    const options =
      input.options && typeof input.options === 'object' && !Array.isArray(input.options)
        ? (input.options as Record<string, unknown>)
        : {};
    const pluginId = options.pluginId;
    if (typeof pluginId !== 'string') {
      return err(domainError.validation({ message: 'Plugin View requires pluginId' }));
    }

    const pluginResult = await this.viewPluginRepository.findViewPlugin(context, pluginId);
    if (pluginResult.isErr()) return err(pluginResult.error);

    const plugin = pluginResult.value;
    const pluginInstallId = generatePrefixedId('pli', 16);
    return ok({
      input: {
        ...input,
        name: input.name || plugin.name,
        options: {
          pluginId: plugin.id,
          pluginInstallId,
          pluginLogo: plugin.logo,
        },
      },
      pluginInstallation: {
        id: pluginInstallId,
        pluginId: plugin.id,
        baseId: table.baseId().toString(),
      },
    });
  }

  async prepareDuplicate(
    context: IExecutionContext,
    table: Table,
    sourceViewId: ViewId
  ): Promise<Result<PreparedViewDuplication, DomainError>> {
    const sourceViewResult = table.getView(sourceViewId);
    if (sourceViewResult.isErr()) return err(sourceViewResult.error);
    const sourceView = sourceViewResult.value;
    if (sourceView.type().toString() !== 'plugin') return ok({ input: {} });

    const options =
      sourceView.options() &&
      typeof sourceView.options() === 'object' &&
      !Array.isArray(sourceView.options())
        ? (sourceView.options() as Record<string, unknown>)
        : {};
    const pluginId = options.pluginId;
    if (typeof pluginId !== 'string') {
      return err(domainError.validation({ message: 'Plugin View requires pluginId' }));
    }

    const pluginResult = await this.viewPluginRepository.findViewPlugin(context, pluginId);
    if (pluginResult.isErr()) return err(pluginResult.error);
    const sourceInstallationResult =
      await this.viewPluginRepository.findViewPluginInstallationByViewId(
        context,
        sourceViewId.toString()
      );
    if (sourceInstallationResult.isErr()) return err(sourceInstallationResult.error);

    const plugin = pluginResult.value;
    const sourceInstallation = sourceInstallationResult.value;
    const pluginInstallId = generatePrefixedId('pli', 16);
    return ok({
      input: {
        pluginOptions: {
          pluginId: plugin.id,
          pluginInstallId,
          pluginLogo: plugin.logo,
        },
      },
      pluginInstallation: {
        id: pluginInstallId,
        pluginId: plugin.id,
        baseId: table.baseId().toString(),
        storage: sourceInstallation.storage,
      },
    });
  }

  completeInstallation(
    prepared: PreparedViewCreation | PreparedViewDuplication,
    view: View
  ): ViewPluginInstallation | undefined {
    if (!prepared.pluginInstallation) return undefined;
    return {
      ...prepared.pluginInstallation,
      viewId: view.id().toString(),
      name: view.name().toString(),
    };
  }

  insertInstallation(
    context: IExecutionContext,
    installation: ViewPluginInstallation
  ): Promise<Result<void, DomainError>> {
    return this.viewPluginRepository.insertViewPluginInstallation(context, installation);
  }
}
