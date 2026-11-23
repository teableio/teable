import { Injectable } from '@nestjs/common';
import type {
  ILinkFieldOptions,
  IConditionalRollupFieldOptions,
  IConditionalLookupOptions,
} from '@teable/core';
import { FieldType, ViewType, isLinkLookupOptions } from '@teable/core';
import type { Field, View, TableMeta, Base } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition } from '@teable/openapi';
import type { BaseNodeResourceType, IBaseJson } from '@teable/openapi';
import { groupBy, omit, pick } from 'lodash';
import { baseDisplayName } from '../../utils/base-name';
import { resolveBuildVersion } from '../../utils/build-version';
import { isCrossSpaceReferenceAllowed } from './cross-space-detection.util';

@Injectable()
export class BaseExportStructureService {
  constructor(private readonly prismaService: PrismaService) {}

  public static readonly FIELD_EXPORT_BATCH_SIZE = 500;

  public static readonly VIEW_EXPORT_BATCH_SIZE = 500;

  private static readonly TABLE_ID_QUERY_CHUNK_SIZE = 100;

  public static readonly EXPORT_FIELD_COLUMNS = [
    'id',
    'name',
    'description',
    'options',
    'type',
    'dbFieldName',
    'notNull',
    'unique',
    'isPrimary',
    'hasError',
    'order',
    'lookupOptions',
    'isLookup',
    'isConditionalLookup',
    'aiConfig',
    'meta',
    // for formula field
    'dbFieldType',
    'cellValueType',
    'isMultipleCellValue',
  ];

  async generateBaseStructConfig({
    baseRaw,
    tableRaws,
    fieldRaws,
    viewRaws,
    // whether support cross base link fields
    allowCrossBase = false,
    includeNodes,
    includedFolderIds,
    includedDashboardIds,
    excludedTableIds,
    // for enterprise version, do not delete these properties
    includedAppIds,
    includedWorkflowIds,
    includedRoutineIds,
    // Root node IDs - nodes that should have their parentId set to null
    rootNodeIds,
    // When set, fields whose foreign base lives in a different space are also
    // degraded to text even when allowCrossBase=true (same-space cross-base
    // remains a real link).
    destSpaceId,
  }: {
    baseRaw: Base;
    tableRaws: TableMeta[];
    fieldRaws: Field[];
    viewRaws: View[];
    allowCrossBase?: boolean;
    includeNodes?: string[];
    includedFolderIds?: string[];
    includedDashboardIds?: string[];
    includedAppIds?: string[];
    includedWorkflowIds?: string[];
    includedRoutineIds?: string[];
    excludedTableIds?: string[];
    rootNodeIds?: string[];
    destSpaceId?: string;
  }) {
    const { name: baseName, icon: baseIcon, id: baseId } = baseRaw;
    const crossSpaceForeignBaseIds = await this.computeCrossSpaceForeignBaseIds(
      fieldRaws,
      destSpaceId
    );
    const fieldsByTableId = groupBy(fieldRaws, 'tableId');
    const viewsByTableId = groupBy(viewRaws, 'tableId');
    const tables = [] as IBaseJson['tables'];
    for (const table of tableRaws) {
      const { name, description, order, id, icon, dbTableName } = table;
      const realDbTableName = dbTableName?.split('.')?.pop();
      const tableObject = {
        id,
        name,
        order,
        description,
        icon,
        dbTableName: realDbTableName,
      } as IBaseJson['tables'][number];
      const currentTableFields = fieldsByTableId[id] ?? [];
      tableObject.fields = this.generateFieldConfig(
        currentTableFields,
        allowCrossBase,
        excludedTableIds,
        crossSpaceForeignBaseIds
      );
      tableObject.views = this.generateViewConfig(viewsByTableId[id] ?? []);
      tables.push(tableObject);
    }

    const plugins = await this.generatePluginConfig(
      baseId,
      includedDashboardIds,
      viewRaws,
      tableRaws.map(({ id }) => id)
    );
    const folders = await this.generateFolderConfig(baseId, includedFolderIds);
    const nodes = await this.generateNodeConfig(baseId, includeNodes, rootNodeIds);

    return {
      id: baseId,
      // structure.json is also the source of the duplicate/import base name: never null here
      name: baseDisplayName(baseName),
      icon: baseIcon,
      version: resolveBuildVersion(),
      tables,
      plugins,
      folders,
      nodes,
    };
  }

