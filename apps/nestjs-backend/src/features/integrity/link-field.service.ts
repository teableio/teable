import { Injectable, Logger } from '@nestjs/common';
import { FieldType, type ILinkFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityIssue } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';

@Injectable()
export class LinkFieldIntegrityService {
  private readonly logger = new Logger(LinkFieldIntegrityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getIssues(tableId: string, field: LinkFieldDto): Promise<IIntegrityIssue[]> {
    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { fkHostTableName, foreignKeyName, selfKeyName } = field.options;
    const inconsistentRecords = await this.checkLinks({
      dbTableName: table.dbTableName,
      fkHostTableName,
      selfKeyName,
      foreignKeyName,
      linkDbFieldName: field.dbFieldName,
      isMultiValue: Boolean(field.isMultipleCellValue),
    });

    if (inconsistentRecords.length > 0) {
      return [
        {
          type: IntegrityIssueType.InvalidLinkReference,
          message: `Found ${inconsistentRecords.length} inconsistent links in table ${fkHostTableName} (Field Name: ${field.name}, Field ID: ${field.id})`,
        },
      ];
    }

    return [];
  }

  private async checkLinks({
    dbTableName,
    fkHostTableName,
    selfKeyName,
    foreignKeyName,
    linkDbFieldName,
    isMultiValue,
  }: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }) {
    if (isMultiValue) {
      const fkGroupedQuery = this.knex(fkHostTableName)
        .select({
          [selfKeyName]: selfKeyName,
          fk_ids: this.knex.raw(`string_agg(??, ',' ORDER BY ??)`, [
            this.knex.ref(foreignKeyName),
            this.knex.ref(foreignKeyName),
          ]),
        })
        .whereNotNull(selfKeyName)
        .groupBy(selfKeyName)
        .as('fk_grouped');
      const thisKnex = this.knex;
      const query = this.knex(dbTableName)
        .leftJoin(fkGroupedQuery, `${dbTableName}.__id`, `fk_grouped.${selfKeyName}`)
        .select({
          id: '__id',
        })
        .where(function () {
          this.whereNull(`fk_grouped.${selfKeyName}`)
            .whereNotNull(linkDbFieldName)
            .orWhere(function () {
              this.whereNotNull(linkDbFieldName).andWhereRaw(
                `"fk_grouped".fk_ids != (
                  SELECT string_agg(id, ',' ORDER BY id)
                  FROM (
                      SELECT (link->>'id')::text as id
                      FROM jsonb_array_elements(??::jsonb) as link
                  ) t
                )`,
                [thisKnex.ref(linkDbFieldName)]
              );
            });
        })
        .toQuery();

      return await this.prismaService.$queryRawUnsafe<
        {
          id: string;
        }[]
      >(query);
    }

    if (fkHostTableName === dbTableName) {
      const query = this.knex(dbTableName)
        .select({
          id: '__id',
        })
        .where(function () {
          this.whereNull(foreignKeyName)
            .whereNotNull(linkDbFieldName)
            .orWhere(function () {
              this.whereNotNull(linkDbFieldName).andWhereRaw(
                `("${linkDbFieldName}"->>'id')::text != "${foreignKeyName}"::text`
              );
            });
        })
        .toQuery();

      return await this.prismaService.$queryRawUnsafe<
        {
          id: string;
        }[]
      >(query);
    }

    if (dbTableName === fkHostTableName) {
      const query = this.knex(`${dbTableName} as t1`)
        .select({
          id: 't1.__id',
        })
        .leftJoin(`${dbTableName} as t2`, 't2.' + foreignKeyName, 't1.__id')
        .where(function () {
          this.whereNull('t2.' + foreignKeyName)
            .whereNotNull('t1.' + linkDbFieldName)
            .orWhere(function () {
              this.whereNotNull('t1.' + linkDbFieldName).andWhereRaw(
                `("t1"."${linkDbFieldName}"->>'id')::text != "t2"."${foreignKeyName}"::text`
              );
            });
        })
        .toQuery();

      return await this.prismaService.$queryRawUnsafe<
        {
          id: string;
        }[]
      >(query);
    }

    const query = this.knex(`${dbTableName} as t1`)
      .select({
        id: 't1.__id',
      })
      .leftJoin(`${fkHostTableName} as t2`, 't2.' + selfKeyName, 't1.__id')
      .where(function () {
        this.whereNull('t2.' + foreignKeyName)
          .whereNotNull('t1.' + linkDbFieldName)
          .orWhere(function () {
            this.whereNotNull('t1.' + linkDbFieldName).andWhereRaw(
              `("t1"."${linkDbFieldName}"->>'id')::text != "t2"."${foreignKeyName}"::text`
            );
          });
      })
      .toQuery();

    return await this.prismaService.$queryRawUnsafe<
      {
        id: string;
      }[]
    >(query);
  }

