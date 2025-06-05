import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType, IdPrefix } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { IMoveTableRo } from '@teable/openapi';
import { Knex } from 'knex';
import { differenceBy, isEmpty, omit } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { BatchService } from '../calculation/batch.service';
import { FieldDuplicateService } from '../field/field-duplicate/field-duplicate.service';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { TableService } from './table.service';

@Injectable()
export class TableMoveService {
  private logger = new Logger(TableMoveService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly tableService: TableService,
    private readonly fieldOpenService: FieldOpenApiService,
    private readonly fieldDuplicateService: FieldDuplicateService,
    private readonly batchService: BatchService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async moveTable(baseId: string, tableId: string, moveRo: IMoveTableRo) {
    const { baseId: targetBaseId } = moveRo;

    const table = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
    });

    const maxOrder = await this.prismaService.tableMeta.aggregate({
      where: { baseId: targetBaseId, deletedTime: null },
      _max: { order: true },
    });

    if (baseId === targetBaseId) {
      throw new BadRequestException('Source baseId and target baseId are the same');
    }

    return this.prismaService.$tx(
      async (prisma) => {
        // move relative fields
        await this.moveRelativeFields(baseId, targetBaseId, tableId);

        const newDbTableName = this.dbProvider
          .moveTableQuery(this.knex.queryBuilder())
          .getMovedDbTableName(table.dbTableName, targetBaseId);

        // table meta
        await prisma.tableMeta.update({
          where: { id: tableId },
          data: {
            baseId: targetBaseId,
            dbTableName: newDbTableName,
            order: maxOrder._max.order ? maxOrder._max.order + 1 : 0,
            version: table.version + 1,
          },
        });

        // move table plugins
        await this.moveTablePlugins(baseId, targetBaseId, tableId);

        // move junction
        await this.moveJunctionTable(baseId, targetBaseId, tableId);

        // move current base fields
        await this.moveFields(baseId, targetBaseId, tableId);

        // move relative base fields
        await this.moveRelativeFields(baseId, targetBaseId, tableId);

        // change table schema (move table to other base)
        const sql = this.dbProvider
          .moveTableQuery(this.knex.queryBuilder())
          .updateTableSchema(table.dbTableName, targetBaseId)
          .toQuery();

        await prisma.$executeRawUnsafe(sql);

        await this.moveRelativeTableConfig(table.dbTableName, newDbTableName);

        await this.batchService.saveRawOps(baseId, RawOpType.Del, IdPrefix.Table, [
          { docId: tableId, version: table.version },
        ]);

        await this.batchService.saveRawOps(targetBaseId, RawOpType.Create, IdPrefix.Table, [
          { docId: tableId, version: table.version },
        ]);

        return {
          baseId: targetBaseId,
          tableId,
        };
      },
      {
        timeout: 600000,
      }
    );
  }

  async moveRelativeFields(sourceBaseId: string, targetBaseId: string, tableId: string) {
    const prisma = this.prismaService.txClient();

    const allRelativeFields = await prisma.field.findMany({
      where: {
        deletedTime: null,
        NOT: {
          tableId,
        },
        OR: [
          {
            lookupOptions: {
              contains: `"foreignTableId":"${tableId}"`,
            },
          },
          {
            options: {
              contains: `"foreignTableId":"${tableId}"`,
            },
          },
        ],
      },
    });

    const tableIds = [...new Set(allRelativeFields.map(({ tableId }) => tableId))];

    const baseInfo = await this.prismaService.tableMeta.findMany({
      where: {
        deletedTime: null,
        id: {
          in: tableIds,
        },
      },
      select: {
        id: true,
        baseId: true,
      },
    });

    const tableBaseIdMap = new Map(baseInfo.map(({ id, baseId }) => [id, baseId]));

    const sourceBaseRelativeFields = allRelativeFields.filter(
      ({ tableId }) => tableBaseIdMap.get(tableId) === sourceBaseId
    );

    const targetBaseRelativeFields = allRelativeFields.filter(
      ({ tableId }) => tableBaseIdMap.get(tableId) === targetBaseId
    );

    const otherBaseRelativeFields = allRelativeFields.filter(
      ({ tableId }) =>
        ![...sourceBaseRelativeFields, ...targetBaseRelativeFields]
          .map(({ tableId }) => tableId)
          .includes(tableId)
    );

    await this.updateSourceBaseRelativeFields(targetBaseId, sourceBaseRelativeFields);

    await this.updateTargetBaseRelativeFields(sourceBaseId, targetBaseRelativeFields);

    await this.updateOtherBaseRelativeFields(sourceBaseId, targetBaseId, otherBaseRelativeFields);
  }

  async updateSourceBaseRelativeFields(targetBaseId: string, fields: Field[]) {
    const prisma = this.prismaService.txClient();

    for (const field of fields) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const options = fieldInstances.options as ILinkFieldOptions;

      const newOptions = {
        ...options,
      };

      if (field.type === FieldType.Link) {
        newOptions.baseId = targetBaseId;
        await prisma.field.update({
          where: { id: field.id },
          data: {
            options: JSON.stringify(newOptions),
          },
        });
      }
    }
  }

  async updateTargetBaseRelativeFields(sourceBaseId: string, fields: Field[]) {
    const prisma = this.prismaService.txClient();

    for (const field of fields) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const options = fieldInstances.options as ILinkFieldOptions;

      const newOptions = {
        ...options,
      };

      if (field.type === FieldType.Link && newOptions.baseId === sourceBaseId) {
        delete newOptions['baseId'];

        await prisma.field.update({
          where: { id: field.id },
          data: {
            options: JSON.stringify(newOptions),
          },
        });
      }
    }
  }

  async updateOtherBaseRelativeFields(sourceBaseId: string, targetBaseId: string, fields: Field[]) {
    const prisma = this.prismaService.txClient();

    for (const field of fields) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const options = fieldInstances.options as ILinkFieldOptions;

      const newOptions = {
        ...options,
      };

      if (field.type === FieldType.Link && newOptions.baseId === sourceBaseId) {
        newOptions['baseId'] = targetBaseId;

        await prisma.field.update({
          where: { id: field.id },
          data: {
            options: JSON.stringify(newOptions),
          },
        });
      }
    }
  }

  async moveFields(sourceBaseId: string, targetBaseId: string, tableId: string) {
    const prisma = this.prismaService.txClient();

    const fields = await prisma.field.findMany({
      where: {
        deletedTime: null,
        tableId,
      },
    });

    const linkFields = fields.filter((field) => field.type === FieldType.Link && !field.isLookup);

    const lookupFields = fields.filter((field) => field.isLookup);

    const rollupFields = fields.filter(
      (field) => field.type === FieldType.Rollup && !field.isLookup
    );

    await this.moveLinkFields(sourceBaseId, targetBaseId, tableId, linkFields);

    await this.moveLookupOrRollupFields(sourceBaseId, targetBaseId, [
      ...lookupFields,
      ...rollupFields,
    ]);
  }

  async moveLinkFields(
    sourceBaseId: string,
    targetBaseId: string,
    tableId: string,
    linkFields: Field[]
  ) {
    const prisma = this.prismaService.txClient();

    const otherTables = await prisma.tableMeta.findMany({
      where: {
        deletedTime: null,
        baseId: sourceBaseId,
        NOT: {
          id: tableId,
        },
      },
      select: {
        id: true,
      },
    });

    const otherTableIds = otherTables.map(({ id }) => id);

    for (const field of linkFields) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const options = fieldInstances.options as ILinkFieldOptions;

      const newLinkOption = {
        ...options,
      };

      if (isEmpty(newLinkOption)) {
        continue;
      }

      if (newLinkOption.fkHostTableName.startsWith(`${sourceBaseId}.`)) {
        newLinkOption.fkHostTableName = newLinkOption.fkHostTableName.replace(
          `${sourceBaseId}`,
          `${targetBaseId}`
        );
      }

      if (newLinkOption.baseId === targetBaseId) {
        delete newLinkOption['baseId'];
      }

      if (!newLinkOption.baseId && otherTableIds.includes(newLinkOption.foreignTableId)) {
        newLinkOption.baseId = sourceBaseId;
      }

      await prisma.field.update({
        where: { id: field.id },
        data: {
          options: JSON.stringify(newLinkOption),
        },
      });
    }
  }

  async moveLookupOrRollupFields(
    sourceBaseId: string,
    targetBaseId: string,
    lookupFields: Field[]
  ) {
    const prisma = this.prismaService.txClient();
    for (const field of lookupFields) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const lookupOptions = fieldInstances.lookupOptions as ILinkFieldOptions;

      const newLookupOption = {
        ...lookupOptions,
      };

      if (isEmpty(newLookupOption)) {
        continue;
      }

      if (newLookupOption.fkHostTableName.startsWith(`${sourceBaseId}.`)) {
        newLookupOption.fkHostTableName = newLookupOption.fkHostTableName.replace(
          `${sourceBaseId}`,
          `${targetBaseId}`
        );
      }

      await prisma.field.update({
        where: { id: field.id },
        data: {
          lookupOptions: JSON.stringify(newLookupOption),
        },
      });
    }
  }

  async moveJunctionTable(sourceBaseId: string, targetBaseId: string, tableId: string) {
    const prisma = this.prismaService.txClient();
    const linkFieldRaws = await prisma.field.findMany({
      where: {
        deletedTime: null,
        isLookup: null,
        tableId,
        type: FieldType.Link,
      },
    });

    const linkFields = linkFieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));

    const junctionTableNames = linkFields
      .filter((linkField) => {
        const options = linkField.options as ILinkFieldOptions;
        const { fkHostTableName } = options;
        return fkHostTableName?.includes(`junction_`);
      })
      .map((linkField) => {
        const options = linkField.options as ILinkFieldOptions;
        return options.fkHostTableName;
      });

    const junctionNameSql = this.dbProvider
      .moveTableQuery(this.knex.queryBuilder())
      .getSourceBaseJunctionTableName(sourceBaseId)
      .toQuery();

    const allSourceBaseJunctionTableName =
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await prisma.$queryRawUnsafe<{ table_name: string }[]>(junctionNameSql);

    const allFullSourceBaseJunctionTableNames = this.dbProvider
      .moveTableQuery(this.knex.queryBuilder())
      .getFullSourceBaseJunctionTableNames(
        sourceBaseId,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        allSourceBaseJunctionTableName.map(({ table_name }) => table_name)
      );

    const shouldMoveJunctionTableNames = junctionTableNames.filter((junctionTableName) =>
      allFullSourceBaseJunctionTableNames.includes(junctionTableName)
    );

    for (const junctionTableName of shouldMoveJunctionTableNames) {
      const sql = this.dbProvider
        .moveTableQuery(this.knex.queryBuilder())
        .updateTableSchema(junctionTableName, targetBaseId)
        .toQuery();

      await prisma.$executeRawUnsafe(sql);
    }

    await this.updateRelativeJunctionConfig(
      sourceBaseId,
      targetBaseId,
      shouldMoveJunctionTableNames
    );
  }

  async updateRelativeJunctionConfig(
    sourceBaseId: string,
    targetBaseId: string,
    junctionTableNames: string[]
  ) {
    const prisma = this.prismaService.txClient();

    const fieldRaws = await prisma.field.findMany({
      where: {
        deletedTime: null,
        OR: [
          ...junctionTableNames.map((junctionTableName) => ({
            options: {
              contains: `"fkHostTableName":"${junctionTableName}"`,
            },
          })),
          ...junctionTableNames.map((junctionTableName) => ({
            lookupOptions: {
              contains: `"fkHostTableName":"${junctionTableName}"`,
            },
          })),
        ],
      },
    });

    for (const field of fieldRaws) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const newOptions = fieldInstances.options as ILinkFieldOptions;
      const newLookupOptions = fieldInstances.lookupOptions;

      if (newLookupOptions && junctionTableNames.includes(newLookupOptions.fkHostTableName)) {
        newLookupOptions.fkHostTableName = newLookupOptions.fkHostTableName.replace(
          `${sourceBaseId}`,
          `${targetBaseId}`
        );
      }

      if (newOptions && junctionTableNames.includes(newOptions.fkHostTableName)) {
        newOptions.fkHostTableName = newOptions.fkHostTableName.replace(
          `${sourceBaseId}`,
          `${targetBaseId}`
        );
      }

      await prisma.field.update({
        where: { id: field.id },
        data: {
          options: JSON.stringify(newOptions),
          lookupOptions: newLookupOptions ? JSON.stringify(newLookupOptions) : undefined,
        },
      });
    }
  }

  async moveRelativeTableConfig(sourceDbTableName: string, targetDbTableName: string) {
    const prisma = this.prismaService.txClient();

    const fieldRaws = await prisma.field.findMany({
      where: {
        deletedTime: null,
        OR: [
          {
            options: {
              contains: `"fkHostTableName":"${sourceDbTableName}"`,
            },
          },
          {
            lookupOptions: {
              contains: `"fkHostTableName":"${sourceDbTableName}"`,
            },
          },
        ],
      },
    });

    for (const field of fieldRaws) {
      const fieldInstances = createFieldInstanceByRaw(field);

      const newOptions = fieldInstances.options as ILinkFieldOptions;
      const newLookupOptions = fieldInstances.lookupOptions;

      if (newOptions && newOptions.fkHostTableName === sourceDbTableName) {
        newOptions.fkHostTableName = targetDbTableName;
      }

      if (newLookupOptions && newLookupOptions.fkHostTableName === sourceDbTableName) {
        newLookupOptions.fkHostTableName = targetDbTableName;
      }

      await prisma.field.update({
        where: { id: field.id },
        data: {
          options: JSON.stringify(newOptions),
          lookupOptions: newLookupOptions ? JSON.stringify(newLookupOptions) : undefined,
        },
      });
    }
  }

  async moveTablePlugins(sourceBaseId: string, targetBaseId: string, tableId: string) {
    await this.movePluginPanel(targetBaseId, tableId);
    await this.movePluginContextMenu(targetBaseId, tableId);
    await this.movePluginCollaborator(sourceBaseId, targetBaseId);
  }

  async movePluginPanel(targetBaseId: string, tableId: string) {
    const prisma = this.prismaService.txClient();

    const panelPlugins = await prisma.pluginPanel.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
      },
    });

    const panelPluginIds = panelPlugins.map(({ id }) => id);

    await prisma.pluginInstall.updateMany({
      where: {
        positionId: {
          in: panelPluginIds,
        },
      },
      data: {
        baseId: targetBaseId,
      },
    });
  }

  async movePluginContextMenu(targetBaseId: string, tableId: string) {
    const prisma = this.prismaService.txClient();

    const contextMenuPlugins = await prisma.pluginContextMenu.findMany({
      where: {
        tableId,
      },
      select: {
        pluginInstallId: true,
      },
    });

    const pluginInstallIds = contextMenuPlugins.map(({ pluginInstallId }) => pluginInstallId);

    await prisma.pluginInstall.updateMany({
      where: {
        id: {
          in: pluginInstallIds,
        },
      },
      data: {
        baseId: targetBaseId,
      },
    });
  }

  async movePluginCollaborator(sourceBaseId: string, targetBaseId: string) {
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');

    const pluginUsers = await prisma.plugin.findMany({
      where: {
        NOT: {
          pluginUser: null,
        },
      },
      select: {
        pluginUser: true,
      },
    });

    const pluginUserIds = pluginUsers
      .map((item) => item.pluginUser)
      .filter((userId): userId is string => userId !== null);

    if (pluginUserIds.length === 0) {
      return;
    }

    const sourcePluginCollaborators = await prisma.collaborator.findMany({
      where: {
        resourceId: sourceBaseId,
        principalId: {
          in: pluginUserIds,
        },
      },
    });

    const targetPluginCollaborators = await prisma.collaborator.findMany({
      where: {
        resourceId: targetBaseId,
        principalId: {
          in: pluginUserIds,
        },
      },
    });

    const diffCollaborators = differenceBy(
      sourcePluginCollaborators,
      targetPluginCollaborators,
      'principalId'
    ).map((collaborator) =>
      omit(collaborator, [
        'id',
        'createdTime',
        'createdBy',
        'lastModifiedBy',
        'lastModifiedTime',
        'resourceId',
      ])
    );

    await prisma.collaborator.createMany({
      data: diffCollaborators.map((collaborator) => ({
        ...collaborator,
        resourceId: targetBaseId,
        createdBy: userId,
      })),
    });
  }
}
