import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import {
  Relationship,
  RelationshipRevert,
  FieldType,
  RecordOpBuilder,
  isMultiValueLink,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { isEqual } from 'lodash';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import type { IOpsMap } from '../../calculation/reference.service';
import type { IFieldInstance } from '../model/factory';
import {
  createFieldInstanceByVo,
  createFieldInstanceByRaw,
  rawField2FieldObj,
} from '../model/factory';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';
import { FieldSupplementService } from './field-supplement.service';

@Injectable()
export class FieldConvertingLinkService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService
  ) {}

  private async generateSymmetricFieldChange(
    tableId: string,
    oldField: LinkFieldDto,
    newField: LinkFieldDto
  ) {
    // noting change
    if (!newField.options.symmetricFieldId && !oldField.options.symmetricFieldId) {
      return;
    }

    // delete old symmetric link
    if (oldField.options.symmetricFieldId !== newField.options.symmetricFieldId) {
      if (oldField.options.symmetricFieldId) {
        await this.fieldDeletingService.delateAndCleanRef(
          oldField.options.foreignTableId,
          oldField.options.symmetricFieldId
        );
      }
      if (newField.options.symmetricFieldId) {
        const symmetricField = await this.fieldSupplementService.generateSymmetricField(
          tableId,
          newField
        );
        await this.fieldCreatingService.createAndCalculate(
          newField.options.foreignTableId,
          symmetricField
        );
      }
      return;
    }

    // field options has been modified but symmetricFieldId not change
    const fieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: newField.options.symmetricFieldId, deletedTime: null },
    });

    const newFieldVo = rawField2FieldObj(fieldRaw);

    const options = newFieldVo.options as ILinkFieldOptions;
    options.relationship = RelationshipRevert[newField.options.relationship];
    options.fkHostTableName = newField.options.fkHostTableName;
    options.selfKeyName = newField.options.foreignKeyName;
    options.foreignKeyName = newField.options.selfKeyName;
    newFieldVo.isMultipleCellValue = isMultiValueLink(options.relationship) || undefined;

    // return modified changes in foreignTable
    return {
      tableId: newField.options.foreignTableId,
      newField: createFieldInstanceByVo(newFieldVo),
      oldField: createFieldInstanceByRaw(fieldRaw),
    };
  }

  private async linkOptionsChange(tableId: string, newField: LinkFieldDto, oldField: LinkFieldDto) {
    if (
      newField.options.foreignTableId === oldField.options.foreignTableId &&
      newField.options.relationship === oldField.options.relationship
    ) {
      throw new Error('only support modify link foreignTableId or relationship');
    }

    if (newField.options.foreignTableId !== oldField.options.foreignTableId) {
      // update current field reference
      await this.prismaService.txClient().reference.deleteMany({
        where: {
          toFieldId: newField.id,
        },
      });
      await this.fieldSupplementService.createReference(newField);
      await this.fieldSupplementService.cleanForeignKey(oldField.options);
      await this.fieldDeletingService.cleanLookupRollupRef(tableId, newField.id);

      await this.fieldSupplementService.createForeignKey(newField.options);
    } else if (newField.options.relationship !== oldField.options.relationship) {
      await this.fieldSupplementService.cleanForeignKey(oldField.options);
      // create new symmetric link
      await this.fieldSupplementService.createForeignKey(newField.options);
    }

    return this.generateSymmetricFieldChange(tableId, oldField, newField);
  }

  private async otherToLink(tableId: string, newField: LinkFieldDto) {
    await this.fieldSupplementService.createForeignKey(newField.options);
    await this.fieldSupplementService.createReference(newField);
    if (newField.options.symmetricFieldId) {
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        newField
      );
      await this.fieldCreatingService.createAndCalculate(
        newField.options.foreignTableId,
        symmetricField
      );
    }
  }

  private async linkToOther(tableId: string, oldField: LinkFieldDto) {
    await this.fieldDeletingService.cleanLookupRollupRef(tableId, oldField.id);

    if (oldField.options.symmetricFieldId) {
      await this.fieldDeletingService.delateAndCleanRef(
        oldField.options.foreignTableId,
        oldField.options.symmetricFieldId,
        true
      );
    }
  }

  /**
   * 1. switch link table
   * 2. other field to link field
   * 3. link field to other field
   */
  async supplementLink(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<{ tableId: string; newField: IFieldInstance; oldField: IFieldInstance } | void> {
    const isLink = (field: IFieldInstance): field is LinkFieldDto =>
      !field.isLookup && field.type === FieldType.Link;

    if (isLink(newField) && isLink(oldField) && !isEqual(newField.options, oldField.options)) {
      return this.linkOptionsChange(tableId, newField, oldField);
    }

    if (!isLink(newField) && isLink(oldField)) {
      return this.linkToOther(tableId, oldField);
    }

    if (isLink(newField) && !isLink(oldField)) {
      return this.otherToLink(tableId, newField);
    }
  }

  private async getRecords(tableId: string, field: IFieldInstance) {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const result = await this.fieldCalculationService.getRecordsBatchByFields({
      [dbTableName]: [field],
    });
    const records = result[dbTableName];
    if (!records) {
      throw new InternalServerErrorException(
        `Can't find recordMap for tableId: ${tableId} and fieldId: ${field.id}`
      );
    }

    return records;
  }

  /**
   * convert oldCellValue to new link field cellValue
   * if oldCellValue is not in foreignTable, create new record in foreignTable
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async convertLink(tableId: string, newField: LinkFieldDto, oldField: IFieldInstance) {
    const fieldId = newField.id;
    const foreignTableId = newField.options.foreignTableId;
    const lookupFieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: newField.options.lookupFieldId, deletedTime: null },
    });
    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);

    const records = await this.getRecords(tableId, oldField);
    // TODO: should not get all records in foreignTable, only get records witch title is not exist in candidate records link cell value title
    const foreignRecordMap = await this.getRecords(foreignTableId, lookupField);

    const primaryNameToIdMap = Object.values(foreignRecordMap).reduce<{ [name: string]: string }>(
      (pre, record) => {
        const str = lookupField.cellValue2String(record.fields[lookupField.id]);
        pre[str] = record.id;
        return pre;
      },
      {}
    );

    const recordOpsMap: IOpsMap = { [tableId]: {}, [foreignTableId]: {} };
    const checkSet = new Set<string>();
    // eslint-disable-next-line sonarjs/cognitive-complexity
    Object.values(records).forEach((record) => {
      const oldCellValue = record.fields[fieldId];
      if (oldCellValue == null) {
        return;
      }
      let newCellValueTitle: string[];
      if (newField.isMultipleCellValue) {
        newCellValueTitle = oldField.isMultipleCellValue
          ? (oldCellValue as unknown[]).map((item) => oldField.item2String(item))
          : oldField.item2String(oldCellValue).split(', ');
      } else {
        newCellValueTitle = oldField.isMultipleCellValue
          ? [oldField.item2String((oldCellValue as unknown[])[0])]
          : [oldField.item2String(oldCellValue).split(', ')[0]];
      }

      const newCellValue: ILinkCellValue[] = [];
      function pushNewCellValue(linkCell: ILinkCellValue) {
        // OneMany and OneOne relationship only allow link to one same recordId
        if (
          newField.options.relationship === Relationship.OneMany ||
          newField.options.relationship === Relationship.OneOne
        ) {
          if (checkSet.has(linkCell.id)) return;
          checkSet.add(linkCell.id);
          return newCellValue.push(linkCell);
        }
        return newCellValue.push(linkCell);
      }

      newCellValueTitle.forEach((title) => {
        if (primaryNameToIdMap[title]) {
          pushNewCellValue({ id: primaryNameToIdMap[title], title });
        }
      });

      if (!recordOpsMap[tableId][record.id]) {
        recordOpsMap[tableId][record.id] = [];
      }
      recordOpsMap[tableId][record.id].push(
        RecordOpBuilder.editor.setRecord.build({
          fieldId,
          newCellValue: newField.isMultipleCellValue ? newCellValue : newCellValue[0],
          oldCellValue,
        })
      );
    });

    return {
      recordOpsMap,
    };
  }
}
