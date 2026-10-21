import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type ViewPluginDefinition = {
  readonly id: string;
  readonly name: string;
  readonly logo: string;
};

export type ViewPluginInstallation = {
  readonly id: string;
  readonly pluginId: string;
  readonly baseId: string;
  readonly viewId: string;
  readonly name: string;
  readonly storage?: string | null;
};

export type ViewPluginInstallationSource = {
  readonly storage: string | null;
};

export type ViewPluginInstallationInfo = {
  readonly id: string;
  readonly pluginId: string;
  readonly baseId: string;
  readonly viewId: string;
  readonly name: string;
  readonly url?: string;
  readonly storage?: Readonly<Record<string, unknown>>;
};

export type UpdateViewPluginStorageInput = {
  readonly baseId: string;
  readonly viewId: string;
  readonly pluginInstallId: string;
  readonly storage?: Readonly<Record<string, unknown>>;
};

/**
 * Persistence for Table-owned plugin views (`ViewType.Plugin`).
 *
 * Allowed here because plugin install state belongs to a View on the Table aggregate.
 * Not a generic host-extension hook — do not copy this Noop-repository shape for folder /
 * base-node / billing / sidebar.
 */
export interface IViewPluginRepository {
  findViewPlugin(
    context: IExecutionContext,
    pluginId: string
  ): Promise<Result<ViewPluginDefinition, DomainError>>;

  insertViewPluginInstallation(
    context: IExecutionContext,
    installation: ViewPluginInstallation
  ): Promise<Result<void, DomainError>>;

  findViewPluginInstallationByViewId(
    context: IExecutionContext,
    viewId: string
  ): Promise<Result<ViewPluginInstallationSource, DomainError>>;

  getViewPluginInstallation(
    context: IExecutionContext,
    baseId: string,
    viewId: string
  ): Promise<Result<ViewPluginInstallationInfo, DomainError>>;

  updateViewPluginStorage(
    context: IExecutionContext,
    input: UpdateViewPluginStorageInput
  ): Promise<Result<void, DomainError>>;
}
