import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type {
  IFieldPropertyKey,
  IFieldVo,
  ILookupOptionsVo,
  IOtOperation,
  IUpdateFieldRo,
  ISelectFieldChoice,
  ITinyRecord,
} from '@teable-group/core';
import {
  ColorUtils,
  generateChoiceId,
  DbFieldType,
  Relationship,
  FieldKeyType,
  FIELD_VO_PROPERTIES,
  IdPrefix,
  RecordOpBuilder,
  FieldType,
  FieldOpBuilder,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import knex from 'knex';
import { differenceBy, intersection, isEmpty, isEqual, keyBy, set } from 'lodash';
import type { Connection } from 'sharedb/lib/client';
import { ShareDbService } from '../../../share-db/share-db.service';
import { BatchService } from '../../calculation/batch.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import type { ICellContext } from '../../calculation/link.service';
import { LinkService } from '../../calculation/link.service';
import { ReferenceService } from '../../calculation/reference.service';
import type { IOpsMap, IFieldMap, IFkOpMap } from '../../calculation/reference.service';
import { formatChangesToOps } from '../../calculation/utils/changes';
import { composeMaps } from '../../calculation/utils/compose-maps';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByVo } from '../model/factory';
import { FormulaFieldDto } from '../model/field-dto/formula-field.dto';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import type { MultipleSelectFieldDto } from '../model/field-dto/multiple-select-field.dto';
import type { RatingFieldDto } from '../model/field-dto/rating-field.dto';
import { RollupFieldDto } from '../model/field-dto/rollup-field.dto';
import type { SingleSelectFieldDto } from '../model/field-dto/single-select-field.dto';
import { FieldConvertingLinkService } from './field-converting-link.service';

interface IModifiedResult {
  recordOpsMap?: IOpsMap;
  fieldOps?: IOtOperation[];
  recordsForCreate?: { [tableId: string]: { [title: string]: ITinyRecord } };
}

interface IPropertyChange {
  key: string;
  value: unknown;
}

@Injectable()
export class FieldConvertingService {
  private logger = new Logger(FieldConvertingService.name);

  private readonly knex = knex({ client: 'sqlite3' });

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly linkService: LinkService,
    private readonly batchService: BatchService,
    private readonly referenceService: ReferenceService,
    private readonly shareDbService: ShareDbService,
    private readonly fieldConvertingLinkService: FieldConvertingLinkService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

  private fieldOpsMap() {
    const fieldOpsMap: IOpsMap = {};
    return {
      pushOpsMap: (tableId: string, fieldId: string, op: IOtOperation | IOtOperation[]) => {
        const ops = Array.isArray(op) ? op : [op];
        if (!fieldOpsMap[tableId]?.[fieldId]) {
          set(fieldOpsMap, [tableId, fieldId], ops);
        } else {
          fieldOpsMap[tableId][fieldId].push(...ops);
        }
      },
      getOpsMap: () => fieldOpsMap,
    };
  }

  private verifyLookupField(field: IFieldInstance, fieldMap: IFieldMap) {
    const lookupOptions = field.lookupOptions as ILookupOptionsVo;
    const linkField = fieldMap[lookupOptions.linkFieldId] as LinkFieldDto;
    if (!linkField) {
      return false;
    }
    if (lookupOptions.foreignTableId !== linkField.options.foreignTableId) {
      return false;
    }
    return Boolean(fieldMap[lookupOptions.lookupFieldId]);
  }

