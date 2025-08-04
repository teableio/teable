import { Injectable } from '@nestjs/common';
import { FieldType, type IFormulaConversionContext } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { FieldSelectVisitor } from '../../field/field-select-visitor';
import type { IFieldInstance } from '../../field/model/factory';
import type { IRecordQueryBuilder, IRecordQueryParams } from './record-query-builder.interface';

/**
 * Service for building table record queries
 * This service encapsulates the logic for creating Knex query builders
 * with proper field selection using the visitor pattern
 */
@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  /**
   * Build a query builder with select fields for the given table and fields
   */
  buildQuery(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    viewId: string | undefined,
    fields: IFieldInstance[]
  ): Knex.QueryBuilder {
    const params: IRecordQueryParams = {
      tableId,
      viewId,
      fields,
      queryBuilder,
    };

    return this.buildQueryWithParams(params);
  }

  /**
   * Build query with detailed parameters
   */
  private buildQueryWithParams(params: IRecordQueryParams): Knex.QueryBuilder {
    const { fields, queryBuilder } = params;

    // Build formula conversion context
    const context = this.buildFormulaContext(fields);

    // Build select fields
    return this.buildSelect(queryBuilder, fields, context);
  }

  /**
   * Build select fields using visitor pattern
   */
  private buildSelect(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    context: IFormulaConversionContext
  ): Knex.QueryBuilder {
    const visitor = new FieldSelectVisitor(this.knex, qb, this.dbProvider, context);

    // Add default system fields
    qb.select(['__id', '__version', '__created_time', '__last_modified_time']);

    // Add field-specific selections using visitor pattern
    for (const field of fields) {
      field.accept(visitor);
    }

    return qb;
  }

  /**
   * Get database table name for a given table ID
   */
  private async getDbTableName(tableId: string): Promise<string> {
    const table = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    return table.dbTableName;
  }

  /**
   * Build formula conversion context from fields
   */
  private buildFormulaContext(fields: IFieldInstance[]): IFormulaConversionContext {
    const fieldMap = new Map();
    fields.forEach((field) => {
      fieldMap.set(field.id, field);
    });
    return {
      fieldMap,
    };
  }
}
