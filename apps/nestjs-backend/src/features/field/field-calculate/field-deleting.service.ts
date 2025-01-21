import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { FieldOpBuilder, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Timing } from '../../../utils/timing';
import { TableIndexService } from '../../table/table-index.service';
import { FieldService } from '../field.service';
import { IFieldInstance, createFieldInstanceByRaw } from '../model/factory';
import { FieldSupplementService } from './field-supplement.service';

@Injectable()
export class FieldDeletingService {
  private logger = new Logger(FieldDeletingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly tableIndexService: TableIndexService,
    private readonly fieldSupplementService: FieldSupplementService
  ) {}

  private async markFieldsAsError(tableId: string, fieldIds: string[]) {
    const opData = fieldIds.map((fieldId) => ({
      fieldId,
      ops: [
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'hasError',
          oldValue: undefined,
          newValue: true,
        }),
      ],
    }));
    await this.fieldService.batchUpdateFields(tableId, opData);
  }

  async cleanLookupRollupRef(tableId: string, fieldId: string) {
    const errorLookupFieldIds =
      await this.fieldSupplementService.deleteLookupFieldReference(fieldId);
    await this.markFieldsAsError(tableId, errorLookupFieldIds);
  }

  async cleanRef(field: IFieldInstance) {
    const errorRefFieldIds = await this.fieldSupplementService.deleteReference(field.id);
    const errorLookupFieldIds =
      !field.isLookup &&
      field.type === FieldType.Link &&
      (await this.fieldSupplementService.deleteLookupFieldReference(field.id));

    const errorFieldIds = errorRefFieldIds.concat(errorLookupFieldIds || []);

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: errorFieldIds } },
      select: { id: true, tableId: true },
    });

    for (const fieldRaw of fieldRaws) {
      const { id, tableId } = fieldRaw;
      await this.markFieldsAsError(tableId, [id]);
    }
  }

  async deleteFieldItem(tableId: string, field: IFieldInstance) {
    await this.cleanRef(field);
    await this.fieldService.batchDeleteFields(tableId, [field.id]);
  }

  async getField(tableId: string, fieldId: string): Promise<IFieldInstance | null> {
    const fieldRaw = await this.prismaService.field.findFirst({
      where: { tableId, id: fieldId, deletedTime: null },
    });
    return fieldRaw && createFieldInstanceByRaw(fieldRaw);
  }

  @Timing()
  async alterDeleteField(
    tableId: string,
    field: IFieldInstance
  ): Promise<{ tableId: string; fieldId: string }[]> {
    const { id: fieldId, type, isLookup, isPrimary } = field;

    // forbid delete primary field
    if (isPrimary) {
      throw new ForbiddenException(`forbid delete primary field`);
    }

    // delete index first
    await this.tableIndexService.deleteSearchFieldIndex(tableId, field);

    if (type === FieldType.Link && !isLookup) {
      const linkFieldOptions = field.options;
      const { foreignTableId, symmetricFieldId } = linkFieldOptions;
      await this.fieldSupplementService.cleanForeignKey(linkFieldOptions);
      await this.deleteFieldItem(tableId, field);

      if (symmetricFieldId) {
        const symmetricField = await this.getField(foreignTableId, symmetricFieldId);
        symmetricField && (await this.deleteFieldItem(foreignTableId, symmetricField));
        return [
          { tableId, fieldId },
          { tableId: foreignTableId, fieldId: symmetricFieldId },
        ];
      }
      return [{ tableId, fieldId }];
    }

    await this.deleteFieldItem(tableId, field);
    return [{ tableId, fieldId }];
  }
}
