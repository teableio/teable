import { Injectable, Logger } from '@nestjs/common';
import { FieldType, type ILinkFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityIssue } from '@teable/openapi';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';

@Injectable()
export class LinkFieldIntegrityService {
  private readonly logger = new Logger(LinkFieldIntegrityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  async getIssues(tableId: string, field: LinkFieldDto): Promise<IIntegrityIssue[]> {
    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { name: true, dbTableName: true },
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
          fieldId: field.id,
          message: `Found ${inconsistentRecords.length} inconsistent links in fkHostTableName ${fkHostTableName} (TableName: ${table.name}, Field Name: ${field.name}, Field ID: ${field.id})`,
        },
      ];
    }

    return [];
  }

  private async checkLinks(params: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }) {
    const query = this.dbProvider.integrityQuery().checkLinks(params);
    return await this.prismaService.$queryRawUnsafe<{ id: string }[]>(query);
  }

  private async fixLinks(params: {
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
    const query = this.dbProvider.integrityQuery().fixLinks(params);
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

  async fix(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const field = await this.prismaService.field.findFirstOrThrow({
      where: { id: fieldId, type: FieldType.Link, isLookup: null, deletedTime: null },
    });

    const tableId = field.tableId;

    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
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
        fieldId,
        message: `Fixed ${totalFixed} inconsistent links for link field (Field Name: ${field.name}, Field ID: ${field.id})`,
      };
    }
  }
}
