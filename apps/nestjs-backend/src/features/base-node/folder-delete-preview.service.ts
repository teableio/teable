import { Injectable } from '@nestjs/common';
import { BaseNodeResourceType } from '@teable/openapi';
import {
  PreviewPlannerRegistry,
  TableDeletePreviewPlanner,
  v2CommandExplainTokens,
  type HostPreviewConcern,
  type HostPreviewRegistration,
  type IHostPreviewAdapter,
  type OperationPreviewPlan,
  type PreviewEffect,
  type PreviewIssue,
  type PreviewMeasure,
  type PreviewOptions,
  type PreviewResourceKind,
} from '@teable/v2-command-explain';
import {
  BaseId,
  DeleteTableCommand,
  domainError,
  TableId,
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type ITableDeletionPreparationService,
  type TableDeletionPreparation,
  type TableDeletionPreparationService,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { getTableDeletePreviewAuthorization } from '../v2/v2-delete-preview-resource-authorization';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { BaseNodeMoveService } from './base-node-move.service';
import { checkBaseNodePermission, filterVisibleNodes } from './base-node.permission.helper';
import {
  BaseNodeService,
  type IFolderDeleteItem,
  type IFolderDeleteReference,
} from './base-node.service';
import { BaseNodeAction } from './types';

export const folderDeletePreviewInputSchema = z.object({
  baseId: z.string().min(1),
  nodeId: z.string().min(1),
});

export type FolderDeletePreviewInput = z.infer<typeof folderDeletePreviewInputSchema>;

export const parseFolderDeletePreviewInput = (
  input: unknown
): Result<FolderDeletePreviewInput, DomainError> => {
  const parsed = folderDeletePreviewInputSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(
        domainError.validation({
          code: 'preview.folder.delete.invalid_input',
          message: 'Expected { baseId, nodeId }, nodeId being the folder node ID or folder ID.',
        })
      );
};

const resourceKinds: Partial<Record<BaseNodeResourceType, PreviewResourceKind>> = {
  [BaseNodeResourceType.Table]: 'table',
  [BaseNodeResourceType.Workflow]: 'workflow',
  [BaseNodeResourceType.App]: 'app',
};

const exact = (value: number, unit: string) => ({ basis: 'exact' as const, value, unit });

/**
 * How many fields deleting the table changes, by its own table.delete preview. That preview lists
 * at most `maxItems` and folds the ones the caller may not see into one entry, so when it did
 * either, its list is a lower bound: at least one more than it shows for each.
 */
const fieldMeasure = (plan: OperationPreviewPlan): PreviewMeasure => {
  const redacted = plan.effects.some(
    (effect) => effect.code === 'table.delete.dependent_resources.redacted'
  );
  const truncated = plan.warnings.some((issue) => issue.code === 'table.delete.effects_truncated');
  const shown = plan.effects.filter(
    (effect) =>
      effect.resource?.kind === 'field' &&
      effect.code !== 'table.delete.dependent_resources.redacted'
  ).length;
  if (!redacted && !truncated) return exact(shown, 'field');
  return {
    basis: 'range',
    lower: shown + Number(redacted) + Number(truncated),
    expected: null,
    upper: null,
    unit: 'field',
    source: 'table.delete preview, truncated or redacted',
  };
};

const forbidden = () =>
  err(
    domainError.forbidden({
      code: 'preview.authorization.forbidden',
      message: 'You do not have permission to preview this operation.',
    })
  );

/** Serves deletions prepared together to the single-table planner, one table at a time. */
class PreparedTableDeletions implements ITableDeletionPreparationService {
  constructor(private readonly byTableId: ReadonlyMap<string, TableDeletionPreparation>) {}

  async prepare(
    _context: IExecutionContext,
    command: DeleteTableCommand
  ): Promise<Result<TableDeletionPreparation, DomainError>> {
    const preparation = this.byTableId.get(command.tableId.toString());
    return preparation
      ? ok(preparation)
      : err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
  }
}

/**
 * Previews deleting a folder with everything in it. Each table is described exactly as its own
 * `table.delete` preview would describe it (the dialog shows that preview as the table's
 * detail); the tables are prepared together, from one read of the metadata involved.
 */
export class FolderDeletePreviewPlanner implements IHostPreviewAdapter<FolderDeletePreviewInput> {
  readonly operation = 'folder.delete' as const;
  readonly concerns: ReadonlyArray<HostPreviewConcern> = [
    'trash.retention',
    'workflows',
    'authority',
    'shares',
    'app-runtime.extras',
  ];
  readonly plannerVersion = 'folder-delete-host-v1';
  readonly executionPath = 'BaseNodeService.delete/folder subtree';

  constructor(
    private readonly baseNodeService: BaseNodeService,
    private readonly moveService: BaseNodeMoveService,
    private readonly container: DependencyContainer
  ) {}

  async preview(
    context: IExecutionContext,
    input: FolderDeletePreviewInput,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const { baseId } = input;
    const permissions = await this.moveService.getPermissionContextOutsideRoute(baseId);
    if (!permissions?.permissionSet.has('base|read')) return forbidden();
    // The folder's own ID works as well as its node ID, as it does for the delete itself.
    const nodeId = await this.baseNodeService
      .resolveFolderNodeId(baseId, input.nodeId)
      .catch(() => undefined);
    const items = nodeId ? await this.baseNodeService.getFolderDeleteItems(baseId, nodeId) : [];
    if (!nodeId || items[0]?.resourceType !== BaseNodeResourceType.Folder) {
      return err(
        domainError.notFound({
          code: 'preview.folder.delete.not_found',
          message: 'Folder not found',
        })
      );
    }

    // Everything named, in the folder or outside it, is named only to a caller who may read it,
    // and an item in the folder only if their node tree shows it (a folder they cannot access is
    // hidden there).
    const visible = new Set(
      filterVisibleNodes(items, permissions).map(
        (item) => `${item.resourceType}:${item.resourceId}`
      )
    );
    const inFolder = new Set(items.map((item) => `${item.resourceType}:${item.resourceId}`));
    const reference: IFolderDeleteReference = (item) => {
      const key = `${item.resourceType}:${item.resourceId}`;
      const shown = inFolder.has(key)
        ? visible.has(key)
        : checkBaseNodePermission(item, BaseNodeAction.Read, permissions);
      return shown
        ? {
            visibility: 'authorized',
            kind: resourceKinds[item.resourceType] ?? 'host',
            id: item.resourceId,
            name: item.name,
          }
        : {
            visibility: 'redacted',
            kind: resourceKinds[item.resourceType] ?? 'host',
            quantity: exact(1, item.resourceType),
            reason: 'resource-not-authorized',
          };
    };
    const blockers: PreviewIssue[] = items
      .filter((item) => !checkBaseNodePermission(item, BaseNodeAction.Delete, permissions))
      .map((item) => ({
        code: 'folder.delete.permission_denied',
        message: 'You do not have permission to delete this item.',
        resource: reference(item),
      }));
    const warnings: PreviewIssue[] = [];
    const unknown = new Set<string>();

    const tablePlans = await this.previewTables(context, baseId, items, options);
    if (tablePlans.isErr()) return err(tablePlans.error);
    const effects: PreviewEffect[] = items.map((item) => {
      const plan = tablePlans.value.get(item.resourceId);
      const measures: Record<string, PreviewMeasure> = {};
      if (plan) measures.fields = fieldMeasure(plan);
      if (item.shareCount > 0) measures.shares = exact(item.shareCount, 'share');
      return {
        code: `folder.delete.item.${item.resourceType}`,
        kind: 'resource.trash',
        resource: reference(item),
        measures,
      };
    });
    for (const item of items) {
      const plan = tablePlans.value.get(item.resourceId);
      if (!plan) continue;
      const resource = reference(item);
      blockers.push(...plan.blockers.map((issue) => ({ ...issue, resource })));
      warnings.push(...plan.warnings.map((issue) => ({ resource, ...issue })));
      plan.coverage.unknown.forEach((entry) => unknown.add(entry));
    }
    const unprepared = items.some(
      (item) =>
        item.resourceType === BaseNodeResourceType.Table && !tablePlans.value.has(item.resourceId)
    );
    if (unprepared) unknown.add('table-delete-effects');

    effects.push(
      ...(await this.baseNodeService.getFolderDeleteHostEffects(baseId, items, reference))
    );

    const { dependents, uninspectableApps } = await this.moveService.collectDeleteDependents(
      baseId,
      nodeId
    );
    const tableNames = new Map(items.map((item) => [item.resourceId, reference(item)]));
    for (const dependent of dependents) {
      effects.push({
        code: dependent.uncertain
          ? 'folder.delete.outside_reference.possible'
          : 'folder.delete.outside_reference.broken',
        kind: 'dependency.change',
        resource: reference({
          resourceType: dependent.resourceType,
          resourceId: dependent.resourceId,
          name: dependent.name,
        }),
        relatedResources: dependent.tableIds.flatMap((id) => tableNames.get(id) ?? []),
        measures: { tables: exact(dependent.tableIds.length, 'table') },
      });
    }
    for (const app of uninspectableApps) {
      warnings.push({
        code: 'folder.delete.app_source_unread',
        message: 'The source of this app could not be read for references to deleted tables.',
        resource: reference({
          resourceType: BaseNodeResourceType.App,
          resourceId: app.resourceId,
          name: app.name,
        }),
      });
    }

    return ok({
      effects,
      blockers,
      warnings,
      coverage: {
        known: ['folder-subtree', 'node-permissions', 'shares', 'outside-references'],
        unknown: [...unknown],
      },
      complexity: null,
      authorization: 'checked',
      consistency: 'best-effort',
    });
  }

  private async previewTables(
    context: IExecutionContext,
    baseId: string,
    items: IFolderDeleteItem[],
    options: PreviewOptions
  ): Promise<Result<Map<string, OperationPreviewPlan>, DomainError>> {
    const tableIds = items
      .filter((item) => item.resourceType === BaseNodeResourceType.Table)
      .map((item) => TableId.create(item.resourceId));
    const plans = new Map<string, OperationPreviewPlan>();
    if (tableIds.length === 0) return ok(plans);
    const base = BaseId.create(baseId);
    if (base.isErr()) return err(base.error);
    const ids = tableIds.flatMap((id) => (id.isOk() ? [id.value] : []));
    const preparations = await this.container
      .resolve<TableDeletionPreparationService>(v2CoreTokens.tableDeletionPreparationService)
      .prepareSoftDeleteMany(context, base.value, ids);
    if (preparations.isErr()) return err(preparations.error);

    const planner = new TableDeletePreviewPlanner(
      new PreparedTableDeletions(
        new Map(preparations.value.map((p) => [p.table.id().toString(), p]))
      ),
      getTableDeletePreviewAuthorization(this.container)
    );
    for (const preparation of preparations.value) {
      const tableId = preparation.table.id().toString();
      const command = DeleteTableCommand.create({ baseId, tableId, mode: 'soft' });
      if (command.isErr()) return err(command.error);
      const plan = await planner.preview(context, command.value, options);
      if (plan.isErr()) return err(plan.error);
      plans.set(tableId, plan.value);
    }
    return ok(plans);
  }
}

export const createFolderDeletePreviewRegistration = (
  planner: IHostPreviewAdapter<FolderDeletePreviewInput>,
  priority: number = 0
): HostPreviewRegistration<FolderDeletePreviewInput> => ({
  operation: 'folder.delete',
  parseInput: parseFolderDeletePreviewInput,
  planner,
  priority,
  capability: {
    canonicalWriteRoute: 'DELETE /base/{baseId}/node/{nodeId}',
    supportLevel: 'partial',
    requiredPermissionScope: 'base|read; delete permission on every node in the folder',
    detailLevels: ['summary', 'full'],
    limitations: [
      'Each table is summarised by its field effect count; its own table.delete preview has the detail.',
      'References from app source code are found only where the source could be read.',
    ],
  },
});

@V2ProjectionRegistrar()
@Injectable()
export class FolderDeletePreviewRegistrar implements IV2ProjectionRegistrar {
  constructor(
    private readonly baseNodeService: BaseNodeService,
    private readonly moveService: BaseNodeMoveService
  ) {}

  registerProjections(container: DependencyContainer): void {
    const registry = container.resolve<PreviewPlannerRegistry>(
      v2CommandExplainTokens.previewPlannerRegistry
    );
    const result = registry.registerHost(
      createFolderDeletePreviewRegistration(
        new FolderDeletePreviewPlanner(this.baseNodeService, this.moveService, container)
      )
    );
    if (result.isErr()) throw new Error(result.error.message);
  }
}
