import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ILinkCellValue, ILinkFieldOptions, IOtOperation } from '@teable/core';
import {
  Relationship,
  RelationshipRevert,
  FieldType,
  RecordOpBuilder,
  isMultiValueLink,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { groupBy, isEqual } from 'lodash';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { LinkService } from '../../calculation/link.service';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
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

const isLink = (field: IFieldInstance): field is LinkFieldDto =>
  !field.isLookup && field.type === FieldType.Link;

@Injectable()
export class FieldConvertingLinkService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly linkService: LinkService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService
  ) {}

  private async symLinkRelationshipChange(newField: LinkFieldDto) {
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

  private async alterSymmetricFieldChange(
    tableId: string,
    oldField: LinkFieldDto,
    newField: LinkFieldDto
  ) {
    // noting change
    if (
      (!newField.options.symmetricFieldId && !oldField.options.symmetricFieldId) ||
      newField.options.symmetricFieldId === oldField.options.symmetricFieldId
    ) {
      return;
    }

    // delete old symmetric link
    if (oldField.options.symmetricFieldId) {
      const { foreignTableId, symmetricFieldId } = oldField.options;
      const symField = await this.fieldDeletingService.getField(foreignTableId, symmetricFieldId);
      symField && (await this.fieldDeletingService.deleteFieldItem(foreignTableId, symField));
    }

    // create new symmetric link
    if (newField.options.symmetricFieldId) {
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        newField
      );
      await this.fieldCreatingService.createFieldItem(
        newField.options.foreignTableId,
        symmetricField
      );
    }
  }

  private async linkOptionsChange(tableId: string, newField: LinkFieldDto, oldField: LinkFieldDto) {
    if (
      newField.options.foreignTableId === oldField.options.foreignTableId &&
      newField.options.relationship === oldField.options.relationship &&
      newField.options.symmetricFieldId === oldField.options.symmetricFieldId
    ) {
      return;
    }

    // change link table, delete link in old table and create link in new table
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
      // change relationship, alter foreign key
    } else if (newField.options.relationship !== oldField.options.relationship) {
      await this.fieldSupplementService.cleanForeignKey(oldField.options);
      await this.fieldSupplementService.createForeignKey(newField.options);
    }

    // change one-way to two-way or two-way to one-way (symmetricFieldId add or delete, symmetricFieldId can not be change)
    await this.alterSymmetricFieldChange(tableId, oldField, newField);
  }

  private async otherToLink(tableId: string, newField: LinkFieldDto) {
    await this.fieldSupplementService.createForeignKey(newField.options);
    await this.fieldSupplementService.createReference(newField);
    if (newField.options.symmetricFieldId) {
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        newField
      );
      await this.fieldCreatingService.createFieldItem(
        newField.options.foreignTableId,
        symmetricField
      );
    }
  }

  private async linkToOther(tableId: string, oldField: LinkFieldDto) {
    await this.fieldDeletingService.cleanLookupRollupRef(tableId, oldField.id);
    await this.fieldSupplementService.cleanForeignKey(oldField.options);

    if (oldField.options.symmetricFieldId) {
      const { foreignTableId, symmetricFieldId } = oldField.options;
      const symField = await this.fieldDeletingService.getField(foreignTableId, symmetricFieldId);
      symField && (await this.fieldDeletingService.deleteFieldItem(foreignTableId, symField));
    }
  }

  /**
   * 1. switch link table
   * 2. other field to link field
   * 3. link field to other field
   */
  async deleteOrCreateSupplementLink(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
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

  async analysisReference(oldField: IFieldInstance) {
    if (!isLink(oldField)) {
      return;
    }

    // self and symmetricLinkField outgoing reference
    const linkFieldIds = [oldField.id];
    if (oldField.options.symmetricFieldId) {
      linkFieldIds.push(oldField.options.symmetricFieldId);
    }

    // LookupField and Rollup field witch linkFieldId is self and symmetricLinkField, should also treat as reference
    const lookupRelatedFields = await this.prismaService.txClient().field.findMany({
      where: {
        lookupLinkedFieldId: { in: linkFieldIds },
        deletedTime: null,
      },
      select: { id: true },
    });

    const references: string[] = lookupRelatedFields.map((field) => field.id);

    const referencesRaw = await this.prismaService.txClient().reference.findMany({
      where: {
        fromFieldId: { in: linkFieldIds },
      },
      select: {
        toFieldId: true,
      },
    });

    return references.concat(referencesRaw.map((r) => r.toFieldId));
  }

  async analysisSupplementLink(newField: IFieldInstance, oldField: IFieldInstance) {
    if (
      isLink(newField) &&
      isLink(oldField) &&
      !isEqual(newField.options, oldField.options) &&
      newField.options.foreignTableId === oldField.options.foreignTableId &&
      newField.options.symmetricFieldId &&
      newField.options.symmetricFieldId === oldField.options.symmetricFieldId &&
      newField.options.relationship !== oldField.options.relationship
    ) {
      return this.symLinkRelationshipChange(newField);
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

  async oneWayToTwoWay(newField: LinkFieldDto) {
    const { foreignTableId, relationship, symmetricFieldId } = newField.options;
    const foreignKeys = await this.linkService.getAllForeignKeys(newField.options);
    const foreignKeyMap = groupBy(foreignKeys, 'foreignId');

    const opsMap: {
      [recordId: string]: IOtOperation[];
    } = {};

    Object.keys(foreignKeyMap).forEach((foreignId) => {
      const ids = foreignKeyMap[foreignId].map((item) => item.id);
      // relational behavior needs to be reversed
      if (relationship === Relationship.ManyMany || relationship === Relationship.OneMany) {
        opsMap[foreignId] = [
          RecordOpBuilder.editor.setRecord.build({
            fieldId: symmetricFieldId as string,
            newCellValue: { id: ids[0] },
            oldCellValue: null,
          }),
        ];
      }

      if (relationship === Relationship.OneOne || relationship === Relationship.ManyOne) {
        opsMap[foreignId] = [
          RecordOpBuilder.editor.setRecord.build({
            fieldId: symmetricFieldId as string,
            newCellValue: ids.map((id) => ({ id })),
            oldCellValue: null,
          }),
        ];
      }
    });

    return { [foreignTableId]: opsMap };
  }

  async modifyLinkOptions(tableId: string, newField: LinkFieldDto, oldField: LinkFieldDto) {
    if (
      newField.options.foreignTableId === oldField.options.foreignTableId &&
      newField.options.relationship === oldField.options.relationship &&
      newField.options.symmetricFieldId &&
      !newField.options.isOneWay &&
      oldField.options.isOneWay
    ) {
      return this.oneWayToTwoWay(newField);
    }
    return this.convertLink(tableId, newField, oldField);
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

    return recordOpsMap;
  }
}
