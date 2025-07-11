import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldOpBuilder, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { difference, keyBy } from 'lodash';
import { Timing } from '../../../utils/timing';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
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
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService
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

  async resetLinkFieldLookupFieldId(
    fieldIds: string[],
    lookupedTableId: string,
    lookupedFieldId: string
  ) {
    const prisma = this.prismaService.txClient();
    const lookupedPrimaryField = await prisma.field.findFirst({
      where: { tableId: lookupedTableId, isPrimary: true },
      select: { id: true },
    });

    if (!lookupedPrimaryField) {
      return [];
    }

    const fieldRaws = await prisma.field.findMany({
      where: {
        id: { in: fieldIds },
        type: FieldType.Link,
        deletedTime: null,
      },
    });

    const toSetLookupFieldId = lookupedPrimaryField.id;

    const fieldRawMap = keyBy(fieldRaws, 'id');

    const fieldInstances = fieldRaws
      .filter((field) => field.type === FieldType.Link && !field.isLookup)
      .map((field) => createFieldInstanceByRaw(field))
      .filter((field) => {
        const option = field.options as ILinkFieldOptions;
        return (
          option.foreignTableId === lookupedTableId && option.lookupFieldId === lookupedFieldId
        );
      });

    for (const field of fieldInstances) {
      const options = field.options as ILinkFieldOptions;
      const newOption = {
        ...options,
        lookupFieldId: toSetLookupFieldId,
      };
      const opData = [
        {
          fieldId: field.id,
          ops: [
            FieldOpBuilder.editor.setFieldProperty.build({
              key: 'options',
              oldValue: options,
              newValue: newOption,
            }),
          ],
        },
      ];

      await this.fieldService.batchUpdateFields(fieldRawMap[field.id].tableId, opData);

      const reference = await this.prismaService.txClient().reference.findFirst({
        where: {
          fromFieldId: toSetLookupFieldId,
          toFieldId: field.id,
        },
      });

      if (!reference) {
        await this.prismaService.txClient().reference.create({
          data: {
            fromFieldId: toSetLookupFieldId,
            toFieldId: field.id,
          },
        });
      }

      await this.fieldCalculationService.calculateFields(fieldRawMap[field.id].tableId, [field.id]);
    }

    return fieldInstances.map((field) => field.id);
  }

  async cleanRef(tableId: string, field: IFieldInstance) {
    const errorRefFieldIds = await this.fieldSupplementService.deleteReference(field.id);

    const resetLinkFieldIds = await this.resetLinkFieldLookupFieldId(
      errorRefFieldIds,
      tableId,
      field.id
    );

    const errorLookupFieldIds =
      !field.isLookup &&
      field.type === FieldType.Link &&
      (await this.fieldSupplementService.deleteLookupFieldReference(field.id));
    const errorFieldIds = difference(errorRefFieldIds, resetLinkFieldIds).concat(
      errorLookupFieldIds || []
    );
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
    await this.cleanRef(tableId, field);
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
