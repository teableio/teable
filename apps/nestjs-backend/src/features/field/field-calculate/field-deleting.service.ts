import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldOpBuilder, FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { difference, keyBy } from 'lodash';
import { CustomHttpException } from '../../../custom.exception';
import { Timing } from '../../../utils/timing';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { TableIndexService } from '../../table/table-index.service';
import { FieldService } from '../field.service';
import { IFieldInstance, createFieldInstanceByRaw } from '../model/factory';
import { FieldSupplementService } from './field-supplement.service';
import { FormulaFieldService } from './formula-field.service';

@Injectable()
export class FieldDeletingService {
  private logger = new Logger(FieldDeletingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly tableIndexService: TableIndexService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly formulaFieldService: FormulaFieldService
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

  /**
   * Cascade delete dependent formula fields
   * Uses FormulaFieldService to get all dependencies in topological order
   */
  private async cascadeDeleteFormulaFields(fieldId: string): Promise<string[]> {
    // Get all dependent formula fields in topological order (deepest first)
    const dependentFormulaFields =
      await this.formulaFieldService.getDependentFormulaFieldsInOrder(fieldId);

    if (dependentFormulaFields.length === 0) {
      return [];
    }

    this.logger.debug(
      `Found ${dependentFormulaFields.length} dependent formula fields to cascade delete: ${dependentFormulaFields.map((f) => `${f.id}(L${f.level})`).join(', ')}`
    );

    // Group fields by tableId and level for efficient batch deletion
    const fieldsByTableAndLevel = new Map<string, Map<number, string[]>>();

    for (const field of dependentFormulaFields) {
      if (!fieldsByTableAndLevel.has(field.tableId)) {
        fieldsByTableAndLevel.set(field.tableId, new Map());
      }
      const tableMap = fieldsByTableAndLevel.get(field.tableId)!;
      if (!tableMap.has(field.level)) {
        tableMap.set(field.level, []);
      }
      tableMap.get(field.level)!.push(field.id);
    }

    const deletedFieldIds: string[] = [];

    // Delete fields level by level (deepest first) and batch by table
    // Ensure each level is completely deleted before proceeding to the next level
    const allLevels = [...new Set(dependentFormulaFields.map((f) => f.level))].sort(
      (a, b) => b - a
    );

    for (const level of allLevels) {
      this.logger.debug(`Processing deletion for level ${level}`);

      // Collect all deletion promises for this level
      const levelDeletionPromises: Promise<void>[] = [];

      for (const [tableId, levelMap] of fieldsByTableAndLevel) {
        const fieldIdsAtLevel = levelMap.get(level);
        if (fieldIdsAtLevel && fieldIdsAtLevel.length > 0) {
          this.logger.debug(
            `Batch deleting ${fieldIdsAtLevel.length} formula fields at level ${level} in table ${tableId}: ${fieldIdsAtLevel.join(', ')}`
          );

          // Delete fields directly without triggering cleanRef to avoid recursion
          const deletionPromise = this.fieldService.batchDeleteFields(tableId, fieldIdsAtLevel);
          levelDeletionPromises.push(deletionPromise);
          deletedFieldIds.push(...fieldIdsAtLevel);
        }
      }

      // Wait for all deletions at this level to complete before proceeding to the next level
      if (levelDeletionPromises.length > 0) {
        await Promise.all(levelDeletionPromises);
        this.logger.debug(`Completed deletion for level ${level}`);
      }
    }

    return deletedFieldIds;
  }

  async cleanRef(tableId: string, field: IFieldInstance) {
    // 1. Cascade delete dependent formula fields before deleting references
    const deletedFormulaFieldIds = await this.cascadeDeleteFormulaFields(field.id);

    if (deletedFormulaFieldIds.length > 0) {
      this.logger.log(
        `Cascade deleted ${deletedFormulaFieldIds.length} formula fields: ${deletedFormulaFieldIds.join(', ')}`
      );
    }

    // 2. Delete reference relationships
    const errorRefFieldIds = await this.fieldSupplementService.deleteReference(field.id);

    // 3. Filter out fields that have already been cascade deleted
    const remainingErrorFieldIds = errorRefFieldIds.filter(
      (id) => !deletedFormulaFieldIds.includes(id)
    );

    const resetLinkFieldIds = await this.resetLinkFieldLookupFieldId(
      remainingErrorFieldIds,
      tableId,
      field.id
    );

    const errorLookupFieldIds =
      !field.isLookup &&
      field.type === FieldType.Link &&
      (await this.fieldSupplementService.deleteLookupFieldReference(field.id));
    const errorFieldIds = difference(remainingErrorFieldIds, resetLinkFieldIds).concat(
      errorLookupFieldIds || []
    );

    // 4. Mark remaining fields as error
    if (errorFieldIds.length > 0) {
      const fieldRaws = await this.prismaService.txClient().field.findMany({
        where: { id: { in: errorFieldIds } },
        select: { id: true, tableId: true },
      });

      for (const fieldRaw of fieldRaws) {
        const { id, tableId } = fieldRaw;
        await this.markFieldsAsError(tableId, [id]);
      }
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
      throw new CustomHttpException(
        `Forbid delete primary field`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.field.forbidDeletePrimaryField',
          },
        }
      );
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
