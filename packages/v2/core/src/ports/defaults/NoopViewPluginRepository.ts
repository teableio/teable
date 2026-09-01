import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../ExecutionContext';
import type {
  IViewPluginRepository,
  UpdateViewPluginStorageInput,
  ViewPluginDefinition,
  ViewPluginInstallation,
  ViewPluginInstallationInfo,
  ViewPluginInstallationSource,
} from '../ViewPluginRepository';

/**
 * Default when plugin-view persistence is not registered. Table-owned plugin views only.
 * Do not copy as a host-hook Noop (folder, billing, sidebar).
 */
export class NoopViewPluginRepository implements IViewPluginRepository {
  async findViewPlugin(
    _context: IExecutionContext,
    _pluginId: string
  ): Promise<Result<ViewPluginDefinition, DomainError>> {
    return err(domainError.notFound({ message: 'View plugin repository is not configured' }));
  }

  async insertViewPluginInstallation(
    _context: IExecutionContext,
    _installation: ViewPluginInstallation
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async findViewPluginInstallationByViewId(
    _context: IExecutionContext,
    _viewId: string
  ): Promise<Result<ViewPluginInstallationSource, DomainError>> {
    return err(domainError.notFound({ message: 'View plugin repository is not configured' }));
  }

  async getViewPluginInstallation(
    _context: IExecutionContext,
    _baseId: string,
    _viewId: string
  ): Promise<Result<ViewPluginInstallationInfo, DomainError>> {
    return err(domainError.notFound({ message: 'View plugin installation is not configured' }));
  }

  async updateViewPluginStorage(
    _context: IExecutionContext,
    _input: UpdateViewPluginStorageInput
  ): Promise<Result<void, DomainError>> {
    return err(domainError.notFound({ message: 'View plugin installation is not configured' }));
  }
}