  async findFieldsByTableIds(tableIds: string[]) {
    const prisma = this.prismaService.txClient();
    const fieldRaws: Field[] = [];

    for (
      let index = 0;
      index < tableIds.length;
      index += BaseExportStructureService.TABLE_ID_QUERY_CHUNK_SIZE
    ) {
      const tableIdChunk = tableIds.slice(
        index,
        index + BaseExportStructureService.TABLE_ID_QUERY_CHUNK_SIZE
      );
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const page = await prisma.field.findMany({
          where: {
            tableId: { in: tableIdChunk },
            deletedTime: null,
          },
          ...(cursor
            ? {
                cursor: {
                  id: cursor,
                },
                skip: 1,
              }
            : {}),
          orderBy: [{ tableId: 'asc' }, { id: 'asc' }],
          take: BaseExportStructureService.FIELD_EXPORT_BATCH_SIZE,
        });

        fieldRaws.push(...page);

        hasMore = page.length === BaseExportStructureService.FIELD_EXPORT_BATCH_SIZE;
        if (hasMore) {
          cursor = page[page.length - 1].id;
        }
      }
    }

    return fieldRaws;
  }

  async findViewsByTableIds(tableIds: string[]) {
    const prisma = this.prismaService.txClient();
    const viewRaws: View[] = [];

    for (
      let index = 0;
      index < tableIds.length;
      index += BaseExportStructureService.TABLE_ID_QUERY_CHUNK_SIZE
    ) {
      const tableIdChunk = tableIds.slice(
        index,
        index + BaseExportStructureService.TABLE_ID_QUERY_CHUNK_SIZE
      );
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const page = await prisma.view.findMany({
          where: {
            tableId: { in: tableIdChunk },
            deletedTime: null,
          },
          ...(cursor
            ? {
                cursor: {
                  id: cursor,
                },
                skip: 1,
              }
            : {}),
          orderBy: [{ tableId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
          take: BaseExportStructureService.VIEW_EXPORT_BATCH_SIZE,
        });

        viewRaws.push(...page);

        hasMore = page.length === BaseExportStructureService.VIEW_EXPORT_BATCH_SIZE;
        if (hasMore) {
          cursor = page[page.length - 1].id;
        }
      }
    }

    return viewRaws;
  }

  private generateFieldConfig(
    fieldRaws: Field[],
    allowCrossBase = false,
    excludedTableIds?: string[],
    crossSpaceForeignBaseIds: Set<string> = new Set()
  ) {
    const fields = fieldRaws.map((fieldRaw) => ({
      ...fieldRaw,
      options: JSON.parse(fieldRaw.options || 'null'),
      lookupOptions: JSON.parse(fieldRaw.lookupOptions || 'null'),
      meta: JSON.parse(fieldRaw.meta || 'null'),
      aiConfig: JSON.parse(fieldRaw.aiConfig || 'null'),
    }));
    const createdTimeMap = fieldRaws.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    const crossBaseRelativeFields = this.getCrossBaseFields(
      fieldRaws,
      allowCrossBase,
      crossSpaceForeignBaseIds
    );

    const disconnectedFields = this.getDisconnectedFields(
      fieldRaws,
      crossBaseRelativeFields.map(({ id }) => id),
      excludedTableIds
    );

    const otherFields = fields
      .filter(
        ({ id }) =>
          !crossBaseRelativeFields.map(({ id }) => id).includes(id) &&
          !disconnectedFields.map(({ id }) => id).includes(id)
      )
      .map((field) => ({
        ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
        createdTime: createdTimeMap[field.id],
        order: field.order,
      }));

    return [
      ...otherFields,
      ...crossBaseRelativeFields,
      ...disconnectedFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private getDisconnectedFields(
    fieldRaws: Field[],
    crossBaseRelativeFields: string[],
    excludedTableIds?: string[]
  ) {
    const restFields = fieldRaws.filter(({ id }) => !crossBaseRelativeFields?.includes(id));
    if (!excludedTableIds?.length) {
      return [];
    }

    const fields = restFields.map((fieldRaw) => ({
      ...fieldRaw,
      options: JSON.parse(fieldRaw.options || 'null'),
      lookupOptions: JSON.parse(fieldRaw.lookupOptions || 'null'),
      meta: JSON.parse(fieldRaw.meta || 'null'),
      aiConfig: JSON.parse(fieldRaw.aiConfig || 'null'),
    }));
    const createdTimeMap = restFields.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    const disconnectedLinkFields = fields
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .filter(({ options }) =>
        excludedTableIds.includes((options as ILinkFieldOptions)?.foreignTableId)
      )
      .map((field) => {
        const res = {
          ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
          type: FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: field.order,
        };

        return omit(res, [
          'options',
          'lookupOptions',
          'isLookup',
          'isConditionalLookup',
          'isMultipleCellValue',
        ]);
      });

    // fields which rely on the disconnected link fields (link-based lookup/rollup)
    const disconnectedRelativeFields = fields
      .filter(
        ({ type, isLookup }) =>
          isLookup || type === FieldType.Rollup || type === FieldType.ConditionalRollup
      )
      .filter(({ lookupOptions }) => {
        if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
          return false;
        }
        return disconnectedLinkFields.map(({ id }) => id).includes(lookupOptions.linkFieldId);
      })
      .map((field) => {
        const res = {
          ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
          type: FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: field.order,
          dbFieldType: 'TEXT',
          cellValueType: 'string',
        };

        return omit(res, [
          'options',
          'lookupOptions',
          'isLookup',
          'isConditionalLookup',
          'isMultipleCellValue',
        ]);
      });

    const alreadyHandledIds = new Set([
      ...disconnectedLinkFields.map(({ id }) => id),
      ...disconnectedRelativeFields.map(({ id }) => id),
    ]);

    // Conditional fields (ConditionalLookup/ConditionalRollup) that directly reference excluded tables
    // These don't go through a link field, so they aren't caught by the link-based check above
    const disconnectedConditionalFields = fields
      .filter(({ id }) => !alreadyHandledIds.has(id))
      .filter(
        ({ type, isLookup, isConditionalLookup }) =>
          (isLookup && isConditionalLookup) || type === FieldType.ConditionalRollup
      )
      .filter((field) => {
        const { type, isLookup, isConditionalLookup, lookupOptions, options } = field;

        if (isLookup && isConditionalLookup) {
          const conditionalOptions = lookupOptions as IConditionalLookupOptions | undefined;
          return (
            conditionalOptions?.foreignTableId &&
            excludedTableIds.includes(conditionalOptions.foreignTableId)
          );
        }

        if (type === FieldType.ConditionalRollup) {
          const conditionalOptions = options as IConditionalRollupFieldOptions | undefined;
          return (
            conditionalOptions?.foreignTableId &&
            excludedTableIds.includes(conditionalOptions.foreignTableId)
          );
        }

        return false;
      })
      .map((field) => {
        const res = {
          ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
          type: FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: field.order,
          dbFieldType: 'TEXT',
          cellValueType: 'string',
        };

        return omit(res, [
          'options',
          'lookupOptions',
          'isLookup',
          'isConditionalLookup',
          'isMultipleCellValue',
        ]);
      });

    return [
      ...disconnectedLinkFields,
      ...disconnectedRelativeFields,
      ...disconnectedConditionalFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private async computeCrossSpaceForeignBaseIds(
    fieldRaws: Field[],
    destSpaceId?: string
  ): Promise<Set<string>> {
    if (!destSpaceId || isCrossSpaceReferenceAllowed()) return new Set();
    const foreignBaseIds = new Set<string>();
    for (const f of fieldRaws) {
      try {
        const opts = f.options ? JSON.parse(f.options as string) : null;
        const baseId = opts?.baseId;
        if (typeof baseId === 'string') foreignBaseIds.add(baseId);
      } catch {
        // ignore
      }
      try {
        const lopts = f.lookupOptions ? JSON.parse(f.lookupOptions as string) : null;
        const baseId = lopts?.baseId;
        if (typeof baseId === 'string') foreignBaseIds.add(baseId);
      } catch {
        // ignore
      }
    }
    if (foreignBaseIds.size === 0) return new Set();
    const bases = await this.prismaService.txClient().base.findMany({
      where: { id: { in: Array.from(foreignBaseIds) }, deletedTime: null },
      select: { id: true, spaceId: true },
    });
    return new Set(bases.filter((b) => b.spaceId !== destSpaceId).map((b) => b.id));
  }

  private getCrossBaseFields(
    fieldRaws: Field[],
    allowCrossBase = false,
    crossSpaceForeignBaseIds: Set<string> = new Set()
  ) {
    const fields = fieldRaws.map((fieldRaw) => ({
      ...fieldRaw,
      options: JSON.parse(fieldRaw.options || 'null'),
      lookupOptions: JSON.parse(fieldRaw.lookupOptions || 'null'),
      meta: JSON.parse(fieldRaw.meta || 'null'),
      aiConfig: JSON.parse(fieldRaw.aiConfig || 'null'),
    }));
    const createdTimeMap = fieldRaws.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    // When allowCrossBase=false, every cross-base field is degraded (legacy behavior).
    // When allowCrossBase=true, only fields whose foreign base lives in a different
    // space than the destination (crossSpaceForeignBaseIds) are degraded — same-space
    // cross-base relationships are preserved.
    const shouldDegradeByBaseId = (baseId: string | undefined): boolean => {
      if (!baseId) return false;
      if (!allowCrossBase) return true;
      return crossSpaceForeignBaseIds.has(baseId);
    };

    const linkDegradeIds = new Set<string>(
      fields
        .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
        .filter(({ options }) =>
          shouldDegradeByBaseId((options as ILinkFieldOptions | undefined)?.baseId)
        )
        .map(({ id }) => id)
    );

    const omitDegradedKeys = [
      'options',
      'lookupOptions',
      'isLookup',
      'isConditionalLookup',
      'isMultipleCellValue',
    ] as const;

    const crossBaseLinkFields = fields
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .filter(({ options }) => Boolean((options as ILinkFieldOptions)?.baseId))
      .map((field) => {
        const degrade = linkDegradeIds.has(field.id);
        const res = {
          ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
          type: degrade ? FieldType.SingleLineText : field.type,
          createdTime: createdTimeMap[field.id],
          order: field.order,
        };

        return degrade ? omit(res, omitDegradedKeys) : res;
      });

    // fields which rely on the cross base link fields (link-based lookup/rollup)
    const relativeFields = fields
      .filter(
        ({ type, isLookup }) =>
          isLookup || type === FieldType.Rollup || type === FieldType.ConditionalRollup
      )
      .filter((field) => {
        const { lookupOptions, type, options } = field;

        // Case 1: lookup field that is itself a cross-base link (type === 'link' && isLookup && options.baseId)
        // This happens when you lookup a cross-base link field through a local link field
        if (type === FieldType.Link && (options as ILinkFieldOptions)?.baseId) {
          return true;
        }

        // Case 2: lookup/rollup field that depends on a cross-base link field
        if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
          return false;
        }
        return crossBaseLinkFields.map(({ id }) => id).includes(lookupOptions.linkFieldId);
      })
      .map((field) => {
        let degrade: boolean;
        if (field.type === FieldType.Link && (field.options as ILinkFieldOptions)?.baseId) {
          degrade = shouldDegradeByBaseId((field.options as ILinkFieldOptions).baseId);
        } else if (field.lookupOptions && isLinkLookupOptions(field.lookupOptions)) {
          degrade = linkDegradeIds.has(field.lookupOptions.linkFieldId);
        } else {
          degrade = !allowCrossBase;
        }

        const res = {
          ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
          type: degrade ? FieldType.SingleLineText : field.type,
          createdTime: createdTimeMap[field.id],
          order: field.order,
          dbFieldType: degrade ? 'TEXT' : field.dbFieldType,
          cellValueType: degrade ? 'string' : field.cellValueType,
        };

        return degrade ? omit(res, omitDegradedKeys) : res;
      });

    const alreadyHandledIds = new Set([
      ...crossBaseLinkFields.map(({ id }) => id),
      ...relativeFields.map(({ id }) => id),
    ]);

    // Conditional fields (ConditionalLookup/ConditionalRollup) that are cross-base
    // These don't use a link field as intermediary, so they have their own baseId
    const conditionalCrossBaseFields = fields
      .filter(({ id }) => !alreadyHandledIds.has(id))
      .filter(
        ({ type, isLookup, isConditionalLookup }) =>
          (isLookup && isConditionalLookup) || type === FieldType.ConditionalRollup
      )
      .filter((field) => {
        const { type, isLookup, isConditionalLookup, lookupOptions, options } = field;

        if (isLookup && isConditionalLookup) {
          const conditionalOptions = lookupOptions as IConditionalLookupOptions | undefined;
          return Boolean(conditionalOptions?.baseId);
        }

        if (type === FieldType.ConditionalRollup) {
          const conditionalOptions = options as IConditionalRollupFieldOptions | undefined;
          return Boolean(conditionalOptions?.baseId);
        }

        return false;
      })
      .map((field) => {
        const conditionalBaseId =
          field.isLookup && field.isConditionalLookup
            ? (field.lookupOptions as IConditionalLookupOptions | undefined)?.baseId
            : (field.options as IConditionalRollupFieldOptions | undefined)?.baseId;
        const degrade = shouldDegradeByBaseId(conditionalBaseId);

        const res = {
          ...pick(field, BaseExportStructureService.EXPORT_FIELD_COLUMNS),
          type: degrade ? FieldType.SingleLineText : field.type,
          createdTime: createdTimeMap[field.id],
          order: field.order,
          dbFieldType: degrade ? 'TEXT' : field.dbFieldType,
          cellValueType: degrade ? 'string' : field.cellValueType,
        };

        return degrade ? omit(res, omitDegradedKeys) : res;
      });

    return [
      ...crossBaseLinkFields,
      ...relativeFields,
      ...conditionalCrossBaseFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private generateViewConfig(viewRaws: View[]): IBaseJson['tables'][number]['views'] {
    return (
      viewRaws
        // .filter(({ type }) => type !== ViewType.Plugin)
        .map((viewRaw) => ({
          ...viewRaw,
          options: JSON.parse(viewRaw.options || 'null') || undefined,
          filter: JSON.parse(viewRaw.filter || 'null') || undefined,
          sort: JSON.parse(viewRaw.sort || 'null') || undefined,
          group: JSON.parse(viewRaw.group || 'null') || undefined,
          columnMeta: JSON.parse(viewRaw.columnMeta || 'null') || undefined,
          shareMeta: JSON.parse(viewRaw.shareMeta || 'null') || undefined,
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((view, index) => ({
          ...pick(view, [
            'id',
            'name',
            'description',
            'type',
            'sort',
            'filter',
            'group',
            'options',
            'columnMeta',
            'enableShare',
            'shareMeta',
            'shareId',
            'isLocked',
          ]),
          order: index,
        })) as IBaseJson['tables'][number]['views']
    );
  }

  async generateFolderConfig(
    baseId: string,
    includedFolderIds?: string[]
  ): Promise<IBaseJson['folders']> {
    // If includedFolderIds is an empty array, return empty array (user filtered but no folders selected)
    if (includedFolderIds !== undefined && includedFolderIds.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const folderRaws = await prisma.baseNodeFolder.findMany({
      where: {
        baseId,
        deletedTime: null,
        ...(includedFolderIds && includedFolderIds.length > 0
          ? { id: { in: includedFolderIds } }
          : {}),
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        name: true,
      },
    });

    return folderRaws.map((folderRaw) => ({
      id: folderRaw.id,
      name: folderRaw.name,
    }));
  }

  async generateNodeConfig(
    baseId: string,
    includeNodes?: string[],
    rootNodeIds?: string[]
  ): Promise<IBaseJson['nodes']> {
    // If includeNodes is an empty array, return empty array (user filtered but no nodes selected)
    if (includeNodes !== undefined && includeNodes.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const nodeRaws = await prisma.baseNode.findMany({
      where: {
        baseId,
        ...(includeNodes && includeNodes.length > 0 ? { id: { in: includeNodes } } : {}),
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        parentId: true,
        resourceId: true,
        resourceType: true,
        order: true,
      },
    });

    const rootNodeIdSet = rootNodeIds ? new Set(rootNodeIds) : null;

    return nodeRaws.map((nodeRaw) => {
      // Set parentId to null if:
      // 1. This node is in rootNodeIds, or
      // 2. The parent node is not in includeNodes
      const parentId =
        rootNodeIdSet?.has(nodeRaw.id) ||
        (includeNodes && nodeRaw.parentId && !includeNodes.includes(nodeRaw.parentId))
          ? null
          : nodeRaw.parentId;

      return {
        id: nodeRaw.id,
        parentId,
        resourceId: nodeRaw.resourceId,
        resourceType: nodeRaw.resourceType as BaseNodeResourceType,
        order: nodeRaw.order,
      };
    });
  }

  async generatePluginConfig(
    baseId: string,
    includedDashboardIds?: string[],
    viewRaws?: View[],
    includedTableIds?: string[]
  ) {
    const pluginJson = {} as IBaseJson['plugins'];

    pluginJson[PluginPosition.Dashboard] = await this.generateDashboard(
      baseId,
      includedDashboardIds
    );

    pluginJson[PluginPosition.Panel] = await this.generatePluginPanel(baseId, includedTableIds);

    pluginJson[PluginPosition.View] = await this.generatePluginView(baseId, viewRaws);

    return pluginJson;
  }

  private async generatePluginView(baseId: string, viewRaws?: View[]) {
    const viewPluginRaws = viewRaws
      ? viewRaws.filter(({ type }) => type === ViewType.Plugin)
      : await this.findPluginViewsByBaseId(baseId);

    const viewPluginInstallRaws = await this.prismaService.txClient().pluginInstall.findMany({
      where: {
        positionId: {
          in: viewPluginRaws.map(({ id }) => id),
        },
      },
    });

    return viewPluginRaws.map((viewRaw) => {
      const pluginInstall = viewPluginInstallRaws.find(
        ({ positionId }) => positionId === viewRaw.id
      )!;

      return {
        ...pick(viewRaw, ['id', 'name', 'description', 'type', 'isLocked', 'tableId', 'order']),
        columnMeta: viewRaw.columnMeta ? JSON.parse(viewRaw.columnMeta) : null,
        options: viewRaw.options ? JSON.parse(viewRaw.options) : null,
        filter: viewRaw.filter ? JSON.parse(viewRaw.filter) : null,
        group: viewRaw.group ? JSON.parse(viewRaw.group) : null,
        shareMeta: viewRaw.shareMeta ? JSON.parse(viewRaw.shareMeta) : null,
        pluginInstall: {
          ...pick(pluginInstall, ['id', 'pluginId', 'baseId', 'name', 'positionId', 'position']),
          storage: pluginInstall.storage ? JSON.parse(pluginInstall.storage) : null,
        },
      };
    }) as unknown as IBaseJson['plugins'][PluginPosition.View];
  }

  private async findPluginViewsByBaseId(baseId: string) {
    const tableIds = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });

    return (await this.findViewsByTableIds(tableIds.map(({ id }) => id))).filter(
      ({ type }) => type === ViewType.Plugin
    );
  }

  private async generatePluginPanel(baseId: string, includedTableIds?: string[]) {
    const prisma = this.prismaService.txClient();
    const tableIds =
      includedTableIds ??
      (
        await prisma.tableMeta.findMany({
          where: {
            baseId,
            deletedTime: null,
          },
          select: {
            id: true,
          },
        })
      ).map(({ id }) => id);

    const pluginPanelRaws = await prisma.pluginPanel.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        name: true,
        layout: true,
        tableId: true,
      },
    });

    const panelInstallPluginRaws = await prisma.pluginInstall.findMany({
      where: {
        positionId: {
          in: pluginPanelRaws.map(({ id }) => id),
        },
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        positionId: true,
        position: true,
        storage: true,
      },
    });

    return pluginPanelRaws.map(({ id, name, layout, tableId }) => {
      const panelConfig = {
        id,
        name,
        layout: layout ? JSON.parse(layout) : null,
        tableId,
      } as unknown as IBaseJson['plugins'][PluginPosition.Panel][number];

      panelConfig.pluginInstall = panelInstallPluginRaws
        .filter(({ positionId }) => positionId === id)
        .map(({ id, pluginId, positionId, position, name, storage }) => ({
          id,
          pluginId,
          positionId,
          position,
          name,
          storage: storage ? JSON.parse(storage) : null,
        })) as unknown as IBaseJson['plugins'][PluginPosition.Panel][number]['pluginInstall'];

      return panelConfig;
    });
  }

  private async generateDashboard(baseId: string, includedDashboardIds?: string[]) {
    // If includedDashboardIds is an empty array, return empty array (user filtered but no dashboards selected)
    if (includedDashboardIds !== undefined && includedDashboardIds.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const dashboardRaws = await prisma.dashboard.findMany({
      where: {
        baseId,
        deletedTime: null,
        ...(includedDashboardIds && includedDashboardIds.length > 0
          ? { id: { in: includedDashboardIds } }
          : {}),
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        name: true,
        layout: true,
      },
    });

    const dashboardInstallPluginRaws = await prisma.pluginInstall.findMany({
      where: {
        positionId: {
          in: dashboardRaws.map(({ id }) => id),
        },
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        positionId: true,
        position: true,
        storage: true,
      },
    });

    return dashboardRaws.map(({ id, name, layout }) => {
      const dashboardConfig = {
        id,
        name,
        layout: layout ? JSON.parse(layout) : null,
      } as unknown as IBaseJson['plugins'][PluginPosition.Dashboard][number];

      dashboardConfig.pluginInstall = dashboardInstallPluginRaws
        .filter(({ positionId }) => positionId === id)
        .map(({ id, pluginId, positionId, position, name, storage }) => ({
          id,
          pluginId,
          positionId,
          position,
          name,
          storage: storage ? JSON.parse(storage) : null,
        })) as unknown as IBaseJson['plugins'][PluginPosition.Dashboard][number]['pluginInstall'];

      return dashboardConfig;
    });
  }
}