  /**
   * Mutate field instance directly, because we should update fieldInstance in fieldMap for next field operation
   */
  private buildOpAndMutateField(field: IFieldInstance, key: IFieldPropertyKey, value: unknown) {
    if (isEqual(field[key], value)) {
      return;
    }
    const oldValue = field[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (field[key] as any) = value;
    return FieldOpBuilder.editor.setFieldProperty.build({ key, oldValue, newValue: value });
  }

  // TODO: formatting should be validate before inherit
  /**
   * 1. check if the lookup field is valid, if not mark error
   * 2. update lookup field properties
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private updateLookupField(field: IFieldInstance, fieldMap: IFieldMap): IOtOperation[] {
    const ops: (IOtOperation | undefined)[] = [];
    if (!this.verifyLookupField(field, fieldMap)) {
      const op = this.buildOpAndMutateField(field, 'hasError', true);
      return op ? [op] : [];
    }
    const lookupOptions = field.lookupOptions as ILookupOptionsVo;
    const linkField = fieldMap[lookupOptions.linkFieldId] as LinkFieldDto;
    const lookupField = fieldMap[lookupOptions.lookupFieldId];
    const { formatting, showAs, ...inheritOptions } = field.options as Record<string, unknown>;
    const {
      formatting: _0,
      showAs: _1,
      ...inheritableOptions
    } = lookupField.options as Record<string, unknown>;
    const cellValueTypeChanged = field.cellValueType !== lookupField.cellValueType;

    if (field.type !== lookupField.type) {
      ops.push(this.buildOpAndMutateField(field, 'type', lookupField.type));
    }

    if (lookupOptions.relationship !== linkField.options.relationship) {
      ops.push(
        this.buildOpAndMutateField(field, 'lookupOptions', {
          ...lookupOptions,
          relationship: linkField.options.relationship,
          dbForeignKeyName: linkField.options.dbForeignKeyName,
        } as ILookupOptionsVo)
      );
    }

    if (!isEqual(inheritOptions, inheritableOptions)) {
      ops.push(
        this.buildOpAndMutateField(field, 'options', {
          ...inheritableOptions,
          ...(formatting ? { formatting } : {}),
          ...(showAs ? { showAs } : {}),
        })
      );
    }

    if (cellValueTypeChanged) {
      ops.push(this.buildOpAndMutateField(field, 'cellValueType', lookupField.cellValueType));
      if (formatting || showAs) {
        ops.push(this.buildOpAndMutateField(field, 'options', inheritableOptions));
      }
    }

    const isMultipleCellValue = lookupField.isMultipleCellValue || linkField.isMultipleCellValue;
    if (field.isMultipleCellValue !== isMultipleCellValue) {
      ops.push(this.buildOpAndMutateField(field, 'isMultipleCellValue', isMultipleCellValue));
      // clean showAs
      if (!cellValueTypeChanged && showAs) {
        ops.push(
          this.buildOpAndMutateField(field, 'options', {
            ...inheritableOptions,
            ...(formatting ? { formatting } : {}),
          })
        );
      }
    }

    return ops.filter(Boolean) as IOtOperation[];
  }

  private updateFormulaField(field: FormulaFieldDto, fieldMap: IFieldMap) {
    const ops: (IOtOperation | undefined)[] = [];
    const { cellValueType, isMultipleCellValue } = FormulaFieldDto.getParsedValueType(
      field.options.expression,
      fieldMap
    );

    if (field.cellValueType !== cellValueType) {
      ops.push(this.buildOpAndMutateField(field, 'cellValueType', cellValueType));
    }
    if (field.isMultipleCellValue !== isMultipleCellValue) {
      ops.push(this.buildOpAndMutateField(field, 'isMultipleCellValue', isMultipleCellValue));
    }
    return ops.filter(Boolean) as IOtOperation[];
  }

  private updateRollupField(field: RollupFieldDto, fieldMap: IFieldMap) {
    const ops: (IOtOperation | undefined)[] = [];
    const { lookupFieldId, relationship } = field.lookupOptions;
    const lookupField = fieldMap[lookupFieldId];
    const { cellValueType, isMultipleCellValue } = RollupFieldDto.getParsedValueType(
      field.options.expression,
      lookupField,
      lookupField.isMultipleCellValue || relationship !== Relationship.ManyOne
    );

    if (field.cellValueType !== cellValueType) {
      ops.push(this.buildOpAndMutateField(field, 'cellValueType', cellValueType));
    }
    if (field.isMultipleCellValue !== isMultipleCellValue) {
      ops.push(this.buildOpAndMutateField(field, 'isMultipleCellValue', isMultipleCellValue));
    }
    return ops.filter(Boolean) as IOtOperation[];
  }

  private async updateDbFieldType(dbTableName: string, field: IFieldInstance) {
    const ops: IOtOperation[] = [];
    const dbFieldType = this.fieldSupplementService.getDbFieldType(
      field.type,
      field.cellValueType,
      field.isMultipleCellValue
    );

    if (field.dbFieldType !== dbFieldType) {
      const op1 = this.buildOpAndMutateField(field, 'dbFieldType', dbFieldType);
      const op2 = this.buildOpAndMutateField(field, 'dbFieldName', field.dbFieldName + '_');
      op1 && ops.push(op1);
      op2 && ops.push(op2);
      await this.fieldService.alterVisualTable(dbTableName, [field]);
    }
    return ops;
  }

  private async generateReferenceFieldOps(fieldId: string) {
    const topoOrdersContext = await this.fieldCalculationService.getTopoOrdersContext([fieldId]);

    const { fieldMap, topoOrdersByFieldId, fieldId2TableId, tableId2DbTableName } =
      topoOrdersContext;
    const topoOrders = topoOrdersByFieldId[fieldId];
    if (topoOrders.length <= 1) {
      return {};
    }

    const { pushOpsMap, getOpsMap } = this.fieldOpsMap();

    for (let i = 1; i < topoOrders.length; i++) {
      const topoOrder = topoOrders[i];
      const curField = fieldMap[topoOrder.id];
      const tableId = fieldId2TableId[curField.id];
      const dbTableName = tableId2DbTableName[tableId];
      if (curField.isLookup) {
        pushOpsMap(tableId, curField.id, this.updateLookupField(curField, fieldMap));
      } else if (curField.type === FieldType.Formula) {
        pushOpsMap(tableId, curField.id, this.updateFormulaField(curField, fieldMap));
      } else if (curField.type === FieldType.Rollup) {
        pushOpsMap(tableId, curField.id, this.updateRollupField(curField, fieldMap));
      }
      const ops = await this.updateDbFieldType(dbTableName, curField);
      pushOpsMap(tableId, curField.id, ops);
    }

    return getOpsMap();
  }

  private getOptionsChanges(
    newOptions: Record<string, unknown>,
    oldOptions: Record<string, unknown>,
    valueTypeChange?: boolean
  ) {
    const optionsChanges: IPropertyChange[] = [];

    const nonInfectKeys = ['formatting', 'showAs'];
    const newOptionsKeys = Object.keys(newOptions || {}).filter((key) =>
      nonInfectKeys.includes(key)
    );
    const oldOptionsKeys = Object.keys(oldOptions || {}).filter((key) =>
      nonInfectKeys.includes(key)
    );

    const addedOptionsKeys = differenceBy(newOptionsKeys, oldOptionsKeys);
    const removedOptionsKeys = differenceBy(oldOptionsKeys, newOptionsKeys);
    const editedOptionsKeys = intersection(newOptionsKeys, addedOptionsKeys).filter(
      (key) => !isEqual(oldOptions[key], newOptions[key])
    );

    addedOptionsKeys.forEach((key) => optionsChanges.push({ key, value: newOptions }));
    editedOptionsKeys.forEach((key) => optionsChanges.push({ key, value: newOptions[key] }));
    removedOptionsKeys.forEach((key) => optionsChanges.push({ key, value: null }));

    // clean formatting, showAs when valueType change
    valueTypeChange && nonInfectKeys.forEach((key) => optionsChanges.push({ key, value: null }));

    return optionsChanges;
  }

  private infectPropertyChanged(newField: IFieldInstance, oldField: IFieldInstance) {
    // those key will infect the reference field
    const infectProperties = ['type', 'cellValueType', 'isMultipleCellValue'] as const;
    const changedProperties = infectProperties.filter(
      (key) => !isEqual(newField[key], oldField[key])
    );

    const valueTypeChanged = changedProperties.some((key) =>
      ['cellValueType', 'isMultipleCellValue'].includes(key)
    );

    // options may infect the lookup field
    const optionsChanges = this.getOptionsChanges(
      newField.options,
      oldField.options,
      valueTypeChanged
    );

    return Boolean(changedProperties.length || optionsChanges.length);
  }

  /**
   * modify a field will causes the properties of the field that depend on it to change
   * example：
   * 1. modify a field's type will cause the the lookup field's type change
   * 2. cellValueType / isMultipleCellValue change will cause the formula / rollup / lookup field's cellValueType / formatting change
   * 3. options change will cause the lookup field options change
   * 4. options in link field change may cause all lookup field run in to error, should mark them as error
   */
  private async updateReferencedFields(newField: IFieldInstance, oldField: IFieldInstance) {
    if (!this.infectPropertyChanged(newField, oldField)) {
      return;
    }

    return await this.generateReferenceFieldOps(newField.id);
  }

  private async modifyFormulaOptions(
    newField: RollupFieldDto | FormulaFieldDto,
    oldField: RollupFieldDto | FormulaFieldDto
  ): Promise<undefined> {
    if (newField.options.expression === oldField.options.expression) {
      return;
    }

    const oldReferenceRaw = await this.prismaService.txClient().reference.findMany({
      where: { toFieldId: oldField.id },
      select: { fromFieldId: true },
    });
    const oldReferenceFieldIds = oldReferenceRaw.map((item) => item.fromFieldId);

    let newReferenceFieldIds: string[] = [];
    if (newField.type === FieldType.Formula) {
      newReferenceFieldIds = newField.getReferenceFieldIds();
    }
    if (newField.type === FieldType.Rollup) {
      newReferenceFieldIds.push(newField.lookupOptions.lookupFieldId);
    }

    const addedReferenceFieldIds = differenceBy(newReferenceFieldIds, oldReferenceFieldIds);
    const removedReferenceFieldIds = differenceBy(oldReferenceFieldIds, newReferenceFieldIds);

    if (removedReferenceFieldIds) {
      await this.prismaService.txClient().reference.deleteMany({
        where: {
          fromFieldId: { in: removedReferenceFieldIds },
        },
      });
    }

    if (addedReferenceFieldIds) {
      await Promise.all(
        addedReferenceFieldIds.map((fromFieldId) => {
          return this.prismaService.txClient().reference.create({
            data: { fromFieldId, toFieldId: newField.id },
          });
        })
      );
    }
  }

  private async updateOptionsFromMultiSelectField(
    tableId: string,
    updatedChoiceMap: { [old: string]: string | null },
    field: MultipleSelectFieldDto
  ): Promise<IOpsMap | undefined> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const opsMap: { [recordId: string]: IOtOperation[] } = {};
    const nativeSql = this.knex(dbTableName)
      .select('__id', field.dbFieldName)
      .where((builder) => {
        for (const value of Object.keys(updatedChoiceMap)) {
          builder.orWhere(field.dbFieldName, 'LIKE', `%"${value}"%`);
        }
      })
      .toSQL()
      .toNative();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string; [dbFieldName: string]: string }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );

    for (const row of result) {
      const oldCellValue = field.convertDBValue2CellValue(row[field.dbFieldName]) as string[];
      const newCellValue = oldCellValue.reduce<string[]>((pre, value) => {
        // if key not in updatedChoiceMap, we should keep it
        if (!(value in updatedChoiceMap)) {
          pre.push(value);
          return pre;
        }

        const newValue = updatedChoiceMap[value];
        if (newValue !== null) {
          pre.push(newValue);
        }
        return pre;
      }, []);

      opsMap[row.__id] = [
        RecordOpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue,
          newCellValue,
        }),
      ];
    }
    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async updateOptionsFromSingleSelectField(
    tableId: string,
    updatedChoiceMap: { [old: string]: string | null },
    field: SingleSelectFieldDto
  ): Promise<IOpsMap | undefined> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const opsMap: { [recordId: string]: IOtOperation[] } = {};
    const nativeSql = this.knex(dbTableName)
      .select('__id', field.dbFieldName)
      .where((builder) => {
        for (const value of Object.keys(updatedChoiceMap)) {
          builder.orWhere(field.dbFieldName, value);
        }
      })
      .toSQL()
      .toNative();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string; [dbFieldName: string]: string }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );

    for (const row of result) {
      const oldCellValue = field.convertDBValue2CellValue(row[field.dbFieldName]) as string;

      opsMap[row.__id] = [
        RecordOpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue,
          newCellValue: updatedChoiceMap[oldCellValue],
        }),
      ];
    }
    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async updateOptionsFromSelectField(
    tableId: string,
    updatedChoiceMap: { [old: string]: string | null },
    field: SingleSelectFieldDto | MultipleSelectFieldDto
  ): Promise<IOpsMap | undefined> {
    if (field.type === FieldType.SingleSelect) {
      return this.updateOptionsFromSingleSelectField(tableId, updatedChoiceMap, field);
    }

    if (field.type === FieldType.MultipleSelect) {
      return this.updateOptionsFromMultiSelectField(tableId, updatedChoiceMap, field);
    }
    throw new Error('Invalid field type');
  }

  private async modifySelectOptions(
    tableId: string,
    newField: SingleSelectFieldDto | MultipleSelectFieldDto,
    oldField: SingleSelectFieldDto | MultipleSelectFieldDto
  ) {
    const newChoiceMap = keyBy(newField.options.choices, 'id');
    const updatedChoiceMap: { [old: string]: string | null } = {};

    oldField.options.choices.forEach((item) => {
      if (!newChoiceMap[item.id]) {
        updatedChoiceMap[item.name] = null;
        return;
      }

      if (newChoiceMap[item.id].name !== item.name) {
        updatedChoiceMap[item.name] = newChoiceMap[item.id].name;
      }
    });

    if (isEmpty(updatedChoiceMap)) {
      return;
    }

    return await this.updateOptionsFromSelectField(tableId, updatedChoiceMap, newField);
  }

  private async updateOptionsFromRatingField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    field: RatingFieldDto
  ): Promise<IOpsMap | undefined> {
    const { dbTableName } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const opsMap: { [recordId: string]: IOtOperation[] } = {};
    const newMax = field.options.max;

    const nativeSql = this.knex(dbTableName)
      .select('__id', field.dbFieldName)
      .where(field.dbFieldName, '>', newMax)
      .toSQL()
      .toNative();

    const result = await prisma.$queryRawUnsafe<{ __id: string; [dbFieldName: string]: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    for (const row of result) {
      const oldCellValue = field.convertDBValue2CellValue(row[field.dbFieldName]) as number;

      opsMap[row.__id] = [
        RecordOpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue,
          newCellValue: newMax,
        }),
      ];
    }

    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async modifyRatingOptions(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: RatingFieldDto,
    oldField: RatingFieldDto
  ) {
    const newMax = newField.options.max;
    const oldMax = oldField.options.max;

    if (newMax >= oldMax) return;

    return await this.updateOptionsFromRatingField(prisma, tableId, newField);
  }

  private async modifyOptions(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<IModifiedResult | undefined> {
    switch (newField.type) {
      case FieldType.Link:
        return this.fieldConvertingLinkService.convertLink(
          tableId,
          newField as LinkFieldDto,
          oldField as LinkFieldDto
        );
      case FieldType.Rollup:
        return this.modifyFormulaOptions(newField as RollupFieldDto, oldField as RollupFieldDto);
      case FieldType.Formula:
        return this.modifyFormulaOptions(newField as FormulaFieldDto, oldField as FormulaFieldDto);
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect: {
        const rawOpsMap = await this.modifySelectOptions(
          tableId,
          newField as SingleSelectFieldDto,
          oldField as SingleSelectFieldDto
        );
        return { recordOpsMap: rawOpsMap };
      }
      case FieldType.Rating: {
        const rawOpsMap = await this.modifyRatingOptions(
          prisma,
          tableId,
          newField as RatingFieldDto,
          oldField as RatingFieldDto
        );
        return { recordOpsMap: rawOpsMap };
      }
    }
  }

  private getOriginFieldOps(newField: IFieldInstance, oldField: IFieldInstance) {
    const ops: IOtOperation[] = [];
    const keys: IFieldPropertyKey[] = [];
    FIELD_VO_PROPERTIES.forEach((key) => {
      if (isEqual(newField[key], oldField[key])) {
        return;
      }
      ops.push(
        FieldOpBuilder.editor.setFieldProperty.build({
          key,
          newValue: newField[key],
          oldValue: oldField[key],
        })
      );
      keys.push(key);
    });

    return { ops, keys };
  }

  private async getDerivateByLink(tableId: string, innerOpsMap: IOpsMap['key']) {
    const changes: ICellContext[] = [];
    for (const recordId in innerOpsMap) {
      for (const op of innerOpsMap[recordId]) {
        const context = RecordOpBuilder.editor.setRecord.detect(op);
        if (!context) {
          throw new Error('Invalid operation');
        }
        changes.push({ ...context, oldValue: null, recordId }); // old value by no means when converting
      }
    }

    const derivate = await this.linkService.getDerivateByLink(tableId, changes, true);
    const cellChanges = derivate?.cellChanges || [];
    const fkRecordMap = derivate?.fkRecordMap || {};

    const opsMapByLink = cellChanges.length ? formatChangesToOps(cellChanges) : {};

    return {
      opsMapByLink,
      fkRecordMap,
    };
  }

  private async calculateAndSaveRecords(
    tableId: string,
    field: IFieldInstance,
    recordOpsMap: IOpsMap
  ) {
    let fkRecordMap: IFkOpMap = {};
    if (field.type === FieldType.Link && !field.isLookup) {
      const result = await this.getDerivateByLink(tableId, recordOpsMap[tableId]);
      // console.log('getDerivateByLink:result', JSON.stringify(result, null, 2));
      fkRecordMap = result.fkRecordMap;
      recordOpsMap = composeMaps([recordOpsMap, result.opsMapByLink]);
    }

    const {
      opsMap: calculatedOpsMap,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(recordOpsMap, fkRecordMap);

    const composedOpsMap = composeMaps([recordOpsMap, calculatedOpsMap]);

    // console.log('recordOpsMap', JSON.stringify(recordOpsMap));
    // console.log('composedOpsMap', JSON.stringify(composedOpsMap));
    // console.log('tableId2DbTableName', JSON.stringify(tableId2DbTableName));

    const rawOpsMap = await this.batchService.save(
      'calculated',
      composedOpsMap,
      fieldMap,
      tableId2DbTableName
    );
    // console.log('rawOpsMap', JSON.stringify(rawOpsMap));
    this.shareDbService.publishOpsMap(rawOpsMap);
  }

  private async getRecords(tableId: string, newField: IFieldInstance) {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const result = await this.fieldCalculationService.getRecordsBatchByFields({
      [dbTableName]: [newField],
    });
    const records = result[dbTableName];
    if (!records) {
      throw new InternalServerErrorException(
        `Can't find recordMap for tableId: ${tableId} and fieldId: ${newField.id}`
      );
    }

    return records;
  }

  private async convert2Select(
    tableId: string,
    newField: SingleSelectFieldDto | MultipleSelectFieldDto,
    oldField: IFieldInstance
  ) {
    const fieldId = newField.id;
    const records = await this.getRecords(tableId, oldField);
    const choices = newField.options.choices;
    const opsMap: { [recordId: string]: IOtOperation[] } = {};
    const fieldOps: IOtOperation[] = [];
    const choicesMap = keyBy(choices, 'name');
    const newChoicesSet = new Set<string>();
    records.forEach((record) => {
      const oldCellValue = record.fields[fieldId];
      if (oldCellValue == null) {
        return;
      }

      if (!opsMap[record.id]) {
        opsMap[record.id] = [];
      }

      const cellStr = oldField.cellValue2String(oldCellValue);
      const newCellValue = newField.convertStringToCellValue(cellStr, true);
      if (Array.isArray(newCellValue)) {
        newCellValue.forEach((item) => {
          if (!choicesMap[item]) {
            newChoicesSet.add(item);
          }
        });
      } else if (newCellValue && !choicesMap[newCellValue]) {
        newChoicesSet.add(newCellValue);
      }
      opsMap[record.id].push(
        RecordOpBuilder.editor.setRecord.build({
          fieldId,
          newCellValue,
          oldCellValue,
        })
      );
    });

    if (newChoicesSet.size) {
      const colors = ColorUtils.randomColor(
        choices.map((item) => item.color),
        newChoicesSet.size
      );
      const newChoices = choices.concat(
        Array.from(newChoicesSet).map<ISelectFieldChoice>((item, i) => ({
          id: generateChoiceId(),
          name: item,
          color: colors[i],
        }))
      );
      const fieldOp = this.buildOpAndMutateField(newField, 'options', {
        ...newField.options,
        choices: newChoices,
      });
      fieldOp && fieldOps.push(fieldOp);
    }

    return {
      recordOpsMap: isEmpty(opsMap) ? undefined : { [tableId]: opsMap },
      fieldOps,
    };
  }

  private async basalConvert(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    // simple value type change is not need to convert
    if (
      newField.cellValueType === oldField.cellValueType &&
      newField.isMultipleCellValue !== true &&
      oldField.isMultipleCellValue !== true &&
      newField.dbFieldType !== DbFieldType.Json &&
      oldField.dbFieldType !== DbFieldType.Json
    ) {
      return;
    }

    const fieldId = newField.id;
    const records = await this.getRecords(tableId, oldField);
    const opsMap: { [recordId: string]: IOtOperation[] } = {};
    records.forEach((record) => {
      const oldCellValue = record.fields[fieldId];
      if (oldCellValue == null) {
        return;
      }

      const cellStr = oldField.cellValue2String(oldCellValue);
      const newCellValue = newField.convertStringToCellValue(cellStr);

      if (!opsMap[record.id]) {
        opsMap[record.id] = [];
      }
      opsMap[record.id].push(
        RecordOpBuilder.editor.setRecord.build({
          fieldId,
          newCellValue,
          oldCellValue,
        })
      );
    });

    return {
      recordOpsMap: isEmpty(opsMap) ? undefined : { [tableId]: opsMap },
    };
  }

  private async modifyType(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    if (oldField.isComputed) {
      await this.prismaService.txClient().reference.deleteMany({
        where: { toFieldId: oldField.id },
      });
    }

    if (newField.isComputed) {
      await this.fieldSupplementService.createReference(newField);
      return;
    }

    if (newField.type === FieldType.SingleSelect || newField.type === FieldType.MultipleSelect) {
      return this.convert2Select(tableId, newField, oldField);
    }

    if (newField.type === FieldType.Link) {
      return this.fieldConvertingLinkService.convertLink(tableId, newField, oldField);
    }

    return this.basalConvert(tableId, newField, oldField);
  }

  /**
   * convert a field to another field type
   * 1. create supplement field if needed (link field target foreignTableId changed)
   * 2. convert all cellValue to match new field type
   * 3. update current field vo(dbFieldName, cellValueType, dbFieldType)
   * 4. re-generate new cellValue type and dbFieldType to all reference field
   * 5. re-calculate from current field
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async updateField(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    const connection = this.shareDbService.getConnection();

    const { ops, keys } = this.getOriginFieldOps(newField, oldField);
    this.logger.log('changed Keys:' + JSON.stringify(keys));

    let result: IModifiedResult | undefined;
    if (keys.includes('type') || keys.includes('isComputed')) {
      result = await this.modifyType(tableId, newField, oldField);
    } else if (keys.includes('options')) {
      result = await this.modifyOptions(tableId, newField, oldField);
    }

    const supplementResult = await this.fieldConvertingLinkService.supplementLink(
      connection,
      tableId,
      newField,
      oldField
    );

    await this.submitFieldOps(connection, tableId, newField.id, ops.concat(result?.fieldOps || []));
    // apply supplement(link) field change
    if (supplementResult?.fieldChange) {
      const { tableId, newField, oldField } = supplementResult.fieldChange;
      const { ops } = this.getOriginFieldOps(newField, oldField);
      await this.submitFieldOps(connection, tableId, newField.id, ops);
    }

    // create and submit records
    if (result?.recordsForCreate) {
      for (const tableId in result.recordsForCreate) {
        const recordsMap = result.recordsForCreate[tableId];
        await this.recordOpenApiService.createRecords(
          tableId,
          Object.values(recordsMap),
          FieldKeyType.Id
        );
      }
    }

    // update & submit referenced fields
    const fieldOpsMaps: (IOpsMap | undefined)[] = [];
    fieldOpsMaps.push(await this.updateReferencedFields(newField, oldField));
    if (supplementResult?.fieldChange) {
      const { newField, oldField } = supplementResult.fieldChange;
      fieldOpsMaps.push(await this.updateReferencedFields(newField, oldField));
    }
    const composedMap = composeMaps(fieldOpsMaps);
    composedMap && (await this.submitFieldOpsMap(connection, composedMap));

    // calculate and submit records
    if (result?.recordOpsMap) {
      await this.calculateAndSaveRecords(tableId, newField, result.recordOpsMap);
    }
    if (newField.isComputed) {
      const computedRawOpsMap = await this.fieldCalculationService.calculateFields(
        'calculated',
        tableId,
        [newField.id]
      );
      computedRawOpsMap && this.shareDbService.publishOpsMap(computedRawOpsMap);
    }
    supplementResult?.rawOpMaps?.forEach((rawOpsMap) =>
      this.shareDbService.publishOpsMap(rawOpsMap)
    );
  }

  private async submitFieldOpsMap(connection: Connection, fieldOpsMap: IOpsMap) {
    for (const tableId in fieldOpsMap) {
      for (const fieldId in fieldOpsMap[tableId]) {
        const ops = fieldOpsMap[tableId][fieldId];
        await this.submitFieldOps(connection, tableId, fieldId, ops);
      }
    }
  }

  private async submitFieldOps(
    connection: Connection,
    tableId: string,
    fieldId: string,
    ops: IOtOperation[]
  ) {
    const collection = `${IdPrefix.Field}_${tableId}`;
    const doc = connection.get(collection, fieldId);
    await new Promise((resolve, reject) => {
      doc.fetch((err) => {
        err ? reject(err) : resolve(undefined);
      });
    });

    return new Promise((resolve, reject) => {
      doc.submitOp(ops, undefined, (err) => {
        err ? reject(err) : resolve(undefined);
      });
    });
  }

  // we should create a new field in visual db, because we can not modify a field in sqlite.
  // so we should generate a new dbFieldName for the modified field.
  private async updateDbFieldName(tableId: string, newField: IFieldVo, oldField: IFieldVo) {
    if (newField.dbFieldType === oldField.dbFieldType) {
      return;
    }
    newField.dbFieldName = newField.dbFieldName + '_';
    const dbTableName = await this.fieldService.getDbTableName(tableId);

    await this.fieldService.alterVisualTable(dbTableName, [newField]);
  }

  async updateFieldById(tableId: string, fieldId: string, updateFieldRo: IUpdateFieldRo) {
    const fieldVo = await this.fieldService.getField(tableId, fieldId);
    if (!fieldVo) {
      throw new BadRequestException(`Not found fieldId(${fieldId})`);
    }

    const oldFieldInstance = createFieldInstanceByVo(fieldVo);
    const newFieldVo = await this.fieldSupplementService.prepareUpdateField(
      updateFieldRo,
      oldFieldInstance
    );

    await this.updateDbFieldName(tableId, newFieldVo, fieldVo);

    const newFieldInstance = createFieldInstanceByVo(newFieldVo);

    await this.updateField(tableId, newFieldInstance, oldFieldInstance);

    return instanceToPlain(newFieldInstance, { excludePrefixes: ['_'] }) as IFieldVo;
  }
}
