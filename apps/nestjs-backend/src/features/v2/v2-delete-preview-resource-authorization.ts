import { Injectable } from '@nestjs/common';
import type { Action } from '@teable/core';
import {
  createFieldDeletePreviewRegistration,
  createTableDeletePreviewRegistration,
  FieldDeletePreviewPlanner,
  PreviewPlannerRegistry,
  TableDeletePreviewPlanner,
  v2CommandExplainTokens,
  type FieldDeletePreviewResource,
  type HostPreviewRegistration,
  type IFieldDeletePreviewAuthorization,
  type ITableDeletePreviewAuthorization,
  type TableDeletePreviewResource,
} from '@teable/v2-command-explain';
import {
  type FieldDeletionPreparationService,
  TableId,
  type TableQueryService,
  v2CoreTokens,
  type DeleteFieldCommand,
  type DeleteTableCommand,
  type DomainError,
  type IExecutionContext,
  type ITableDeletionPreparationService,
  type Result,
  type Table,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import { ok } from 'neverthrow';

import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

type DeletePreviewResource = FieldDeletePreviewResource | TableDeletePreviewResource;
type DeletePreviewAuthorization = IFieldDeletePreviewAuthorization &
  ITableDeletePreviewAuthorization;

const owningTableId = (resource: DeletePreviewResource): string | undefined =>
  resource.kind === 'table' ? resource.id : resource.tableId;

const requiredReadActions = (resource: DeletePreviewResource): readonly Action[] => {
  switch (resource.kind) {
    case 'field':
      return ['table|read', 'field|read'];
    case 'view':
      return ['table|read', 'view|read'];
    case 'table':
      return ['table|read'];
  }
};

export const resourceBelongsToTable = (table: Table, resource: DeletePreviewResource): boolean => {
  if (resource.kind === 'table') return table.id().toString() === resource.id;
  if (resource.tableId !== table.id().toString()) return false;
  if (resource.kind === 'field') {
    return table.getFields().some((field) => field.id().toString() === resource.id);
  }
  return table.views().some((view) => view.id().toString() === resource.id);
};

const hostFieldDeleteRegistration = (
  planner: FieldDeletePreviewPlanner,
  priority: number,
  edition: string
): HostPreviewRegistration<DeleteFieldCommand> => {
  const core = createFieldDeletePreviewRegistration(planner);
  return {
    ...core,
    priority,
    planner: {
      operation: planner.operation,
      concerns: ['authority'],
      plannerVersion: `${planner.plannerVersion}-${edition}-authority`,
      executionPath: planner.executionPath,
      preview: planner.preview.bind(planner),
    },
  };
};

const hostTableDeleteRegistration = (
  planner: TableDeletePreviewPlanner,
  priority: number,
  edition: string
): HostPreviewRegistration<DeleteTableCommand> => {
  const core = createTableDeletePreviewRegistration(planner);
  return {
    ...core,
    priority,
    planner: {
      operation: planner.operation,
      concerns: ['authority'],
      plannerVersion: `${planner.plannerVersion}-${edition}-authority`,
      executionPath: planner.executionPath,
      preview: planner.preview.bind(planner),
    },
  };
};

/**
 * Replaces only the two core delete planners on the existing registry. The registry instance is
 * already retained by OperationPreviewService, so ranked host registration is the late-binding
 * seam for CE/EE authorization without introducing host concepts into v2-core.
 */
export const registerDeletePreviewResourceAuthorization = (
  container: DependencyContainer,
  authorization: DeletePreviewAuthorization,
  options: { readonly priority: number; readonly edition: string }
): void => {
  const fieldPreparation = container.resolve<FieldDeletionPreparationService>(
    v2CoreTokens.fieldDeletionPreparationService
  );
  const tablePreparation = container.resolve<ITableDeletionPreparationService>(
    v2CoreTokens.tableDeletionPreparationService
  );
  const registry = container.resolve<PreviewPlannerRegistry>(
    v2CommandExplainTokens.previewPlannerRegistry
  );
  const fieldResult = registry.registerHost(
    hostFieldDeleteRegistration(
      new FieldDeletePreviewPlanner(fieldPreparation, authorization),
      options.priority,
      options.edition
    )
  );
  if (fieldResult.isErr()) throw new Error(fieldResult.error.message);

  const tableResult = registry.registerHost(
    hostTableDeleteRegistration(
      new TableDeletePreviewPlanner(tablePreparation, authorization),
      options.priority,
      options.edition
    )
  );
  if (tableResult.isErr()) throw new Error(tableResult.error.message);
};

class CommunityDeletePreviewResourceAuthorization
  implements IFieldDeletePreviewAuthorization, ITableDeletePreviewAuthorization
{
  constructor(
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableQueryService: TableQueryService
  ) {}

  async canReadResource(
    context: IExecutionContext,
    resource: DeletePreviewResource
  ): Promise<Result<boolean, DomainError>> {
    const tableIdText = owningTableId(resource);
    if (!tableIdText) return ok(false);

    try {
      await this.permissionService.validPermissions(
        tableIdText,
        [...requiredReadActions(resource)],
        this.cls.get('accessTokenId')
      );
    } catch {
      return ok(false);
    }

    const tableId = TableId.create(tableIdText);
    if (tableId.isErr()) return ok(false);
    const table = await this.tableQueryService.getById(context, tableId.value);
    if (table.isErr()) return ok(false);
    return ok(resourceBelongsToTable(table.value, resource));
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2DeletePreviewResourceAuthorizationRegistrar implements IV2ProjectionRegistrar {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  registerProjections(container: DependencyContainer): void {
    registerDeletePreviewResourceAuthorization(
      container,
      new CommunityDeletePreviewResourceAuthorization(
        this.permissionService,
        this.cls,
        container.resolve<TableQueryService>(v2CoreTokens.tableQueryService)
      ),
      { priority: 10, edition: 'ce' }
    );
  }
}
