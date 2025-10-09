import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  FieldOpBuilder,
  HttpErrorCode,
  IdPrefix,
  OpName,
  checkFieldUniqueValidationEnabled,
  checkFieldValidationEnabled,
  FieldType,
  isLinkLookupOptions,
} from '@teable/core';
import type {
  IFieldVo,
  IGetFieldsQuery,
  ISnapshotBase,
  ISetFieldPropertyOpContext,
  ILookupOptionsVo,
  IOtOperation,
  ViewType,
  FormulaFieldCore,
} from '@teable/core';
import type { Field as RawField, Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { keyBy, sortBy, omit } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DropColumnOperationType } from '../../db-provider/drop-database-column-query/drop-database-column-field-visitor.interface';
import type { IReadonlyAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';

import { handleDBValidationErrors } from '../../utils/db-validation-error';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { BatchService } from '../calculation/batch.service';

import { TableDomainQueryService } from '../table-domain/table-domain-query.service';
import { FormulaFieldService } from './field-calculate/formula-field.service';
import { LinkFieldQueryService } from './field-calculate/link-field-query.service';

import type { IFieldInstance } from './model/factory';
import {
  createFieldInstanceByVo,
  createFieldInstanceByRaw,
  rawField2FieldObj,
  applyFieldPropertyOpsAndCreateInstance,
} from './model/factory';
import type { FormulaFieldDto } from './model/field-dto/formula-field.dto';

type IOpContext = ISetFieldPropertyOpContext;

@Injectable()
export class FieldService implements IReadonlyAdapterService {
  private logger = new Logger(FieldService.name);
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,

    private readonly formulaFieldService: FormulaFieldService,
    private readonly linkFieldQueryService: LinkFieldQueryService,
    private readonly tableDomainQueryService: TableDomainQueryService
  ) {}

  async generateDbFieldName(tableId: string, name: string): Promise<string> {
    let dbFieldName = convertNameToValidCharacter(name, 40);

    const query = this.dbProvider.columnInfo(await this.getDbTableName(tableId));
    const columns = await this.prismaService.txClient().$queryRawUnsafe<{ name: string }[]>(query);
    // fallback logic
    if (columns.some((column) => column.name === dbFieldName)) {
      dbFieldName += new Date().getTime();
    }
    return dbFieldName;
  }

  async generateDbFieldNames(tableId: string, names: string[]) {
    const query = this.dbProvider.columnInfo(await this.getDbTableName(tableId));
    const columns = await this.prismaService.txClient().$queryRawUnsafe<{ name: string }[]>(query);
    return names
      .map((name) => convertNameToValidCharacter(name, 40))
      .map((dbFieldName) => {
        if (columns.some((column) => column.name === dbFieldName)) {
          const newDbFieldName = dbFieldName + new Date().getTime();
          columns.push({ name: newDbFieldName });
          return (dbFieldName += new Date().getTime());
        }
        columns.push({ name: dbFieldName });
        return dbFieldName;
      });
  }

  private async dbCreateField(tableId: string, fieldInstance: IFieldInstance) {
    const userId = this.cls.get('user.id');
    const {
      id,
      name,
      dbFieldName,
      description,
      type,
      options,
      meta,
      aiConfig,
      lookupOptions,
      notNull,
      unique,
      isPrimary,
      isComputed,
      hasError,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
      isLookup,
      isConditionalLookup,
    } = fieldInstance;

    const agg = await this.prismaService.txClient().field.aggregate({
      where: { tableId, deletedTime: null },
      _max: {
        order: true,
      },
    });
    const order = agg._max.order == null ? 0 : agg._max.order + 1;
    const data: Prisma.FieldCreateInput = {
      id,
      table: {
        connect: {
          id: tableId,
        },
      },
      name,
      description,
      type,
      aiConfig: aiConfig && JSON.stringify(aiConfig),
      options: JSON.stringify(options),
      meta: meta && JSON.stringify(meta),
      notNull,
      unique,
      isPrimary,
      order,
      version: 1,
      isComputed,
      isLookup,
      hasError,
      // add lookupLinkedFieldId for indexing
      lookupLinkedFieldId:
        lookupOptions && isLinkLookupOptions(lookupOptions) ? lookupOptions.linkFieldId : undefined,
      lookupOptions: lookupOptions && JSON.stringify(lookupOptions),
      dbFieldName,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
      isConditionalLookup,
      createdBy: userId,
    };

    return this.prismaService.txClient().field.upsert({
      where: { id: data.id },
      create: data,
      update: { ...data, deletedTime: null, version: undefined },
    });
  }

  private async dbCreateFields(tableId: string, fieldInstances: IFieldInstance[]) {
    const userId = this.cls.get('user.id');
    const agg = await this.prismaService.txClient().field.aggregate({
      where: { tableId, deletedTime: null },
      _max: {
        order: true,
      },
    });
    const order = agg._max.order == null ? 0 : agg._max.order + 1;
    const existedFieldIds = (
      await this.prismaService.txClient().field.findMany({
        where: { tableId, deletedTime: null },
        select: { id: true },
      })
    ).map(({ id }) => id);
    const data: Prisma.FieldCreateManyInput[] = fieldInstances
      .filter(({ id }) => !existedFieldIds.includes(id))
      .map(
        (
          {
            id,
            name,
            dbFieldName,
            description,
            type,
            options,
            lookupOptions,
            notNull,
            unique,
            isPrimary,
            isComputed,
            hasError,
            dbFieldType,
            cellValueType,
            isMultipleCellValue,
            isLookup,
            isConditionalLookup,
            meta,
          },
          index
        ) => ({
          id,
          name,
          description,
          type,
          options: JSON.stringify(options),
          notNull,
          unique,
          isPrimary,
          order: order + index,
          version: 1,
          isComputed,
          isLookup,
          isConditionalLookup,
          hasError,
          // add lookupLinkedFieldId for indexing
          lookupLinkedFieldId:
            lookupOptions && isLinkLookupOptions(lookupOptions)
              ? lookupOptions.linkFieldId
              : undefined,
          lookupOptions: lookupOptions && JSON.stringify(lookupOptions),
          dbFieldName,
          dbFieldType,
          cellValueType,
          isMultipleCellValue,
          createdBy: userId,
          meta: meta ? JSON.stringify(meta) : undefined,
          tableId,
        })
      );

    return this.prismaService.txClient().field.createMany({
      data: data,
    });
  }

  async dbCreateMultipleField(tableId: string, fieldInstances: IFieldInstance[]) {
    const multiFieldData: RawField[] = [];

    for (let i = 0; i < fieldInstances.length; i++) {
      const fieldInstance = fieldInstances[i];
      const fieldData = await this.dbCreateField(tableId, fieldInstance);

      multiFieldData.push(fieldData);
    }
    return multiFieldData;
  }

  async dbCreateMultipleFields(tableId: string, fieldInstances: IFieldInstance[]) {
    return await this.dbCreateFields(tableId, fieldInstances);
  }

  private async alterTableAddField(
    dbTableName: string,
    fieldInstances: IFieldInstance[],
    isNewTable: boolean = false,
    isSymmetricField?: boolean
  ) {
    // Get table ID from dbTableName for field map construction
    const tableMeta = await this.prismaService.txClient().tableMeta.findFirst({
      where: { dbTableName },
      select: { id: true },
    });

    if (!tableMeta) {
      throw new NotFoundException(`Table not found: ${dbTableName}`);
    }
    const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableMeta.id);

    for (const fieldInstance of fieldInstances) {
      const { dbFieldName, type, isLookup, unique, notNull, id: fieldId, name } = fieldInstance;

      // Early validation: creating a field with NOT NULL is not allowed
      // Do this before generating/issuing any SQL to avoid DB-level 23502 errors
      if (notNull) {
        throw new BadRequestException(
          `Field type "${type}" does not support field validation when creating a new field`
        );
      }

      // Build table name map for all field operations
      const tableNameMap = await this.linkFieldQueryService.getTableNameMapForLinkFields(
        tableMeta.id,
        [fieldInstance]
      );

      const alterTableQueries = this.dbProvider.createColumnSchema(
        dbTableName,
        fieldInstance,
        tableDomain,
        isNewTable,
        tableMeta.id,
        tableNameMap,
        isSymmetricField,
        false
      );

      // Execute all queries (main table alteration + any additional queries like junction tables)
      for (const query of alterTableQueries) {
        await this.prismaService.txClient().$executeRawUnsafe(query);
      }

      if (unique) {
        if (!checkFieldUniqueValidationEnabled(type, isLookup)) {
          throw new CustomHttpException(
            `Field ${name}[${fieldId}] does not support field value unique validation`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.field.uniqueUnsupportedType',
                context: { name, fieldId },
              },
            }
          );
        }

        const fieldValidationQuery = this.knex.schema
          .alterTable(dbTableName, (table) => {
            table.unique([dbFieldName], {
              indexName: this.getFieldUniqueKeyName(dbTableName, dbFieldName, fieldId),
            });
          })
          .toQuery();
        await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
      }

      if (notNull) {
        throw new CustomHttpException(
          `Field ${name}[${fieldId}] does not support not null validation when creating a new field`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.field.notNullValidationWhenCreateField',
              context: { name, fieldId },
            },
          }
        );
      }
    }
  }

  async alterTableDeleteField(
    dbTableName: string,
    fieldInstances: IFieldInstance[],
    operationType: DropColumnOperationType = DropColumnOperationType.DELETE_FIELD
  ) {
    // Get table ID from dbTableName
    const tableId = await this.linkFieldQueryService.getTableIdFromDbTableName(dbTableName);
    if (!tableId) {
      throw new Error(`Table not found for dbTableName: ${dbTableName}`);
    }

    // Build table name map for all related tables
    const tableNameMap = await this.linkFieldQueryService.getTableNameMapForLinkFields(
      tableId,
      fieldInstances
    );

    for (const fieldInstance of fieldInstances) {
      // Only pass link context for link fields
      const linkContext =
        fieldInstance.type === FieldType.Link && !fieldInstance.isLookup
          ? { tableId, tableNameMap }
          : undefined;

      const alterTableSql = this.dbProvider.dropColumn(
        dbTableName,
        fieldInstance,
        linkContext,
        operationType
      );

      for (const alterTableQuery of alterTableSql) {
        await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
      }
    }
  }

  private async alterTableModifyFieldName(fieldId: string, newDbFieldName: string) {
    const { dbFieldName, table } = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
      select: {
        dbFieldName: true,
        type: true,
        isLookup: true,
        table: { select: { id: true, dbTableName: true } },
      },
    });

    const existingField = await this.prismaService.txClient().field.findFirst({
      where: { tableId: table.id, dbFieldName: newDbFieldName, deletedTime: null },
      select: { id: true },
    });

    if (existingField) {
      throw new CustomHttpException(
        `Db Field name ${newDbFieldName} already exists in this table`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.dbFieldNameAlreadyExists',
            context: { dbFieldName: newDbFieldName },
          },
        }
      );
    }

    // Physically rename the underlying column for all field types, including non-lookup Link fields.
    // Link fields in Teable maintain a persisted display column on the host table; skipping
    // the physical rename causes mismatches during computed updates (e.g., UPDATE ... FROM ...).
    const columnInfoQuery = this.dbProvider.columnInfo(table.dbTableName);
    const columns = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);
    const columnNames = new Set(columns.map((column) => column.name));

    if (columnNames.has(newDbFieldName)) {
      // Column already renamed (e.g. modifyColumnSchema recreated it with the new name)
      return;
    }

    if (!columnNames.has(dbFieldName)) {
      // Nothing left to rename—likely dropped during type conversion before this step ran
      this.logger.debug(
        `Skip renaming column for field ${fieldId} (${table.dbTableName}): ` +
          `missing source column ${dbFieldName}`
      );
      return;
    }

    const alterTableSql = this.dbProvider.renameColumn(
      table.dbTableName,
      dbFieldName,
      newDbFieldName
    );

    for (const alterTableQuery of alterTableSql) {
      await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
    }
  }

  private async alterTableModifyFieldType(
    fieldId: string,
    oldField: IFieldInstance,
    newField: IFieldInstance
  ) {
    const {
      dbFieldName,
      name: fieldName,
      table,
      tableId,
    } = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
      select: {
        dbFieldName: true,
        name: true,
        tableId: true,
        table: { select: { dbTableName: true, name: true } },
      },
    });

    const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableId);
    tableDomain.updateField(fieldId, newField);

    const dbTableName = table.dbTableName;

    // Build table name map for link field operations
    const tableNameMap = await this.linkFieldQueryService.getTableNameMapForLinkFields(tableId, [
      oldField,
      newField,
    ]);

    // TODO: move to field visitor
    let resetFieldQuery: string | undefined = '';
    function shouldUpdateRecords(field: IFieldInstance) {
      return !field.isComputed && field.type !== FieldType.Link;
    }
    if (shouldUpdateRecords(oldField) && shouldUpdateRecords(newField)) {
      resetFieldQuery = this.knex(dbTableName)
        .update({ [dbFieldName]: null })
        .toQuery();
    }

    // Check if we need link context
    const needsLinkContext =
      (oldField.type === FieldType.Link && !oldField.isLookup) ||
      (newField.type === FieldType.Link && !newField.isLookup);

    const linkContext = needsLinkContext ? { tableId, tableNameMap } : undefined;

    // Use the new modifyColumnSchema method with visitor pattern
    const modifyColumnSql = this.dbProvider.modifyColumnSchema(
      dbTableName,
      oldField,
      newField,
      tableDomain,
      linkContext
    );

    await handleDBValidationErrors({
      fn: async () => {
        if (resetFieldQuery) {
          await this.prismaService.txClient().$executeRawUnsafe(resetFieldQuery);
        }

        for (const alterTableQuery of modifyColumnSql) {
          await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
        }
      },
      handleUniqueError: () => {
        throw new CustomHttpException(
          `Field ${fieldId} unique validation failed`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.custom.fieldValueDuplicate',
              context: { tableName: table.name, fieldName },
            },
          }
        );
      },
      handleNotNullError: () => {
        throw new CustomHttpException(
          `Field ${fieldId} not null validation failed`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.custom.fieldValueNotNull',
              context: { tableName: table.name, fieldName },
            },
          }
        );
      },
    });
  }

  async findUniqueIndexesForField(dbTableName: string, dbFieldName: string) {
    const indexesQuery = this.dbProvider.getTableIndexes(dbTableName);
    const indexes = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ name: string; columns: string; isUnique: boolean }[]>(indexesQuery);

    return indexes
      .filter((index) => {
        const { columns, isUnique } = index;
        const columnsArray = JSON.parse(columns) as string[];
        return isUnique && columnsArray.includes(dbFieldName);
      })
      .map((index) => index.name);
  }

  private async alterTableModifyFieldValidation(
    fieldId: string,
    key: 'unique' | 'notNull',
    newValue?: boolean
  ) {
    const { name, dbFieldName, table, type, isLookup } = await this.prismaService
      .txClient()
      .field.findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
        select: {
          name: true,
          dbFieldName: true,
          type: true,
          isLookup: true,
          table: { select: { dbTableName: true, name: true } },
        },
      });

    if (!checkFieldValidationEnabled(type as FieldType, isLookup)) {
      throw new CustomHttpException(
        `Field ${name}[${fieldId}] field validation error`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.fieldValidationError',
            context: { name, fieldId },
          },
        }
      );
    }

    const dbTableName = table.dbTableName;
    const matchedIndexes = await this.findUniqueIndexesForField(dbTableName, dbFieldName);

    const fieldValidationSqls = this.knex.schema
      .alterTable(dbTableName, (table) => {
        if (key === 'unique') {
          newValue
            ? table.unique([dbFieldName], {
                indexName: this.getFieldUniqueKeyName(dbTableName, dbFieldName, fieldId),
              })
            : matchedIndexes.forEach((indexName) => table.dropUnique([dbFieldName], indexName));
        }

        // TODO: add to db provider
        if (key === 'notNull' && type !== FieldType.Link) {
          newValue ? table.dropNullable(dbFieldName) : table.setNullable(dbFieldName);
        }
      })
      .toSQL();

    const executeSqls = fieldValidationSqls
      .filter((s) => !s.sql.startsWith('PRAGMA'))
      .map(({ sql }) => sql);

    await handleDBValidationErrors({
      fn: () => {
        return Promise.all(
          executeSqls.map((sql) => this.prismaService.txClient().$executeRawUnsafe(sql))
        );
      },
      handleUniqueError: () => {
        throw new CustomHttpException(
          `Field ${fieldId} unique validation failed`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.custom.fieldValueDuplicate',
              context: { tableName: table.name, fieldName: name },
            },
          }
        );
      },
      handleNotNullError: () => {
        throw new CustomHttpException(
          `Field ${fieldId} not null validation failed`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.custom.fieldValueNotNull',
              context: { tableName: table.name, fieldName: name },
            },
          }
        );
      },
    });
  }

  async getField(tableId: string, fieldId: string): Promise<IFieldVo> {
    const field = await this.prismaService.txClient().field.findFirst({
      where: { id: fieldId, tableId, deletedTime: null },
    });
    if (!field) {
      throw new CustomHttpException(
        `Field ${fieldId} not found in table ${tableId}`,
        HttpErrorCode.NOT_FOUND,
        {
          localization: {
            i18nKey: 'httpErrors.field.fieldNotFoundInTable',
            context: { tableId, fieldId },
          },
        }
      );
    }
    const fieldVo = rawField2FieldObj(field);
    // Filter out meta field to prevent it from being sent to frontend
    return omit(fieldVo, ['meta']) as IFieldVo;
  }

  async getFieldsByQuery(tableId: string, query?: IGetFieldsQuery): Promise<IFieldVo[]> {
    const fieldsPlain = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      orderBy: [
        {
          isPrimary: {
            sort: 'asc',
            nulls: 'last',
          },
        },
        {
          order: 'asc',
        },
        {
          createdTime: 'asc',
        },
      ],
    });

    let result = fieldsPlain.map(rawField2FieldObj);

    // filter by projection
    if (query?.projection) {
      const fieldIds = query.projection;
      const fieldMap = keyBy(result, 'id');
      result = fieldIds.map((fieldId) => fieldMap[fieldId]).filter(Boolean);
    }

    /**
     * filter by query
     * filterHidden depends on viewId so only judge viewId
     */
    if (query?.viewId) {
      const { viewId } = query;
      const curView = await this.prismaService.txClient().view.findFirst({
        where: { id: viewId, deletedTime: null },
        select: { id: true, type: true, options: true, columnMeta: true },
      });
      if (!curView) {
        throw new CustomHttpException(`View ${viewId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.view.viewNotFound',
            context: { viewId },
          },
        });
      }
      const view = {
        id: viewId,
        type: curView.type as ViewType,
        options: curView.options ? JSON.parse(curView.options) : curView.options,
        columnMeta: curView?.columnMeta ? JSON.parse(curView?.columnMeta) : curView?.columnMeta,
      };
      if (query?.filterHidden) {
        result = result.filter((field) => isNotHiddenField(field.id, view));
      }
      return sortBy(result, (field) => {
        return view?.columnMeta?.[field?.id]?.order;
      });
    }

    // Filter out meta field to prevent it from being sent to frontend
    return result.map((field) => omit(field, ['meta']) as IFieldVo);
  }

  async getFieldInstances(tableId: string, query: IGetFieldsQuery): Promise<IFieldInstance[]> {
    const fields = await this.getFieldsByQuery(tableId, query);
    return fields.map((field) => createFieldInstanceByVo(field));
  }

  async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async resolvePending(tableId: string, fieldIds: string[]) {
    await this.batchUpdateFields(
      tableId,
      fieldIds.map((fieldId) => ({
        fieldId,
        ops: [
          FieldOpBuilder.editor.setFieldProperty.build({
            key: 'isPending',
            newValue: null,
            oldValue: true,
          }),
        ],
      }))
    );
  }

  async markError(tableId: string, fieldIds: string[], hasError: boolean) {
    await this.batchUpdateFields(
      tableId,
      fieldIds.map((fieldId) => ({
        fieldId,
        ops: [
          FieldOpBuilder.editor.setFieldProperty.build({
            key: 'hasError',
            newValue: hasError ? true : null,
            oldValue: hasError ? null : true,
          }),
        ],
      }))
    );
  }

  /**
   * After restoring base fields (e.g., via undo), repair dependent formula fields:
   * - If dependencies are incomplete, keep hasError=true and skip DB column creation
   * - If dependencies are complete and formula is persisted as a generated column,
   *   recreate the underlying generated column via modifyColumnSchema
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async recreateDependentFormulaColumns(tableId: string, fieldIds: string[]) {
    if (!fieldIds?.length) return;

    const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableId);

    for (const sourceFieldId of fieldIds) {
      try {
        const deps = await this.formulaFieldService.getDependentFormulaFieldsInOrder(sourceFieldId);
        if (!deps.length) continue;

        for (const { id: formulaFieldId, tableId: formulaTableId } of deps) {
          if (formulaTableId !== tableId) continue;

          const formulaRaw = await this.prismaService.txClient().field.findUnique({
            where: { id: formulaFieldId, tableId: formulaTableId, deletedTime: null },
          });
          if (!formulaRaw) continue;

          const formulaField = createFieldInstanceByRaw(formulaRaw);
          if (formulaField.type !== FieldType.Formula) continue;

          const formulaCore = formulaField as FormulaFieldDto;
          const referencedIds = formulaCore.getReferenceFieldIds();
          if (referencedIds.length) {
            const existing = await this.prismaService.txClient().field.findMany({
              where: { id: { in: referencedIds }, deletedTime: null },
              select: { id: true },
            });
            const allPresent = existing.length === referencedIds.length;
            if (!allPresent) {
              await this.markError(formulaTableId, [formulaFieldId], true);
              continue;
            }
          }

          // Dependencies satisfied: clear error
          await this.markError(formulaTableId, [formulaFieldId], false);

          // If not persisted as generated column, nothing to recreate at DB level
          if (!formulaCore.getIsPersistedAsGeneratedColumn()) continue;

          // Recalculate types and recreate generated column
          const fieldMap = tableDomain.fields.toFieldMap();
          formulaCore.recalculateFieldTypes(Object.fromEntries(fieldMap));

          const tableMeta = await this.prismaService.txClient().tableMeta.findUnique({
            where: { id: formulaTableId },
            select: { dbTableName: true },
          });
          if (!tableMeta) continue;

          const sqls = this.dbProvider.modifyColumnSchema(
            tableMeta.dbTableName,
            formulaCore,
            formulaCore,
            tableDomain
          );
          for (const sql of sqls) {
            await this.prismaService.txClient().$executeRawUnsafe(sql);
          }
        }
      } catch (e) {
        this.logger.warn(
          `Failed to recreate dependent formulas for ${sourceFieldId}: ${String(e)}`
        );
      }
    }
  }

  private async checkFieldName(tableId: string, fieldId: string, name: string) {
    const fieldRaw = await this.prismaService.txClient().field.findFirst({
      where: { tableId, id: { not: fieldId }, name, deletedTime: null },
      select: { id: true },
    });

    if (fieldRaw) {
      throw new CustomHttpException(
        `Field name ${name} already exists in this table`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.fieldNameAlreadyExists',
            context: { name },
          },
        }
      );
    }
  }

  async batchUpdateFields(tableId: string, opData: { fieldId: string; ops: IOtOperation[] }[]) {
    if (!opData.length) return;

    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: opData.map((data) => data.fieldId) }, deletedTime: null },
    });
    const dbTableName = await this.getDbTableName(tableId);

    const fields = fieldRaw.map(createFieldInstanceByRaw);
    const fieldsRawMap = keyBy(fieldRaw, 'id');
    const fieldMap = new Map(fields.map((field) => [field.id, field]));

    for (const { fieldId, ops } of opData) {
      const field = fieldMap.get(fieldId);
      if (!field) {
        continue;
      }
      const opContext = ops.map((op) => {
        const ctx = FieldOpBuilder.detect(op);
        if (!ctx) {
          throw new CustomHttpException('unknown field editing op', HttpErrorCode.VALIDATION_ERROR);
        }
        return ctx as IOpContext;
      });

      const nameCtx = opContext.find((ctx) => ctx.key === 'name');
      if (nameCtx) {
        await this.checkFieldName(tableId, fieldId, nameCtx.newValue as string);
      }

      await this.update(fieldsRawMap[fieldId].version + 1, tableId, dbTableName, field, opContext);
    }

    const dataList = opData.map((data) => ({
      docId: data.fieldId,
      version: fieldsRawMap[data.fieldId].version,
      data: data.ops,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.Field, dataList);
  }

  async batchDeleteFields(
    tableId: string,
    fieldIds: string[],
    operationType: DropColumnOperationType = DropColumnOperationType.DELETE_FIELD
  ) {
    if (!fieldIds.length) return;

    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: fieldIds }, deletedTime: null },
      select: { id: true, version: true },
    });

    if (fieldRaw.length !== fieldIds.length) {
      throw new CustomHttpException(
        `delete fields ${fieldIds.join(',')} not found in table ${tableId}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.deleteFieldsNotFound',
            context: { tableId, fieldIds },
          },
        }
      );
    }

    const fieldRawMap = keyBy(fieldRaw, 'id');

    const dataList = fieldIds.map((fieldId) => ({
      docId: fieldId,
      version: fieldRawMap[fieldId].version,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Del, IdPrefix.Field, dataList);

    await this.deleteMany(
      tableId,
      dataList.map((d) => ({ ...d, version: d.version + 1 })),
      operationType
    );
  }

  async batchCreateFields(
    tableId: string,
    dbTableName: string,
    fields: IFieldInstance[],
    isSymmetricField?: boolean
  ) {
    if (!fields.length) return;

    const dataList = fields.map((field) => {
      const snapshot = instanceToPlain(field, { excludePrefixes: ['_'] }) as IFieldVo;
      return {
        docId: field.id,
        version: 0,
        data: snapshot,
      };
    });

    // 1. alter table with real field in visual table
    await this.alterTableAddField(dbTableName, fields, false, isSymmetricField);

    // 2. save field meta in db
    await this.dbCreateMultipleField(tableId, fields);

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.Field, dataList);
  }

  // write field at once database operation
  async batchCreateFieldsAtOnce(tableId: string, dbTableName: string, fields: IFieldInstance[]) {
    if (!fields.length) return;

    const dataList = fields.map((field) => {
      const snapshot = instanceToPlain(field, { excludePrefixes: ['_'] }) as IFieldVo;
      return {
        docId: field.id,
        version: 0,
        data: snapshot,
      };
    });

    // 1. alter table with real field in visual table
    await this.alterTableAddField(dbTableName, fields, true); // This is new table creation

    // 2. save field meta in db
    await this.dbCreateMultipleFields(tableId, fields);

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.Field, dataList);
  }

  async create(tableId: string, snapshot: IFieldVo) {
    const fieldInstance = createFieldInstanceByVo(snapshot);
    const dbTableName = await this.getDbTableName(tableId);

    // 1. alter table with real field in visual table
    await this.alterTableAddField(dbTableName, [fieldInstance]);

    // 2. save field meta in db
    await this.dbCreateMultipleField(tableId, [fieldInstance]);
  }

  private async deleteMany(
    tableId: string,
    fieldData: { docId: string; version: number }[],
    operationType: DropColumnOperationType = DropColumnOperationType.DELETE_FIELD
  ) {
    const userId = this.cls.get('user.id');

    for (const data of fieldData) {
      const { docId: id, version } = data;
      await this.prismaService.txClient().field.update({
        where: { id: id },
        data: { deletedTime: new Date(), lastModifiedBy: userId, version },
      });
    }
    const dbTableName = await this.getDbTableName(tableId);
    const fieldIds = fieldData.map((data) => data.docId);
    const fieldsRaw = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds } },
    });
    const fieldInstances = fieldsRaw.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    await this.alterTableDeleteField(dbTableName, fieldInstances, operationType);
  }

  async del(version: number, tableId: string, fieldId: string) {
    await this.deleteMany(tableId, [{ docId: fieldId, version }]);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async handleFieldProperty(
    tableId: string,
    dbTableName: string,
    fieldId: string,
    oldField: IFieldInstance,
    newField: IFieldInstance,
    opContext: IOpContext
  ) {
    const { key, newValue } = opContext as ISetFieldPropertyOpContext;

    if (key === 'type') {
      await this.handleFieldTypeChange(tableId, dbTableName, oldField, newField);
    }

    if (key === 'options') {
      if (!newValue) {
        throw new CustomHttpException('field options is required', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'editor.error.optionsRequired',
          },
        });
      }

      // Only handle formula update here for options-only changes.
      // When converting type (e.g., Text -> Formula), handleFieldTypeChange above
      // already reconciles the physical schema. Running it again here would
      // attempt to drop the old column twice and cause: no such column: `...`.
      if (oldField.type === FieldType.Formula && newField.type === FieldType.Formula) {
        // Check if this is a formula field options update that affects generated columns
        await this.handleFormulaUpdate(tableId, dbTableName, oldField, newField);
      }

      return { options: JSON.stringify(newValue) };
    }

    if (key === 'aiConfig') {
      return {
        aiConfig: newValue ? JSON.stringify(newValue) : null,
      };
    }

    if (key === 'meta') {
      return {
        meta: newValue ? JSON.stringify(newValue) : null,
      } as Prisma.FieldUpdateInput;
    }

    if (key === 'lookupOptions') {
      return {
        lookupOptions: newValue ? JSON.stringify(newValue) : null,
        // update lookupLinkedFieldId for indexing
        lookupLinkedFieldId: (() => {
          const nextOptions = newValue as ILookupOptionsVo | null;
          return nextOptions && isLinkLookupOptions(nextOptions) ? nextOptions.linkFieldId : null;
        })(),
      };
    }

    if (key === 'dbFieldType') {
      await this.alterTableModifyFieldType(fieldId, oldField, newField);
    }

    if (key === 'dbFieldName') {
      await this.alterTableModifyFieldName(fieldId, newValue as string);
    }

    if (key === 'unique' || key === 'notNull') {
      await this.alterTableModifyFieldValidation(fieldId, key, newValue as boolean | undefined);
    }

    return { [key]: newValue ?? null };
  }

  private async updateStrategies(
    fieldId: string,
    tableId: string,
    dbTableName: string,
    oldField: IFieldInstance,
    newField: IFieldInstance,
    opContext: IOpContext
  ) {
    const opHandlers = {
      [OpName.SetFieldProperty]: this.handleFieldProperty.bind(this),
    };

    const handler = opHandlers[opContext.name];

    if (!handler) {
      throw new CustomHttpException(
        `Unknown context ${opContext.name} for field update`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    return handler.constructor.name === 'AsyncFunction'
      ? await handler(tableId, dbTableName, fieldId, oldField, newField, opContext)
      : handler(tableId, dbTableName, fieldId, oldField, newField, opContext);
  }

  async update(
    version: number,
    tableId: string,
    dbTableName: string,
    oldField: IFieldInstance,
    opContexts: IOpContext[]
  ) {
    const fieldId = oldField.id;
    const newField = applyFieldPropertyOpsAndCreateInstance(oldField, opContexts);
    const userId = this.cls.get('user.id');
    // Build result incrementally; set meta after applying update strategies
    const result: Prisma.FieldUpdateInput = {
      version,
      lastModifiedBy: userId,
    };
    for (const opContext of opContexts) {
      const updatedResult = await this.updateStrategies(
        fieldId,
        tableId,
        dbTableName,
        oldField,
        newField,
        opContext
      );
      Object.assign(result, updatedResult);
    }

    // Persist meta after potential schema modifications that may set it (e.g., formula generated columns)
    if (newField.meta !== undefined) {
      result.meta = JSON.stringify(newField.meta);
    }

    await this.prismaService.txClient().field.update({
      where: { id: fieldId, tableId },
      data: result,
    });

    // Handle dependent formula fields after field update
    await this.handleDependentFormulaFields(tableId, newField, opContexts);
  }

  async getSnapshotBulk(tableId: string, ids: string[]): Promise<ISnapshotBase<IFieldVo>[]> {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: ids } },
    });
    const fields = fieldRaws.map((field) => rawField2FieldObj(field));

    return fieldRaws
      .map((fieldRaw, i) => {
        return {
          id: fieldRaw.id,
          v: fieldRaw.version,
          type: 'json0',
          // Filter out meta field to prevent it from being sent to frontend
          data: omit(fields[i], ['meta']) as IFieldVo,
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  async getDocIdsByQuery(tableId: string, query: IGetFieldsQuery) {
    const result = await this.getFieldsByQuery(tableId, query);
    return {
      ids: result.map((field) => field.id),
    };
  }

  getFieldUniqueKeyName(dbTableName: string, dbFieldName: string, fieldId: string) {
    const [schema, tableName] = this.dbProvider.splitTableName(dbTableName);
    // unique key suffix
    const uniqueKeySuffix = `___${fieldId}_unique`;
    const uniqueKeyPrefix = `${schema}_${tableName}`.slice(0, 63 - uniqueKeySuffix.length);
    return `${uniqueKeyPrefix.toLowerCase()}${uniqueKeySuffix.toLowerCase()}`;
  }

  private async handleFieldTypeChange(
    tableId: string,
    dbTableName: string,
    oldField: IFieldInstance,
    newField: IFieldInstance
  ) {
    if (oldField.type === newField.type) {
      return;
    }
    // If either side is Formula, we must reconcile the physical schema using modifyColumnSchema.
    // This ensures that converting to Formula creates generated columns (or proper projection),
    // and converting back from Formula recreates the original physical column.
    if (oldField.type === FieldType.Formula || newField.type === FieldType.Formula) {
      const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableId);
      const modifyColumnSql = this.dbProvider.modifyColumnSchema(
        dbTableName,
        oldField,
        newField,
        tableDomain
      );
      for (const sql of modifyColumnSql) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
      return;
    }

    await this.handleFormulaUpdate(tableId, dbTableName, oldField, newField);
  }

  /**
   * Handle formula field options update that may affect generated columns
   */
  private async handleFormulaUpdate(
    tableId: string,
    dbTableName: string,
    oldField: IFieldInstance,
    newField: IFieldInstance
  ): Promise<void> {
    if (newField.type !== FieldType.Formula) {
      return;
    }

    // Build field map for formula conversion context
    // Note: We need to rebuild the field map after the current field update
    // to ensure dependent formula fields use the latest field information
    const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableId);

    // Use modifyColumnSchema to recreate the field with updated options
    const modifyColumnSql = this.dbProvider.modifyColumnSchema(
      dbTableName,
      oldField,
      newField,
      tableDomain
    );

    // Execute the column modification
    for (const sql of modifyColumnSql) {
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
  }

  /**
   * Handle dependent formula fields when updating a regular field
   * This ensures that formula fields referencing the updated field are properly updated
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async handleDependentFormulaFields(
    tableId: string,
    field: IFieldInstance,
    opContexts: IOpContext[]
  ): Promise<void> {
    // Check if any of the operations affect dependent formula fields
    const affectsDependentFields = opContexts.some((ctx) => {
      const { key } = ctx as ISetFieldPropertyOpContext;
      // These property changes can affect dependent formula fields
      return ['dbFieldType', 'dbFieldName', 'options'].includes(key);
    });

    if (!affectsDependentFields) {
      return;
    }

    const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableId);

    try {
      // Get all formula fields that depend on this field
      const dependentFields = await this.formulaFieldService.getDependentFormulaFieldsInOrder(
        field.id
      );

      if (dependentFields.length === 0) {
        return;
      }

      tableDomain.updateField(field.id, field);

      // Process dependent fields in dependency order (deepest first for deletion, then reverse for creation)
      const fieldsToProcess = [...dependentFields].reverse(); // Reverse to get shallowest first

      // Process each dependent formula field
      for (const { id: dependentFieldId, tableId: dependentTableId } of fieldsToProcess) {
        // Get complete field information
        const dependentFieldRaw = await this.prismaService.txClient().field.findUnique({
          where: { id: dependentFieldId, tableId: dependentTableId, deletedTime: null },
        });

        if (!dependentFieldRaw) {
          continue;
        }

        const dependentFieldInstance = createFieldInstanceByRaw(dependentFieldRaw);
        if (dependentFieldInstance.type !== FieldType.Formula) {
          continue;
        }

        if (!dependentFieldInstance.getIsPersistedAsGeneratedColumn()) {
          continue;
        }

        // Create field instance
        const fieldInstance = createFieldInstanceByRaw(dependentFieldRaw);

        // Recalculate the field's cellValueType and dbFieldType based on current dependencies
        if (fieldInstance.type === FieldType.Formula) {
          // Use the instance method to recalculate field types (including dbFieldType)
          const fieldMap = tableDomain.fields.toFieldMap();
          (fieldInstance as FormulaFieldCore).recalculateFieldTypes(Object.fromEntries(fieldMap));
        }

        // Get table name for dependent field
        const dependentTableMeta = await this.prismaService.txClient().tableMeta.findUnique({
          where: { id: dependentTableId },
          select: { dbTableName: true },
        });

        if (!dependentTableMeta) {
          continue;
        }

        // Use modifyColumnSchema to recreate the dependent formula field
        const modifyColumnSql = this.dbProvider.modifyColumnSchema(
          dependentTableMeta.dbTableName,
          fieldInstance,
          fieldInstance,
          tableDomain
        );

        // Execute the column modification
        for (const sql of modifyColumnSql) {
          await this.prismaService.txClient().$executeRawUnsafe(sql);
        }
      }
    } catch (error) {
      console.warn(`Failed to handle dependent formula fields for field %s:`, field.id, error);
      // Don't throw error to avoid breaking the field update operation
    }
  }
}
