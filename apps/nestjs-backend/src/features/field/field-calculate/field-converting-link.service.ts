import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ILinkCellValue, ILinkFieldOptions, ITinyRecord } from '@teable-group/core';
import {
  Relationship,
  RelationshipRevert,
  FieldType,
  generateRecordId,
  RecordOpBuilder,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { isEmpty, isEqual } from 'lodash';
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

  private async generateSymmetricFieldChange(linkField: LinkFieldDto) {
    const fieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: linkField.options.symmetricFieldId, deletedTime: null },
    });
    const oldField = createFieldInstanceByRaw(fieldRaw);
    const newFieldVo = rawField2FieldObj(fieldRaw);

    const options = newFieldVo.options as ILinkFieldOptions;
    options.relationship = RelationshipRevert[linkField.options.relationship];
    options.dbForeignKeyName = linkField.options.dbForeignKeyName;
    newFieldVo.isMultipleCellValue = options.relationship !== Relationship.ManyOne || undefined;

    return {
      tableId: linkField.options.foreignTableId,
      newField: createFieldInstanceByVo(newFieldVo),
      oldField,
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
      await this.fieldSupplementService.cleanForeignKey(tableId, oldField.options);
      // create new symmetric link
      await this.fieldSupplementService.createForeignKey(tableId, newField);
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        newField
      );
      await this.fieldCreatingService.createAndCalculate(
        newField.options.foreignTableId,
        symmetricField
      );

      // delete old symmetric link
      await this.fieldDeletingService.delateAndCleanRef(
        oldField.options.foreignTableId,
        oldField.options.symmetricFieldId
      );
      return;
    }

    if (newField.options.relationship !== oldField.options.relationship) {
      await this.fieldSupplementService.cleanForeignKey(tableId, oldField.options);
      // create new symmetric link
      await this.fieldSupplementService.createForeignKey(tableId, newField);
      await this.fieldDeletingService.cleanField(newField.options.foreignTableId, [
        newField.options.symmetricFieldId,
      ]);

      return this.generateSymmetricFieldChange(newField);
    }
  }

  private async otherToLink(tableId: string, newField: LinkFieldDto) {
    await this.fieldSupplementService.createForeignKey(tableId, newField);
    const symmetricField = await this.fieldSupplementService.generateSymmetricField(
      tableId,
      newField
    );
    await this.fieldSupplementService.createReference(newField);
    await this.fieldCreatingService.createAndCalculate(
      newField.options.foreignTableId,
      symmetricField
    );
  }

  private async linkToOther(tableId: string, oldField: LinkFieldDto) {
    await this.fieldDeletingService.cleanRef(tableId, oldField.id, true);

    await this.fieldDeletingService.delateAndCleanRef(
      oldField.options.foreignTableId,
      oldField.options.symmetricFieldId,
      true
    );
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
    if (
      newField.type === FieldType.Link &&
      oldField.type === FieldType.Link &&
      !isEqual(newField.options, oldField.options)
    ) {
      return this.linkOptionsChange(tableId, newField, oldField);
    }

    if (newField.type !== FieldType.Link && oldField.type === FieldType.Link) {
      return this.linkToOther(tableId, oldField);
    }

    if (newField.type === FieldType.Link && oldField.type !== FieldType.Link) {
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
    const foreignRecords = await this.getRecords(foreignTableId, lookupField);

    const primaryNameToIdMap = foreignRecords.reduce<{ [name: string]: string }>((pre, record) => {
      const str = lookupField.cellValue2String(record.fields[lookupField.id]);
      pre[str] = record.id;
      return pre;
    }, {});

    const recordOpsMap: IOpsMap = { [tableId]: {}, [foreignTableId]: {} };
    const recordsForCreate: { [title: string]: ITinyRecord } = {};
    const checkSet = new Set<string>();
    // eslint-disable-next-line sonarjs/cognitive-complexity
    records.forEach((record) => {
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
        if (newField.options.relationship !== Relationship.OneMany) {
          return newCellValue.push(linkCell);
        }
        // OneMany relationship only allow link to one same recordId
        if (checkSet.has(linkCell.id)) return;
        checkSet.add(linkCell.id);
        return newCellValue.push(linkCell);
      }

      newCellValueTitle.forEach((title) => {
        if (primaryNameToIdMap[title]) {
          pushNewCellValue({ id: primaryNameToIdMap[title], title });
          return;
        }

        // do not create record if lookup field is computed
        if (lookupField.isComputed) {
          return;
        }

        const cv = lookupField.convertStringToCellValue(title);

        // do not create record if title string in lookup field is not valid
        if (cv == null) {
          return;
        }

        // convert cv back to string make sure it display well
        // example: '1.03' convertStringToCellValue 1.0 cellValue2String '1.0'
        title = lookupField.cellValue2String(cv);

        if (!recordsForCreate[title]) {
          const newRecordId = generateRecordId();
          recordsForCreate[title] = {
            id: newRecordId,
            fields: {
              [lookupField.id]: cv,
            },
          };
        }
        pushNewCellValue({ id: recordsForCreate[title].id, title });
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
      recordsForCreate: isEmpty(recordsForCreate)
        ? undefined
        : { [foreignTableId]: recordsForCreate },
    };
  }
}