  private async fixLinks({
    recordIds,
    dbTableName,
    foreignDbTableName,
    fkHostTableName,
    lookupDbFieldName,
    selfKeyName,
    foreignKeyName,
    linkDbFieldName,
    isMultiValue,
  }: {
    recordIds: string[];
    dbTableName: string;
    foreignDbTableName: string;
    fkHostTableName: string;
    lookupDbFieldName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }) {
    if (isMultiValue) {
      const query = this.knex(dbTableName)
        .update({
          [linkDbFieldName]: this.knex
            .select(
              this.knex.raw("jsonb_agg(jsonb_build_object('id', ??, 'title', ??) ORDER BY ??)", [
                `fk.${foreignKeyName}`,
                `ft.${lookupDbFieldName}`,
                `fk.${foreignKeyName}`,
              ])
            )
            .from(`${fkHostTableName} as fk`)
            .join(`${foreignDbTableName} as ft`, `ft.__id`, `fk.${foreignKeyName}`)
            .where('fk.' + selfKeyName, `${dbTableName}.__id`),
        })
        .whereIn('__id', recordIds)
        .toQuery();

      return await this.prismaService.$executeRawUnsafe(query);
    }

    if (fkHostTableName === dbTableName) {
      // Handle self-referential single-value links
      const query = this.knex(dbTableName)
        .update({
          [linkDbFieldName]: this.knex.raw(
            `
            CASE
              WHEN ?? IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', ??,
                'title', ??
              )
            END
          `,
            [foreignKeyName, foreignKeyName, lookupDbFieldName]
          ),
        })
        .whereIn('__id', recordIds)
        .toQuery();

      return await this.prismaService.$executeRawUnsafe(query);
    }

    // Handle cross-table single-value links
    const query = this.knex(dbTableName)
      .update({
        [linkDbFieldName]: this.knex
          .select(
            this.knex.raw(
              `CASE
              WHEN t2.?? IS NULL THEN NULL
              ELSE jsonb_build_object('id', t2.??, 'title', t2.??)
            END`,
              [foreignKeyName, foreignKeyName, lookupDbFieldName]
            )
          )
          .from(`${fkHostTableName} as t2`)
          .where(`t2.${foreignKeyName}`, `${dbTableName}.__id`)
          .limit(1),
      })
      .whereIn('__id', recordIds)
      .toQuery();

    return await this.prismaService.$executeRawUnsafe(query);
  }

  private async checkAndFix(params: {
    dbTableName: string;
    foreignDbTableName: string;
    fkHostTableName: string;
    lookupDbFieldName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
    selfKeyName: string;
  }) {
    try {
      const inconsistentRecords = await this.checkLinks(params);

      if (inconsistentRecords.length > 0) {
        const recordIds = inconsistentRecords.map((record) => record.id);
        const updatedCount = await this.fixLinks({
          ...params,
          recordIds,
        });
        this.logger.debug(`Updated ${updatedCount} records in ${params.dbTableName}`);
        return updatedCount;
      }
      return 0;
    } catch (error) {
      this.logger.error('Error updating inconsistent links:', error);
      throw error;
    }
  }

  async fix(tableId: string, fieldId: string): Promise<IIntegrityIssue | undefined> {
    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const field = await this.prismaService.field.findFirstOrThrow({
      where: { id: fieldId, type: FieldType.Link, isLookup: null, deletedTime: null },
    });

    const linkField = createFieldInstanceByRaw(field) as LinkFieldDto;

    const lookupField = await this.prismaService.field.findFirstOrThrow({
      where: { id: linkField.options.lookupFieldId, deletedTime: null },
      select: { dbFieldName: true },
    });

    const foreignTable = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: linkField.options.foreignTableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const options = JSON.parse(field.options as string) as ILinkFieldOptions;
    const { fkHostTableName, foreignKeyName, selfKeyName } = options;

    let totalFixed = 0;

    // Add table links fixing
    const linksFixed = await this.checkAndFix({
      dbTableName: table.dbTableName,
      foreignDbTableName: foreignTable.dbTableName,
      fkHostTableName,
      lookupDbFieldName: lookupField.dbFieldName,
      foreignKeyName,
      linkDbFieldName: linkField.dbFieldName,
      isMultiValue: Boolean(linkField.isMultipleCellValue),
      selfKeyName,
    });

    totalFixed += linksFixed;

    if (totalFixed > 0) {
      return {
        type: IntegrityIssueType.InvalidLinkReference,
        message: `Fixed ${totalFixed} inconsistent links for link field (Field Name: ${field.name}, Field ID: ${field.id})`,
      };
    }
  }
}
