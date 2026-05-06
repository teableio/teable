/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, Logger } from '@nestjs/common';
import {
  FieldType,
  CellValueType,
  DbFieldType,
  PRIMARY_SUPPORTED_TYPES,
  Relationship,
  DriverClient,
  getValidFilterOperators,
  FieldOpBuilder,
} from '@teable/core';
import type {
  IFilter,
  IFilterItem,
  IFilterSet,
  ILinkFieldOptions,
  IOtOperation,
} from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { DataPrismaService } from '@teable/db-data-prisma';
import { IntegrityIssueType, type IIntegrityCheckVo, type IIntegrityIssue } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DATA_KNEX } from '../../global/knex/knex.module';
import { LinkFieldQueryService } from '../field/field-calculate/link-field-query.service';
import { FieldService } from '../field/field.service';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { TableDomainQueryService } from '../table-domain';
import { ForeignKeyIntegrityService } from './foreign-key.service';
import { LinkFieldIntegrityService } from './link-field.service';
import { UniqueIndexService } from './unique-index.service';

@Injectable()
export class LinkIntegrityService {
  private readonly logger = new Logger(LinkIntegrityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly foreignKeyIntegrityService: ForeignKeyIntegrityService,
    private readonly linkFieldIntegrityService: LinkFieldIntegrityService,
    private readonly uniqueIndexService: UniqueIndexService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    private readonly linkFieldQueryService: LinkFieldQueryService,
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {}

  async linkIntegrityCheck(baseId: string, tableId?: string): Promise<IIntegrityCheckVo> {
    const mainBase = await this.prismaService.base.findFirstOrThrow({
      where: { id: baseId, deletedTime: null },
      select: { id: true, name: true },
    });

    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: {
        id: true,
        name: true,
        dbTableName: true,
        fields: {
          where: { type: FieldType.Link, isLookup: null, deletedTime: null },
        },
      },
    });

    const crossBaseLinkFieldsQuery = this.dbProvider.optionsQuery(FieldType.Link, 'baseId', baseId);
    const crossBaseLinkFieldsRaw =
      await this.prismaService.$queryRawUnsafe<Field[]>(crossBaseLinkFieldsQuery);

    const crossBaseLinkFields = crossBaseLinkFieldsRaw.filter(
      (field) => !tables.find((table) => table.id === field.tableId)
    );

    const linkFieldIssues: IIntegrityCheckVo['linkFieldIssues'] = [];

    for (const table of tables) {
      const tableIssues = await this.checkTableLinkFields(table);
      if (tableIssues.length > 0) {
        linkFieldIssues.push({
          baseId: mainBase.id,
          baseName: mainBase.name,
          issues: tableIssues,
        });
      }
      const uniqueIndexIssues = await this.uniqueIndexService.checkUniqueIndex(table);
      if (uniqueIndexIssues.length > 0) {
        linkFieldIssues.push({
          baseId: mainBase.id,
          baseName: mainBase.name,
          tableId: table.id,
          tableName: table.name,
          issues: uniqueIndexIssues,
        });
      }
    }

    for (const field of crossBaseLinkFields) {
      const table = await this.prismaService.tableMeta.findFirst({
        where: {
          id: field.tableId,
          deletedTime: null,
          base: { deletedTime: null, space: { deletedTime: null } },
        },
        select: { id: true, name: true, baseId: true },
      });

      if (!table) {
        continue;
      }

      const tableIssues = await this.checkTableLinkFields({
        id: table.id,
        name: table.name,
        fields: [field],
      });

      const base = await this.prismaService.base.findFirstOrThrow({
        where: { id: table.baseId, deletedTime: null },
        select: { id: true, name: true },
      });

      if (tableIssues.length > 0) {
        linkFieldIssues.push({
          baseId: base.id,
          baseName: base.name,
          issues: tableIssues,
        });
      }
    }

    const referenceFieldIssues = await this.checkReferenceField(baseId);
    if (referenceFieldIssues.length > 0) {
      linkFieldIssues.push({
        baseId: mainBase.id,
        baseName: mainBase.name,
        issues: referenceFieldIssues,
      });
    }

    if (tableId) {
      const checkEmptyString = await this.checkEmptyString(tableId);

      if (checkEmptyString.length > 0) {
        linkFieldIssues.push({
          baseId: mainBase.id,
          baseName: mainBase.name,
          issues: checkEmptyString,
        });
      }
    }

    const filterIssues = await this.checkInvalidFilterOperators(baseId);
    if (filterIssues.length > 0) {
      linkFieldIssues.push({
        baseId: mainBase.id,
        baseName: mainBase.name,
        issues: filterIssues,
      });
    }

    const invalidPrimaryIssues = await this.checkInvalidPrimary(baseId);
    if (invalidPrimaryIssues.length > 0) {
      linkFieldIssues.push({
        baseId: mainBase.id,
        baseName: mainBase.name,
        issues: invalidPrimaryIssues,
      });
    }

    const missingPrimaryIssues = await this.checkMissingPrimary(baseId);
    if (missingPrimaryIssues.length > 0) {
      linkFieldIssues.push({
        baseId: mainBase.id,
        baseName: mainBase.name,
        issues: missingPrimaryIssues,
      });
    }

