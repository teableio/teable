import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable-group/core';
import { FieldOpBuilder, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { FieldService } from '../field.service';
import { FieldSupplementService } from './field-supplement.service';

@Injectable()
export class FieldDeletingService {
  private logger = new Logger(FieldDeletingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldBatchCalculationService: FieldCalculationService
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
    await this.cleanField(tableId, errorLookupFieldIds);
  }

  async cleanRef(tableId: string, fieldId: string, isLinkField?: boolean) {
    const errorRefFieldIds = await this.fieldSupplementService.deleteReference(fieldId);
    const errorLookupFieldIds =
      isLinkField && (await this.fieldSupplementService.deleteLookupFieldReference(fieldId));

    const errorFieldIds = errorLookupFieldIds
      ? errorRefFieldIds.concat(errorLookupFieldIds)
      : errorRefFieldIds;
    await this.markFieldsAsError(tableId, errorFieldIds);

    await this.cleanField(tableId, errorFieldIds.concat(fieldId));
  }

  async delateAndCleanRef(tableId: string, fieldId: string, isLinkField?: boolean) {
    await this.cleanRef(tableId, fieldId, isLinkField);
    await this.fieldService.batchDeleteFields(tableId, [fieldId]);
  }

  async cleanField(tableId: string, fieldIds: string[]) {
    await this.fieldBatchCalculationService.calculateFields(tableId, fieldIds, true);
  }

  async deleteField(tableId: string, fieldId: string) {
    const { type, isLookup, options } = await this.prismaService
      .txClient()
      .field.findUniqueOrThrow({
        where: { id: fieldId },
        select: { type: true, isLookup: true, options: true },
      })
      .catch(() => {
        throw new NotFoundException(`field ${fieldId} not found`);
      });

    if (type === FieldType.Link && !isLookup) {
      const linkFieldOptions: ILinkFieldOptions = JSON.parse(options as string);
      const { foreignTableId, symmetricFieldId } = linkFieldOptions;
      await this.fieldSupplementService.cleanForeignKey(linkFieldOptions);
      await this.delateAndCleanRef(tableId, fieldId, true);
      if (symmetricFieldId) {
        await this.delateAndCleanRef(foreignTableId, symmetricFieldId, true);
      }
      return;
    }
    await this.delateAndCleanRef(tableId, fieldId);
  }
}