    return {
      hasIssues: linkFieldIssues.length > 0,
      linkFieldIssues,
    };
  }

  // Detect primary fields that break base duplication / symmetric link generation:
  //   1. Lookup-ish primaries — isLookup, isConditionalLookup, or stray lookupOptions.
  //      Origin: convertField path before T3367 (e.g. AI flipped Employee→lookup).
  //   2. Unsupported-type primaries — link/checkbox/attachment/rollup as primary.
  //      Origin: bulk createFieldsByRo (duplicate/import/AI), now blocked at the source.
  // Both states make `findFirstOrThrow({tableId, isPrimary: true})` return a field that can't
  // serve as a static lookupFieldId for symmetric links.
  private async checkInvalidPrimary(baseId: string): Promise<IIntegrityIssue[]> {
    const fields = await this.prismaService.field.findMany({
      where: {
        deletedTime: null,
        isPrimary: true,
        table: { baseId, deletedTime: null },
        OR: [
          { isLookup: true },
          { isConditionalLookup: true },
          { lookupOptions: { not: null } },
          { type: { notIn: Array.from(PRIMARY_SUPPORTED_TYPES) } },
        ],
      },
      select: {
        id: true,
        name: true,
        type: true,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: true,
        tableId: true,
        table: { select: { name: true } },
      },
    });

    return fields.map((f) => {
      const isLookupish = f.isLookup || f.isConditionalLookup || f.lookupOptions !== null;
      const type = isLookupish
        ? IntegrityIssueType.InvalidPrimaryLookup
        : IntegrityIssueType.InvalidPrimaryType;
      const reason = isLookupish
        ? 'is incorrectly configured as a lookup field'
        : `has unsupported type "${f.type}"`;
      return {
        fieldId: f.id,
        tableId: f.tableId,
        type,
        message: `Primary field "${f.name}" in table "${f.table.name}" ${reason}, which breaks base duplication. Fixing will demote it and promote an existing eligible field as primary; if no candidate qualifies, a new formula field mirroring the current value is added and the bad primary is renamed with a "(before-fix)" suffix.`,
      };
    });
  }

  // Detect tables that have no primary field at all. `field-supplement.generateSymmetricField`
  // does `findFirstOrThrow({tableId, isPrimary: true})` when creating link fields during base
  // duplication; a missing primary makes that throw.
  private async checkMissingPrimary(baseId: string): Promise<IIntegrityIssue[]> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
        fields: { none: { isPrimary: true, deletedTime: null } },
      },
      select: { id: true, name: true },
    });

    return tables.map((t) => ({
      // fieldId is required by the schema; use tableId as a stable placeholder so the fix
      // dispatcher can locate the table without a real field reference.
      fieldId: t.id,
      tableId: t.id,
      type: IntegrityIssueType.MissingPrimary,
      message: `Table "${t.name}" has no primary field, which breaks base duplication. Fixing will promote the first existing eligible field as primary, or add a new "Name" text field if none qualifies.`,
    }));
  }

  private async checkReferenceField(baseId: string): Promise<IIntegrityIssue[]> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: {
        id: true,
        name: true,
        fields: {
          where: { deletedTime: null },
          select: { id: true },
        },
      },
    });

    const allFieldIds = tables.reduce<string[]>((acc, table) => {
      return [...acc, ...table.fields.map((f) => f.id)];
    }, []);

    const references = await this.prismaService.reference.findMany({
      where: {
        OR: [{ fromFieldId: { in: allFieldIds } }, { toFieldId: { in: allFieldIds } }],
      },
    });

    const fieldIds = new Set<string>();
    for (const reference of references) {
      fieldIds.add(reference.fromFieldId);
      fieldIds.add(reference.toFieldId);
    }

    const fields = await this.prismaService.field.findMany({
      where: { id: { in: Array.from(fieldIds) } },
      select: { id: true, name: true, deletedTime: true },
    });

    const deletedFields = fields.filter((f) => f.deletedTime);

    // exist in references but not in fields
    const cannotFindFields = Array.from(fieldIds).filter((id) => !fields.find((f) => f.id === id));

    const issues: IIntegrityIssue[] = [];
    for (const field of deletedFields) {
      issues.push({
        fieldId: field.id,
        type: IntegrityIssueType.ReferenceFieldNotFound,
        message: `Reference field ${field.name} is deleted`,
      });
    }

    for (const fieldId of cannotFindFields) {
      issues.push({
        fieldId,
        type: IntegrityIssueType.ReferenceFieldNotFound,
        message: `Reference field ${fieldId} not found`,
      });
    }

    return issues;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async checkTableLinkFields(table: {
    id: string;
    name: string;
    fields: Field[];
  }): Promise<IIntegrityIssue[]> {
    const issues: IIntegrityIssue[] = [];

    for (const field of table.fields) {
      const options = JSON.parse(field.options as string) as ILinkFieldOptions;

      const foreignTable = await this.prismaService.tableMeta.findFirst({
        where: { id: options.foreignTableId, deletedTime: null },
        select: { id: true, baseId: true, dbTableName: true },
      });

      if (!foreignTable) {
        issues.push({
          fieldId: field.id,
          type: IntegrityIssueType.ForeignTableNotFound,
          message: `Foreign table with ID ${options.foreignTableId} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      }

      let canCheckLinks = false;
      const tableExistsSql = this.dbProvider.checkTableExist(options.fkHostTableName);
      const tableExists =
        await this.dataPrismaService.txClient().$queryRawUnsafe<{ exists: boolean }[]>(
          tableExistsSql
        );
      const hostTableExists = tableExists[0].exists;

      if (!hostTableExists) {
        issues.push({
          fieldId: field.id,
          type: IntegrityIssueType.ForeignKeyHostTableNotFound,
          message: `Foreign key host table ${options.fkHostTableName} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      } else {
        const selfKeyExists = await this.dbProvider.checkColumnExist(
          options.fkHostTableName,
          options.selfKeyName,
          this.dataPrismaService.txClient()
        );

        const foreignKeyExists = await this.dbProvider.checkColumnExist(
          options.fkHostTableName,
          options.foreignKeyName,
          this.dataPrismaService.txClient()
        );

        if (!selfKeyExists) {
          issues.push({
            fieldId: field.id,
            type: IntegrityIssueType.ForeignKeyNotFound,
            message: `Self key name "${options.selfKeyName}" is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }

        if (!foreignKeyExists) {
          issues.push({
            fieldId: field.id,
            type: IntegrityIssueType.ForeignKeyNotFound,
            message: `Foreign key name "${options.foreignKeyName}" is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }
        canCheckLinks = selfKeyExists && foreignKeyExists;
      }

      if (options.symmetricFieldId) {
        const symmetricField = await this.prismaService.field.findFirst({
          where: { id: options.symmetricFieldId, deletedTime: null },
        });

        if (!symmetricField) {
          issues.push({
            fieldId: field.id,
            type: IntegrityIssueType.SymmetricFieldNotFound,
            message: `Symmetric field ID ${options.symmetricFieldId} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }
      }

      if (!options.isOneWay && !options.symmetricFieldId) {
        issues.push({
          fieldId: field.id,
          type: IntegrityIssueType.SymmetricFieldNotFound,
          message: `Symmetric is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      }

      if (foreignTable && hostTableExists && canCheckLinks) {
        const linkField = createFieldInstanceByRaw(field) as LinkFieldDto;
        const invalidReferences = await this.foreignKeyIntegrityService.getIssues(
          table.id,
          linkField
        );
        const invalidLinks = await this.linkFieldIntegrityService.getIssues(table.id, linkField);

        if (invalidReferences.length > 0) {
          issues.push(...invalidReferences);
        }
        if (invalidLinks.length > 0) {
          issues.push(...invalidLinks);
        }
      }
    }

    return issues;
  }

  async checkEmptyString(tableId: string): Promise<IIntegrityIssue[]> {
    const prisma = this.prismaService.txClient();
    const dataPrisma = this.dataPrismaService.txClient();
    const fields = await prisma.field.findMany({
      where: {
        tableId,
        deletedTime: null,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        isComputed: null,
      },
      select: {
        dbFieldName: true,
        id: true,
      },
    });

    const { dbTableName } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const issues: IIntegrityIssue[] = [];

    for (const { dbFieldName, id: fieldId } of fields) {
      const countSql = await this.knex(dbTableName)
        .count('*')
        .whereRaw(`?? = ''`, [dbFieldName])
        .toQuery();
      const countResult = await dataPrisma.$queryRawUnsafe<{ count: number }[]>(countSql);
      const count = Number(countResult[0].count);
      if (count > 0) {
        issues.push({
          type: IntegrityIssueType.EmptyString,
          fieldId: fieldId,
          tableId,
          message: `Empty string cell value found in field: ${dbFieldName}`,
        });
      }
    }

    return issues;
  }

  private async fixMissingForeignKeyColumns(
    fieldId: string,
    issueType?: IntegrityIssueType
  ): Promise<IIntegrityIssue | undefined> {
    const prisma = this.prismaService.txClient();
    const dataPrisma = this.dataPrismaService.txClient();
    const fieldRaw = await prisma.field.findFirst({
      where: { id: fieldId, type: FieldType.Link, isLookup: null, deletedTime: null },
    });

    if (!fieldRaw) {
      return;
    }

    const linkField = createFieldInstanceByRaw(fieldRaw) as LinkFieldDto;
    const options = linkField.options;
    const tableMeta = await prisma.tableMeta.findFirst({
      where: { id: fieldRaw.tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    if (!tableMeta) {
      return;
    }

    if (options.relationship === Relationship.OneOne && options.foreignKeyName === '__id') {
      // Symmetric OneOne fields do not own the FK column.
      return;
    }

    const tableDomain = await this.tableDomainQueryService.getTableDomainById(fieldRaw.tableId);
    const tableNameMap = await this.linkFieldQueryService.getTableNameMapForLinkFields(
      fieldRaw.tableId,
      [linkField]
    );

    const queries = this.dbProvider.createColumnSchema(
      tableMeta.dbTableName,
      linkField,
      tableDomain,
      false,
      fieldRaw.tableId,
      tableNameMap,
      false,
      true
    );

    const hostExistsResult = await dataPrisma.$queryRawUnsafe<{ exists: boolean }[]>(
      this.dbProvider.checkTableExist(options.fkHostTableName)
    );
    const hostAlreadyExists = hostExistsResult[0]?.exists;
    const foreignDbTableName = tableNameMap.get(options.foreignTableId);

    if (!foreignDbTableName) {
      return;
    }

    const orderColumnName = linkField.getOrderColumnName();

    if (hostAlreadyExists) {
      const [selfKeyExists, foreignKeyExists, orderColumnExists] = await Promise.all([
        this.dbProvider.checkColumnExist(
          options.fkHostTableName,
          options.selfKeyName,
          dataPrisma
        ),
        this.dbProvider.checkColumnExist(
          options.fkHostTableName,
          options.foreignKeyName,
          dataPrisma
        ),
        orderColumnName
          ? this.dbProvider.checkColumnExist(options.fkHostTableName, orderColumnName, dataPrisma)
          : Promise.resolve(true),
      ]);

      const alterSchema = this.knex.schema.alterTable(options.fkHostTableName, (table) => {
        switch (options.relationship) {
          case Relationship.ManyMany: {
            if (!selfKeyExists) {
              table
                .string(options.selfKeyName)
                .references('__id')
                .inTable(tableMeta.dbTableName)
                .withKeyName(`fk_${options.selfKeyName}`);
            }
            if (!foreignKeyExists) {
              table
                .string(options.foreignKeyName)
                .references('__id')
                .inTable(foreignDbTableName)
                .withKeyName(`fk_${options.foreignKeyName}`);
            }
            if (orderColumnName && !orderColumnExists) {
              table.integer(orderColumnName).nullable();
            }
            break;
          }
          case Relationship.ManyOne:
          case Relationship.OneOne: {
            if (!foreignKeyExists) {
              table
                .string(options.foreignKeyName)
                .references('__id')
                .inTable(foreignDbTableName)
                .withKeyName(`fk_${options.foreignKeyName}`);
              if (options.relationship === Relationship.OneOne) {
                table.unique([options.foreignKeyName], {
                  indexName: `index_${options.foreignKeyName}`,
                });
              }
            }
            if (orderColumnName && !orderColumnExists) {
              table.integer(orderColumnName).nullable();
            }
            break;
          }
          case Relationship.OneMany: {
            if (options.isOneWay) {
              if (!selfKeyExists) {
                table
                  .string(options.selfKeyName)
                  .references('__id')
                  .inTable(tableMeta.dbTableName)
                  .withKeyName(`fk_${options.selfKeyName}`);
              }
              if (!foreignKeyExists) {
                table
                  .string(options.foreignKeyName)
                  .references('__id')
                  .inTable(foreignDbTableName)
                  .withKeyName(`fk_${options.foreignKeyName}`);
              }
              if (!selfKeyExists || !foreignKeyExists) {
                table.unique([options.selfKeyName, options.foreignKeyName], {
                  indexName: `index_${options.selfKeyName}_${options.foreignKeyName}`,
                });
              }
            } else {
              if (!selfKeyExists) {
                table
                  .string(options.selfKeyName)
                  .references('__id')
                  .inTable(tableMeta.dbTableName)
                  .withKeyName(`fk_${options.selfKeyName}`);
              }
              if (orderColumnName && !orderColumnExists) {
                table.integer(orderColumnName).nullable();
              }
            }
            break;
          }
          default:
            break;
        }
      });

      const alterSqls = alterSchema
        .toSQL()
        .map(({ sql }) => sql)
        .filter((sql) => sql && !sql.startsWith('PRAGMA'));

      for (const sql of alterSqls) {
        await dataPrisma.$executeRawUnsafe(sql);
      }
    } else {
      const sqls = queries.filter((sql) => sql && !sql.startsWith('PRAGMA'));
      if (!sqls.length) {
        return;
      }

      for (const sql of sqls) {
        try {
          await dataPrisma.$executeRawUnsafe(sql);
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2010' &&
            (error.meta as { code?: string })?.code === '42P07'
          ) {
            // Relation already exists; continue with the rest of the fix
            continue;
          }
          throw error;
        }
      }
    }

    await this.backfillForeignKeysFromLinkColumn({
      dbTableName: tableMeta.dbTableName,
      linkDbFieldName: linkField.dbFieldName,
      fkHostTableName: options.fkHostTableName,
      selfKeyName: options.selfKeyName,
      foreignKeyName: options.foreignKeyName,
      relationship: options.relationship,
      isOneWay: options.isOneWay,
    });

    return {
      type: issueType ?? IntegrityIssueType.ForeignKeyNotFound,
      fieldId,
      message: `Restored missing foreign key columns for link field (Field Name: ${fieldRaw.name}, Field ID: ${fieldId})`,
    };
  }

  private async backfillForeignKeysFromLinkColumn(params: {
    dbTableName: string;
    linkDbFieldName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    relationship: Relationship;
    isOneWay?: boolean;
  }) {
    const {
      dbTableName,
      linkDbFieldName,
      fkHostTableName,
      selfKeyName,
      foreignKeyName,
      relationship,
      isOneWay,
    } = params;
    const dataPrisma = this.dataPrismaService.txClient();

    const linkColumnExists = await this.dbProvider.checkColumnExist(
      dbTableName,
      linkDbFieldName,
      dataPrisma
    );
    if (!linkColumnExists) {
      return;
    }

    const usesJunction =
      relationship === Relationship.ManyMany ||
      (relationship === Relationship.OneMany && Boolean(isOneWay));

    if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
      const foreignKeyExists = await this.dbProvider.checkColumnExist(
        fkHostTableName,
        foreignKeyName,
        dataPrisma
      );
      if (!foreignKeyExists) {
        return;
      }

      const query =
        this.dbProvider.driver === DriverClient.Pg
          ? this.knex(fkHostTableName)
              .update({
                [foreignKeyName]: this.knex.raw(`NULLIF(??->>'id','')`, [linkDbFieldName]),
              })
              .whereNotNull(linkDbFieldName)
              .whereNull(foreignKeyName)
              .toQuery()
          : this.knex(fkHostTableName)
              .update({
                [foreignKeyName]: this.knex.raw(`json_extract(??, '$.id')`, [linkDbFieldName]),
              })
              .whereNotNull(linkDbFieldName)
              .whereNull(foreignKeyName)
              .toQuery();

      await dataPrisma.$executeRawUnsafe(query);
      return;
    }

    if (relationship === Relationship.OneMany && !usesJunction) {
      const selfKeyExists = await this.dbProvider.checkColumnExist(
        fkHostTableName,
        selfKeyName,
        dataPrisma
      );
      if (!selfKeyExists) {
        return;
      }

      const query =
        this.dbProvider.driver === DriverClient.Pg
          ? this.knex
              .raw(
                `
                WITH pairs AS (
                  SELECT s.__id AS self_id,
                         (elem->>'id') AS foreign_id
                  FROM ?? AS s
                  JOIN LATERAL jsonb_array_elements(??.??) elem ON true
                  WHERE ??.?? IS NOT NULL
                ),
                dedup AS (
                  SELECT foreign_id, MIN(self_id) AS self_id
                  FROM pairs
                  WHERE foreign_id IS NOT NULL
                  GROUP BY foreign_id
                )
                UPDATE ?? AS f
                SET ?? = d.self_id
                FROM dedup d
                WHERE f.__id = d.foreign_id
                  AND f.?? IS NULL
                `,
                [
                  dbTableName,
                  's',
                  linkDbFieldName,
                  's',
                  linkDbFieldName,
                  fkHostTableName,
                  selfKeyName,
                  selfKeyName,
                ]
              )
              .toQuery()
          : this.knex
              .raw(
                `
                WITH pairs AS (
                  SELECT s.__id AS self_id,
                         json_extract(j.value, '$.id') AS foreign_id
                  FROM ?? AS s
                  JOIN json_each(??.??) j
                  WHERE ??.?? IS NOT NULL
                ),
                dedup AS (
                  SELECT foreign_id, MIN(self_id) AS self_id
                  FROM pairs
                  WHERE foreign_id IS NOT NULL
                  GROUP BY foreign_id
                )
                UPDATE ??
                SET ?? = (SELECT d.self_id FROM dedup d WHERE d.foreign_id = ??.__id)
                WHERE __id IN (SELECT foreign_id FROM dedup)
                  AND ?? IS NULL
                `,
                [
                  dbTableName,
                  's',
                  linkDbFieldName,
                  's',
                  linkDbFieldName,
                  fkHostTableName,
                  selfKeyName,
                  fkHostTableName,
                  selfKeyName,
                ]
              )
              .toQuery();

      await dataPrisma.$executeRawUnsafe(query);
      return;
    }

    if (!usesJunction) {
      return;
    }

    const [selfKeyExists, foreignKeyExists] = await Promise.all([
      this.dbProvider.checkColumnExist(fkHostTableName, selfKeyName, dataPrisma),
      this.dbProvider.checkColumnExist(fkHostTableName, foreignKeyName, dataPrisma),
    ]);
    if (!selfKeyExists || !foreignKeyExists) {
      return;
    }

    const query =
      this.dbProvider.driver === DriverClient.Pg
        ? this.knex
            .raw(
              `
              WITH pairs AS (
                SELECT s.__id AS self_id,
                       (elem->>'id') AS foreign_id
                FROM ?? AS s
                JOIN LATERAL jsonb_array_elements(??.??) elem ON true
                WHERE ??.?? IS NOT NULL
              )
              INSERT INTO ?? (??, ??)
              SELECT DISTINCT p.self_id, p.foreign_id
              FROM pairs p
              WHERE p.foreign_id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM ?? j
                  WHERE j.?? = p.self_id AND j.?? = p.foreign_id
                )
              `,
              [
                dbTableName,
                's',
                linkDbFieldName,
                's',
                linkDbFieldName,
                fkHostTableName,
                selfKeyName,
                foreignKeyName,
                fkHostTableName,
                selfKeyName,
                foreignKeyName,
              ]
            )
            .toQuery()
        : this.knex
            .raw(
              `
              WITH pairs AS (
                SELECT s.__id AS self_id,
                       json_extract(j.value, '$.id') AS foreign_id
                FROM ?? AS s
                JOIN json_each(??.??) j
                WHERE ??.?? IS NOT NULL
              )
              INSERT INTO ?? (??, ??)
              SELECT DISTINCT p.self_id, p.foreign_id
              FROM pairs p
              WHERE p.foreign_id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM ?? j
                  WHERE j.?? = p.self_id AND j.?? = p.foreign_id
                )
              `,
              [
                dbTableName,
                's',
                linkDbFieldName,
                's',
                linkDbFieldName,
                fkHostTableName,
                selfKeyName,
                foreignKeyName,
                fkHostTableName,
                selfKeyName,
                foreignKeyName,
              ]
            )
            .toQuery();

    await dataPrisma.$executeRawUnsafe(query);
  }

  async linkIntegrityFix(baseId: string, tableId?: string): Promise<IIntegrityIssue[]> {
    const checkResult = await this.linkIntegrityCheck(baseId, tableId || '');
    const fixResults: IIntegrityIssue[] = [];
    for (const issues of checkResult.linkFieldIssues) {
      for (const issue of issues.issues) {
        switch (issue.type) {
          case IntegrityIssueType.MissingRecordReference: {
            const result = await this.foreignKeyIntegrityService.fix(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.InvalidLinkReference: {
            const result = await this.linkFieldIntegrityService.fix(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.ForeignKeyNotFound:
          case IntegrityIssueType.ForeignKeyHostTableNotFound: {
            const result = await this.fixMissingForeignKeyColumns(issue.fieldId, issue.type);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.SymmetricFieldNotFound: {
            const result = await this.fixOneWayLinkField(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.ReferenceFieldNotFound: {
            const result = await this.fixReferenceField(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.UniqueIndexNotFound: {
            const result = await this.uniqueIndexService.fixUniqueIndex(
              issues.tableId,
              issue.fieldId
            );
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.EmptyString: {
            const result = await this.fixEmptyString(issue.fieldId, issue.tableId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.InvalidFilterOperator: {
            const result = await this.fixInvalidFilterOperator(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.InvalidPrimaryLookup:
          case IntegrityIssueType.InvalidPrimaryType: {
            const result = await this.fixInvalidPrimary(issue.fieldId, issue.type);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.MissingPrimary: {
            // For missing-primary issues fieldId carries the tableId (see checkMissingPrimary).
            const result = await this.fixMissingPrimary(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          default:
            break;
        }
      }
    }

    return fixResults;
  }

  async fixReferenceField(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const deleted = await this.prismaService.reference.deleteMany({
      where: {
        OR: [{ fromFieldId: fieldId }, { toFieldId: fieldId }],
      },
    });

    if (deleted.count <= 0) {
      return;
    }

    return {
      type: IntegrityIssueType.InvalidLinkReference,
      fieldId,
      message: 'InvalidLinkReference fixed',
    };
  }

  async fixInvalidPrimary(
    fieldId: string,
    issueType: IntegrityIssueType
  ): Promise<IIntegrityIssue | undefined> {
    const oldField = await this.prismaService.field.findFirst({
      where: {
        id: fieldId,
        deletedTime: null,
        isPrimary: true,
      },
      select: { id: true, name: true, tableId: true },
    });
    if (!oldField) return;

    // Strategy: atomic via outer $tx — inner $tx calls from updateField / createField reuse
    // the same transaction, so any failure rolls back all partial mutations.
    //   1. Demote the bad primary (direct DB — no service for primary toggle).
    //   2. If the table still has a separate valid primary → keep it as-is (defensive).
    //   3. Else if any field qualifies as primary → promote it directly.
    //   4. Else fall back: rename the bad primary to "(before-fix)" so the original name
    //      is free, then create + promote a formula field mirroring the old value.
    // The old bad primary is always preserved so existing references (link preview
    // `options.lookupFieldId`, downstream lookups/rollups/formulas) keep working.

    const primaryFieldFilter = {
      deletedTime: null,
      isLookup: null,
      isConditionalLookup: null,
      lookupOptions: null,
      type: { in: Array.from(PRIMARY_SUPPORTED_TYPES) },
    };

    const result = await this.prismaService.$tx(async (prisma) => {
      // Demote the bad primary first. Rename is deferred — only the formula fallback path
      // needs to free up the original name for the new field.
      await prisma.field.update({
        where: { id: oldField.id },
        data: { isPrimary: null },
      });

      // Defensive: if a separate valid primary already exists in the table, leave it alone.
      // Avoids leaving the table with multiple primaries (which the integrity check doesn't
      // detect today). Production has zero such tables and validatePrimaryConfigurations
      // blocks new ones, but this guards races / direct SQL writes / future regressions.
      const existingValidPrimary = await prisma.field.findFirst({
        where: { tableId: oldField.tableId, isPrimary: true, ...primaryFieldFilter },
        select: { id: true, name: true },
      });

      if (existingValidPrimary) {
        return { kind: 'kept' as const, field: existingValidPrimary };
      }

      // Prefer promoting an existing eligible candidate over creating a new formula field.
      // Mirrors fixMissingPrimary's behavior — fewer artifact fields, simpler table shape.
      // The promoted field's displayed value will replace the bad primary's value; the bad
      // primary itself stays untouched (no rename needed since no name collision).
      const candidate = await prisma.field.findFirst({
        where: { tableId: oldField.tableId, ...primaryFieldFilter },
        orderBy: { order: 'asc' },
        select: { id: true, name: true },
      });

      if (candidate) {
        await prisma.field.update({
          where: { id: candidate.id },
          data: { isPrimary: true },
        });
        return { kind: 'promoted' as const, field: candidate };
      }

      // Fallback: no eligible candidate exists. Rename the bad primary so the new formula
      // field can take its name, then create the formula mirroring the original value.
      const legacyName = `${oldField.name} (before-fix)`;
      await this.fieldOpenApiService.updateField(oldField.tableId, oldField.id, {
        name: legacyName,
      });
      const newField = await this.fieldOpenApiService.createField(oldField.tableId, {
        type: FieldType.Formula,
        name: oldField.name,
        options: {
          expression: `{${oldField.id}}`,
        },
      });

      await prisma.field.update({
        where: { id: newField.id },
        data: { isPrimary: true },
      });

      return {
        kind: 'created' as const,
        field: { id: newField.id, name: oldField.name },
        legacyName,
      };
    });

    const baseMsg = `Demoted invalid primary "${oldField.name}" (id ${oldField.id}).`;
    if (result.kind === 'kept') {
      return {
        type: issueType,
        fieldId,
        message: `${baseMsg} Existing valid primary "${result.field.name}" (${result.field.id}) preserved.`,
      };
    }
    if (result.kind === 'promoted') {
      return {
        type: issueType,
        fieldId,
        message: `${baseMsg} Promoted existing field "${result.field.name}" (${result.field.id}) to primary.`,
      };
    }
    return {
      type: issueType,
      fieldId,
      message: `Demoted invalid primary "${oldField.name}" (renamed to "${result.legacyName}", id ${oldField.id}). Added new formula field "${result.field.name}" (${result.field.id}) as primary, mirroring the original value.`,
    };
  }

  async fixMissingPrimary(tableId: string): Promise<IIntegrityIssue | undefined> {
    const table = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { id: true, name: true },
    });
    if (!table) return;

    // Re-check inside the transaction to avoid racing with a concurrent promotion.
    return this.prismaService.$tx(async () => {
      const prisma = this.prismaService.txClient();
      const existing = await prisma.field.findFirst({
        where: { tableId, isPrimary: true, deletedTime: null },
        select: { id: true },
      });
      if (existing) return undefined;

      // Prefer promoting an existing valid candidate. Avoids leaving a stray "Name 2"
      // alongside the user's existing fields and matches the natural intuition that
      // the first usable column should be primary.
      const candidate = await prisma.field.findFirst({
        where: {
          tableId,
          deletedTime: null,
          isLookup: null,
          isConditionalLookup: null,
          lookupOptions: null,
          type: { in: Array.from(PRIMARY_SUPPORTED_TYPES) },
        },
        orderBy: { order: 'asc' },
        select: { id: true, name: true },
      });

      if (candidate) {
        await prisma.field.update({
          where: { id: candidate.id },
          data: { isPrimary: true },
        });
        return {
          type: IntegrityIssueType.MissingPrimary,
          fieldId: candidate.id,
          tableId,
          message: `Promoted existing field "${candidate.name}" (${candidate.id}) to primary in table "${table.name}".`,
        };
      }

      // Fallback: no usable candidate (every field is link / checkbox / attachment /
      // rollup / lookup-ish). Create a new "Name" text field as primary.
      const newField = await this.fieldOpenApiService.createField(tableId, {
        type: FieldType.SingleLineText,
        name: 'Name',
      });
      await prisma.field.update({
        where: { id: newField.id },
        data: { isPrimary: true },
      });
      return {
        type: IntegrityIssueType.MissingPrimary,
        fieldId: newField.id,
        tableId,
        message: `Added "Name" text field (${newField.id}) as primary in table "${table.name}".`,
      };
    });
  }

  async fixOneWayLinkField(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const field = await this.prismaService.field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
    });

    const options = JSON.parse(field.options as string) as ILinkFieldOptions;

    if (!options.isOneWay && !options.symmetricFieldId) {
      await this.prismaService.field.update({
        where: { id: fieldId },
        data: {
          options: JSON.stringify({
            ...options,
            isOneWay: true,
          }),
        },
      });
    }

    if (options.isOneWay && options.symmetricFieldId) {
      await this.prismaService.field.update({
        where: { id: fieldId },
        data: {
          options: JSON.stringify({
            ...options,
            isOneWay: undefined,
          }),
        },
      });
    }

    return {
      type: IntegrityIssueType.SymmetricFieldNotFound,
      fieldId: field.id,
      message: `fixed one way link field (Field Name: ${field.name}, Field ID: ${field.id})`,
    };
  }

  async fixEmptyString(fieldId: string, tableId?: string): Promise<IIntegrityIssue | undefined> {
    const prisma = this.prismaService.txClient();
    const dataPrisma = this.dataPrismaService.txClient();
    if (!tableId) {
      return;
    }

    const { dbTableName } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const { dbFieldName } = await prisma.field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
      select: { dbFieldName: true },
    });

    const sql = this.knex(dbTableName)
      .whereRaw('?? = ?', [dbFieldName, ''])
      .update({
        [dbFieldName]: null,
      })
      .toQuery();
    await dataPrisma.$executeRawUnsafe(sql);

    return {
      type: IntegrityIssueType.EmptyString,
      fieldId,
      message: 'Empty string cell value fixed',
    };
  }

  private async checkInvalidFilterOperators(baseId: string): Promise<IIntegrityIssue[]> {
    const issues: IIntegrityIssue[] = [];

    const tableIds = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true },
    });

    const allFields = await this.prismaService.field.findMany({
      where: {
        tableId: { in: tableIds.map((t) => t.id) },
        deletedTime: null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        cellValueType: true,
        isMultipleCellValue: true,
        options: true,
        lookupOptions: true,
        tableId: true,
      },
    });

    const fieldMap = new Map(allFields.map((f) => [f.id, f]));

    for (const field of allFields) {
      const filters: { filter: IFilter; source: 'options' | 'lookupOptions' }[] = [];

      if (field.options) {
        try {
          const options = JSON.parse(field.options);
          if (options.filter?.filterSet) {
            filters.push({ filter: options.filter, source: 'options' });
          }
        } catch {
          /* skip */
        }
      }

      if (field.lookupOptions) {
        try {
          const lookupOptions = JSON.parse(field.lookupOptions);
          if (lookupOptions.filter?.filterSet) {
            filters.push({ filter: lookupOptions.filter, source: 'lookupOptions' });
          }
        } catch {
          /* skip */
        }
      }

      for (const { filter } of filters) {
        const invalidOps = this.findInvalidFilterOperators(filter, fieldMap);
        if (invalidOps.length > 0) {
          const details = invalidOps
            .map((inv) => `"${inv.operator}" on "${inv.targetFieldName}"`)
            .join(', ');
          issues.push({
            type: IntegrityIssueType.InvalidFilterOperator,
            fieldId: field.id,
            tableId: field.tableId,
            message: `Field "${field.name}" has invalid filter operators: ${details}`,
          });
          break;
        }
      }
    }

    return issues;
  }

  private findInvalidFilterOperators(
    filter: IFilter | IFilterSet,
    fieldMap: Map<
      string,
      {
        name: string;
        type: string;
        cellValueType: string | null;
        isMultipleCellValue: boolean | null;
      }
    >
  ): Array<{ targetFieldId: string; targetFieldName: string; operator: string }> {
    const results: Array<{ targetFieldId: string; targetFieldName: string; operator: string }> = [];

    if (!filter?.filterSet) return results;

    for (const item of filter.filterSet) {
      if ('filterSet' in item) {
        results.push(...this.findInvalidFilterOperators(item as IFilterSet, fieldMap));
        continue;
      }

      const filterItem = item as IFilterItem;
      const targetField = fieldMap.get(filterItem.fieldId);
      if (!targetField) continue;

      const validOps = getValidFilterOperators({
        cellValueType: targetField.cellValueType as CellValueType,
        type: targetField.type as FieldType,
        isMultipleCellValue: targetField.isMultipleCellValue ?? undefined,
      });

      if (!(validOps as string[]).includes(filterItem.operator as string)) {
        results.push({
          targetFieldId: filterItem.fieldId,
          targetFieldName: targetField.name ?? filterItem.fieldId,
          operator: filterItem.operator,
        });
      }
    }

    return results;
  }

  private async fixInvalidFilterOperator(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const fieldRaw = await this.prismaService.field.findFirst({
      where: { id: fieldId, deletedTime: null },
    });

    if (!fieldRaw) return;

    // Get all fields in the same base to validate filter operators
    const tableMeta = await this.prismaService.tableMeta.findFirst({
      where: { id: fieldRaw.tableId, deletedTime: null },
      select: { baseId: true },
    });
    if (!tableMeta) return;

    const tablesInBase = await this.prismaService.tableMeta.findMany({
      where: { baseId: tableMeta.baseId, deletedTime: null },
      select: { id: true },
    });

    const allFields = await this.prismaService.field.findMany({
      where: {
        tableId: { in: tablesInBase.map((t) => t.id) },
        deletedTime: null,
      },
      select: {
        id: true,
        type: true,
        cellValueType: true,
        isMultipleCellValue: true,
      },
    });

    const fieldMap = new Map(allFields.map((f) => [f.id, f]));
    const ops: IOtOperation[] = [];

    if (fieldRaw.options) {
      try {
        const options = JSON.parse(fieldRaw.options);
        if (options.filter?.filterSet) {
          const cleaned = this.removeInvalidFilterItems(options.filter, fieldMap);
          const newFilter = cleaned?.filterSet?.length ? cleaned : null;
          if (JSON.stringify(newFilter) !== JSON.stringify(options.filter)) {
            ops.push(
              FieldOpBuilder.editor.setFieldProperty.build({
                key: 'options',
                oldValue: options,
                newValue: { ...options, filter: newFilter },
              })
            );
          }
        }
      } catch {
        /* skip */
      }
    }

    if (fieldRaw.lookupOptions) {
      try {
        const lookupOptions = JSON.parse(fieldRaw.lookupOptions);
        if (lookupOptions.filter?.filterSet) {
          const cleaned = this.removeInvalidFilterItems(lookupOptions.filter, fieldMap);
          const newFilter = cleaned?.filterSet?.length ? cleaned : null;
          if (JSON.stringify(newFilter) !== JSON.stringify(lookupOptions.filter)) {
            ops.push(
              FieldOpBuilder.editor.setFieldProperty.build({
                key: 'lookupOptions',
                oldValue: lookupOptions,
                newValue: { ...lookupOptions, filter: newFilter },
              })
            );
          }
        }
      } catch {
        /* skip */
      }
    }

    if (!ops.length) return;

    await this.fieldService.batchUpdateFields(fieldRaw.tableId, [{ fieldId, ops }]);

    return {
      type: IntegrityIssueType.InvalidFilterOperator,
      fieldId,
      message: `Removed invalid filter operators from field "${fieldRaw.name}"`,
    };
  }

  private removeInvalidFilterItems(
    filter: IFilterSet,
    fieldMap: Map<
      string,
      {
        type: string;
        cellValueType: string | null;
        isMultipleCellValue: boolean | null;
      }
    >
  ): IFilterSet {
    const filterSet: (IFilterItem | IFilterSet)[] = [];

    for (const item of filter.filterSet) {
      if ('filterSet' in item) {
        const nested = this.removeInvalidFilterItems(item, fieldMap);
        if (nested.filterSet.length > 0) {
          filterSet.push(nested);
        }
        continue;
      }

      const targetField = fieldMap.get(item.fieldId);
      if (!targetField) continue;

      const validOps = getValidFilterOperators({
        cellValueType: targetField.cellValueType as CellValueType,
        type: targetField.type as FieldType,
        isMultipleCellValue: targetField.isMultipleCellValue ?? undefined,
      });

      if ((validOps as string[]).includes(item.operator as string)) {
        filterSet.push(item);
      }
    }

    return { ...filter, filterSet };
  }
}
