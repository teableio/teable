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
} from '@teable-group/core';
import {
  randomColor,
  Relationship,
  FIELD_PROPERTIES,
  IdPrefix,
  RecordOpBuilder,
  FieldType,
  FieldOpBuilder,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Connection } from '@teable/sharedb/lib/client';
import { instanceToPlain } from 'class-transformer';
import knex from 'knex';
import { differenceBy, intersection, isEqual, keyBy, set } from 'lodash';
import type { IRawOpMap } from '../../../share-db/interface';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { ITopoOrdersContext } from '../../calculation/field-calculation.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { ReferenceService } from '../../calculation/reference.service';
import type { IOpsMap, IFieldMap } from '../../calculation/reference.service';
import { composeMaps } from '../../calculation/utils/compose-maps';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import {
  createFieldInstanceByRaw,
  createFieldInstanceByVo,
  createFieldInstanceByRo,
} from '../model/factory';
import { FormulaFieldDto } from '../model/field-dto/formula-field.dto';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import type { MultipleSelectFieldDto } from '../model/field-dto/multiple-select-field.dto';
import { RollupFieldDto } from '../model/field-dto/rollup-field.dto';
import type { SingleSelectFieldDto } from '../model/field-dto/single-select-field.dto';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';

interface IModifiedResult {
  recordOpsMap?: IOpsMap;
  fieldOpsMap?: IOpsMap;
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
    private readonly fieldService: FieldService,
    private readonly referenceService: ReferenceService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService
  ) {}

  private async modifyLookupOptions() {
    throw new BadRequestException('Not support modify lookup options');
  }

  private fieldOpMap() {
    const fieldOpMap: IOpsMap = {};
    return {
      pushOpMap: (tableId: string, fieldId: string, op: IOtOperation | IOtOperation[]) => {
        const ops = Array.isArray(op) ? op : [op];
        if (!fieldOpMap[tableId]?.[fieldId]) {
          set(fieldOpMap, [tableId, fieldId], ops);
        } else {
          fieldOpMap[tableId][fieldId].push(...ops);
        }
      },
      getOpMap: () => fieldOpMap,
    };
  }

  private loopTopoOrders(
    field: IFieldInstance,
    topoOrdersContext: ITopoOrdersContext,
    callback: (field: IFieldInstance, nextField: IFieldInstance) => IOtOperation | undefined
  ) {
    const { fieldMap, topoOrdersByFieldId, fieldId2TableId } = topoOrdersContext;
    const topoOrders = topoOrdersByFieldId[field.id];
    if (topoOrders.length <= 1) {
      return {};
    }

    const { pushOpMap, getOpMap } = this.fieldOpMap();

    for (let i = 0; i < topoOrders.length - 1; i++) {
      const nextField = fieldMap[topoOrders[i + 1].id];
      const tableId = fieldId2TableId[nextField.id];

      const op = callback.call(this, field, nextField);

      // only effect [continuous] of the lookup field, so once the op is undefined, we break the loop
      if (!op) {
        break;
      }

      pushOpMap(tableId, nextField.id, op);
    }

    return getOpMap();
  }

  private generateFieldTypeOps(field: IFieldInstance, topoOrdersContext: ITopoOrdersContext) {
    return this.loopTopoOrders(field, topoOrdersContext, (field, nextField) => {
      // only effect continuous of the lookup field
      if (!nextField.isLookup) {
        return;
      }

      return FieldOpBuilder.editor.setFieldProperty.build({
        key: 'type',
        oldValue: nextField.type,
        newValue: field.type,
      });
    });
  }

  private generateFieldCellValueTypeOps(
    field: IFieldInstance,
    topoOrdersContext: ITopoOrdersContext
  ) {
    return this.loopTopoOrders(field, topoOrdersContext, (field, nextField) => {
      // only effect continuous of the lookup field
      if (!nextField.isLookup) {
        return;
      }

      return FieldOpBuilder.editor.setFieldProperty.build({
        key: 'cellValueType',
        oldValue: nextField.cellValueType,
        newValue: field.cellValueType,
      });
    });
  }

  // TODO, 处理公式计算
  private generateFieldIsMultipleOps(field: IFieldInstance, topoOrdersContext: ITopoOrdersContext) {
    return this.loopTopoOrders(field, topoOrdersContext, (field, nextField) => {
      // only ManyOne lookup field may influence by isMultipleCellValue change
      if (!nextField.isLookup || nextField.lookupOptions?.relationship !== Relationship.ManyOne) {
        return;
      }

      return FieldOpBuilder.editor.setFieldProperty.build({
        key: 'isMultipleCellValue',
        oldValue: nextField.isMultipleCellValue,
        newValue: field.isMultipleCellValue,
      });
    });
  }

  private generateFieldOptionsOps(
    field: IFieldInstance,
    topoOrdersContext: ITopoOrdersContext,
    optionsChanges: IPropertyChange[]
  ) {
    return this.loopTopoOrders(field, topoOrdersContext, (field, nextField) => {
      // only effect continuous of the lookup field
      if (!nextField.isLookup) {
        return;
      }

      const newOptions: Record<string, unknown> = { ...nextField.options };
      optionsChanges.forEach((change) => {
        if (change.value == null) {
          delete newOptions[change.key];
          return;
        }
        newOptions[change.key] = change.value;
      });

      return FieldOpBuilder.editor.setFieldProperty.build({
        key: 'options',
        oldValue: nextField.options,
        newValue: newOptions,
      });
    });
  }

  private generateNewFieldMap(topoOrderContext: ITopoOrdersContext, fieldOpsMap: IOpsMap) {
    const { fieldMap } = topoOrderContext;
    const effectedFieldMap: Record<string, IFieldInstance> = {};
    for (const tableId in fieldOpsMap) {
      const fieldOps = fieldOpsMap[tableId];
      for (const fieldId in fieldOps) {
        const field = fieldMap[fieldId];
        const ops = fieldOps[fieldId];
        const fieldVo = instanceToPlain(field, { excludePrefixes: ['_'] });
        ops.forEach((op) => {
          const opContext = FieldOpBuilder.editor.setFieldProperty.detect(op);
          if (!opContext) {
            throw new Error('Invalid field operation');
          }
          fieldVo[opContext.key] = opContext.newValue;
        });
        effectedFieldMap[fieldId] = createFieldInstanceByVo(fieldVo as IFieldVo);
      }
    }
    return Object.assign({}, fieldMap, effectedFieldMap);
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
    return !fieldMap[lookupOptions.lookupFieldId];
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
    const dependentField = fieldMap[lookupFieldId];
    const { cellValueType, isMultipleCellValue } = RollupFieldDto.getParsedValueType(
      field.options.expression,
      relationship,
      dependentField
    );

    if (field.cellValueType !== cellValueType) {
      ops.push(this.buildOpAndMutateField(field, 'cellValueType', cellValueType));
    }
    if (field.isMultipleCellValue !== isMultipleCellValue) {
      ops.push(this.buildOpAndMutateField(field, 'isMultipleCellValue', isMultipleCellValue));
    }
    return ops.filter(Boolean) as IOtOperation[];
  }

  private async generateReferenceFieldOps(prisma: Prisma.TransactionClient, fieldId: string) {
    const topoOrdersContext = await this.fieldCalculationService.getTopoOrdersContext(prisma, [
      fieldId,
    ]);

    const { fieldMap, topoOrdersByFieldId, fieldId2TableId } = topoOrdersContext;
    const topoOrders = topoOrdersByFieldId[fieldId];
    if (topoOrders.length <= 1) {
      return {};
    }

    const { pushOpMap, getOpMap } = this.fieldOpMap();

    for (let i = 1; i < topoOrders.length; i++) {
      const topoOrder = topoOrders[i];
      const curField = fieldMap[topoOrder.id];
      const tableId = fieldId2TableId[curField.id];
      if (curField.isLookup) {
        pushOpMap(tableId, curField.id, this.updateLookupField(curField, fieldMap));
        continue;
      }
      if (curField.type === FieldType.Formula) {
        pushOpMap(tableId, curField.id, this.updateFormulaField(curField, fieldMap));
        continue;
      }
      if (curField.type === FieldType.Rollup) {
        pushOpMap(tableId, curField.id, this.updateRollupField(curField, fieldMap));
      }
    }

    return getOpMap();

    // const fieldOpMaps: IOpsMap[] = [];
    // const typeChanged = changedProperties.includes('type');
    // const cellValueTypeChanged = changedProperties.includes('cellValueType');
    // const isMultipleCellValueChanged = changedProperties.includes('isMultipleCellValue');

    // if (typeChanged) {
    //   fieldOpMaps.push(this.generateFieldTypeOps(field, topoOrderContext));
    // }

    // if (cellValueTypeChanged) {
    //   fieldOpMaps.push(this.generateFieldCellValueTypeOps(field, topoOrderContext));
    // }

    // if (isMultipleCellValueChanged) {
    //   fieldOpMaps.push(this.generateFieldIsMultipleOps(field, topoOrderContext));
    // }

    // if (optionsChanges.length) {
    //   fieldOpMaps.push(this.generateFieldOptionsOps(field, topoOrderContext, optionsChanges));
    // }

    // const effectedFieldMap = this.generateNewFieldMap(topoOrderContext, composeMaps(fieldOpMaps));

    // return composeMaps(fieldOpMaps);
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

    return changedProperties.length || optionsChanges.length;
  }

  /**
   * modify a field will causes the properties of the field that depend on it to change
   * example：
   * 1. modify a field's type will cause the the lookup field's type change
   * 2. cellValueType / isMultipleCellValue change will cause the formula / rollup / lookup field's cellValueType / formatting change
   * 3. options change will cause the lookup field options change
   * 4. options in link field change may cause all lookup field run in to error, should mark them as error
   */
  private async updateReferencedFields(
    prisma: Prisma.TransactionClient,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    if (!this.infectPropertyChanged(newField, oldField)) {
      return;
    }

    return await this.generateReferenceFieldOps(prisma, newField.id);
  }

  /**
   * 1. switch link table
   * 2. other field to link field
   * 3. link field to other field
   */
  private async supplementLink(
    prisma: Prisma.TransactionClient,
    connection: Connection,
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    if (
      newField.type === FieldType.Link &&
      oldField.type === FieldType.Link &&
      newField.options.foreignTableId !== oldField.options.foreignTableId
    ) {
      // update current field reference
      await prisma.reference.deleteMany({
        where: {
          toFieldId: newField.id,
        },
      });
      await this.fieldSupplementService.createReference(prisma, newField);
      await this.fieldSupplementService.cleanForeignKey(prisma, tableId, newField.options);
      // create new symmetric link
      await this.fieldSupplementService.createForeignKey(prisma, tableId, newField);
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        prisma,
        tableId,
        newField
      );
      const createResult = await this.fieldCreatingService.createAndCalculate(
        connection,
        prisma,
        newField.options.foreignTableId,
        symmetricField
      );

      // delete old symmetric link
      const deleteResult = await this.fieldDeletingService.delateAndCleanRef(
        prisma,
        connection,
        tableId,
        oldField.options.symmetricFieldId,
        true
      );
      return [createResult.rawOpsMap, deleteResult.rawOpsMap].filter(Boolean) as IRawOpMap[];
    }

    if (newField.type !== FieldType.Link && oldField.type === FieldType.Link) {
      const deleteResult = await this.fieldDeletingService.delateAndCleanRef(
        prisma,
        connection,
        tableId,
        oldField.options.symmetricFieldId,
        true
      );
      return deleteResult.rawOpsMap ? [deleteResult.rawOpsMap] : [];
    }

    if (newField.type === FieldType.Link && oldField.type !== FieldType.Link) {
      await this.fieldSupplementService.createForeignKey(prisma, tableId, newField);
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        prisma,
        tableId,
        newField
      );

      const result1 = await this.fieldCreatingService.createAndCalculate(
        connection,
        prisma,
        tableId,
        newField
      );
      const result2 = await this.fieldCreatingService.createAndCalculate(
        connection,
        prisma,
        newField.options.foreignTableId,
        symmetricField
      );
      return [result1.rawOpsMap, result2.rawOpsMap].filter(Boolean) as IRawOpMap[];
    }
  }

  private async changeRelationship(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: LinkFieldDto,
    oldField: LinkFieldDto
  ) {
    //
  }

  private async modifyLinkOptions(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: LinkFieldDto,
    oldField: LinkFieldDto
  ) {
    const newLinkOptions = newField.options;
    const oldLinkOptions = oldField.options;
    if (newLinkOptions.foreignTableId !== oldLinkOptions.foreignTableId) {
      // return await this.linkConvert(prisma, tableId, newField, oldField);
    }
    if (newLinkOptions.relationship === oldLinkOptions.relationship) {
      return await this.changeRelationship(prisma, tableId, newField, oldField);
    }
  }

  private async modifyFormulaOptions(
    prisma: Prisma.TransactionClient,
    newField: RollupFieldDto | FormulaFieldDto,
    oldField: RollupFieldDto | FormulaFieldDto
  ): Promise<undefined> {
    if (newField.options.expression === oldField.options.expression) {
      return;
    }

    const oldReferenceRaw = await prisma.reference.findMany({
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
      await prisma.reference.deleteMany({
        where: {
          fromFieldId: { in: removedReferenceFieldIds },
        },
      });
    }

    if (addedReferenceFieldIds) {
      await Promise.all(
        addedReferenceFieldIds.map((fromFieldId) => {
          return prisma.reference.create({
            data: { fromFieldId, toFieldId: newField.id },
          });
        })
      );
    }
  }

  private async deleteOptionsFromSelectField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    deletedChoices: string[],
    field: SingleSelectFieldDto | MultipleSelectFieldDto
  ): Promise<IOpsMap> {
    const { dbTableName } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const opsMap: IOpsMap = { [tableId]: {} };
    const nativeSql = this.knex(dbTableName)
      .select('__id', field.dbFieldName)
      .where((builder) => {
        for (const value of deletedChoices) {
          builder.orWhere(field.dbFieldName, 'LIKE', `%"${value}"%`);
        }
      })
      .toSQL()
      .toNative();

    const result = await prisma.$queryRawUnsafe<{ __id: string; [dbFieldName: string]: string }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );

    for (const row of result) {
      const oldCellValue: string[] = JSON.parse(row[field.dbFieldName]);
      const newCellValue = oldCellValue.filter((value) => !deletedChoices.includes(value));

      opsMap[tableId][row.__id] = [
        RecordOpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue,
          newCellValue,
        }),
      ];
    }
    return opsMap;
  }

  private async modifySelectOptions(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: SingleSelectFieldDto | MultipleSelectFieldDto,
    oldField: SingleSelectFieldDto | MultipleSelectFieldDto
  ) {
    const deletedChoices = differenceBy(
      newField.options.choices,
      oldField.options.choices,
      'name'
    ).map((item) => item.name);

    if (!deletedChoices.length) {
      return;
    }

    return await this.deleteOptionsFromSelectField(prisma, tableId, deletedChoices, newField);
  }

  private async modifyOptions(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<IModifiedResult | undefined> {
    switch (newField.type) {
      case FieldType.Link:
        throw new BadRequestException("Not support modify field's options of link type");
      case FieldType.Rollup:
        return this.modifyFormulaOptions(
          prisma,
          newField as RollupFieldDto,
          oldField as RollupFieldDto
        );
      case FieldType.Formula:
        return this.modifyFormulaOptions(
          prisma,
          newField as FormulaFieldDto,
          oldField as FormulaFieldDto
        );
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect: {
        const rawOpsMap = await this.modifySelectOptions(
          prisma,
          tableId,
          newField as SingleSelectFieldDto,
          oldField as SingleSelectFieldDto
        );
        return { recordOpsMap: rawOpsMap };
      }
    }
  }

  private getOriginFieldOps(newField: IFieldInstance, oldField: IFieldInstance) {
    const ops: IOtOperation[] = [];
    const keys: IFieldPropertyKey[] = [];
    FIELD_PROPERTIES.forEach((key) => {
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

  private async calculateAndSaveRecords(transactionKey: string, recordOpsMap: IOpsMap) {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const {
      opsMap: calculatedOpsMap,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(prisma, recordOpsMap);
    const composedOpsMap = composeMaps([recordOpsMap, calculatedOpsMap]);
    const rawOpsMap = await this.fieldCalculationService.batchSave(
      prisma,
      transactionKey,
      composedOpsMap,
      fieldMap,
      tableId2DbTableName
    );
    this.shareDbService.publishOpsMap(rawOpsMap);
  }

  private async getRecords(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: IFieldInstance
  ) {
    const { dbTableName } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const result = await this.fieldCalculationService.getRecordsBatchByFields(prisma, {
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async convert2Select(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: SingleSelectFieldDto | MultipleSelectFieldDto,
    oldField: IFieldInstance
  ) {
    const fieldId = newField.id;
    const records = await this.getRecords(prisma, tableId, newField);
    const choices = newField.options.choices;
    const recordOpsMap: IOpsMap = { [tableId]: {} };
    const fieldOpMap: IOpsMap = { [tableId]: { [fieldId]: [] } };
    const choicesMap = keyBy(choices, 'name');
    const newChoicesSet = new Set<string>();
    records.forEach((record) => {
      const oldCellValue = record.fields[fieldId];
      if (oldCellValue == null) {
        return;
      }

      if (!recordOpsMap[tableId][record.id]) {
        recordOpsMap[tableId][record.id] = [];
      }
      let newCellValue;
      if (newField.isMultipleCellValue) {
        newCellValue = oldField.isMultipleCellValue
          ? (oldCellValue as unknown[]).map((item) => oldField.item2String(item))
          : [oldField.item2String(oldCellValue)];
      } else {
        newCellValue = oldField.isMultipleCellValue
          ? oldField.item2String((oldCellValue as unknown[])[0])
          : oldField.item2String(oldCellValue);
      }

      if (Array.isArray(newCellValue)) {
        newCellValue.forEach((item) => {
          if (!choicesMap[item]) {
            newChoicesSet.add(item);
          }
        });
      } else if (!choicesMap[newCellValue]) {
        newChoicesSet.add(newCellValue);
      }
      recordOpsMap[tableId][record.id].push(
        RecordOpBuilder.editor.setRecord.build({
          fieldId,
          newCellValue,
          oldCellValue,
        })
      );
    });

    if (newChoicesSet.size) {
      const colors = randomColor(
        choices.map((item) => item.color),
        newChoicesSet.size
      );
      const newChoices = choices.concat(
        Array.from(newChoicesSet).map<ISelectFieldChoice>((item, i) => ({
          name: item,
          color: colors[i],
        }))
      );
      const fieldOp = this.buildOpAndMutateField(newField, 'options', {
        ...newField.options,
        choices: newChoices,
      });
      fieldOp && fieldOpMap[tableId][fieldId].push(fieldOp);
    }

    return {
      recordOpsMap,
      fieldOpMap,
    };
  }

  // TODO: 收集 Record 值，查询新的关联表的值，在关联表里面寻找新的值，如果没有则创建
  private async convertLink(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: LinkFieldDto,
    oldField: IFieldInstance
  ) {
    const fieldId = newField.id;
    const foreignTableId = newField.options.foreignTableId;
    const lookupFieldRaw = await prisma.field.findFirstOrThrow({
      where: { id: newField.options.lookupFieldId, deletedTime: null },
    });
    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);

    const records = await this.getRecords(prisma, tableId, newField);
    const foreignRecords = await this.getRecords(prisma, foreignTableId, lookupField);

    const primaryNameToIdMap = foreignRecords.reduce<{ [name: string]: string }>((pre, record) => {
      const str = lookupField.cellValue2String(record.fields[lookupField.id]);
      pre[str] = record.id;
      return pre;
    }, {});

    const recordOpsMap: IOpsMap = { [tableId]: {}, [foreignTableId]: {} };
    records.forEach((record) => {
      const oldCellValue = record.fields[fieldId];
      if (oldCellValue == null) {
        return;
      }
      let newCellValue;
      if (newField.isMultipleCellValue) {
        newCellValue = oldField.isMultipleCellValue
          ? (oldCellValue as unknown[]).map((item) => oldField.item2String(item))
          : oldField.item2String(oldCellValue);
      } else {
        newCellValue = oldField.isMultipleCellValue
          ? oldField.item2String((oldCellValue as unknown[])[0])
          : oldField.item2String(oldCellValue);
      }

      // recordOpsMap[tableId][record.id].push(
      //   RecordOpBuilder.editor.setRecord.build({
      //     fieldId,
      //     newCellValue,
      //     oldCellValue,
      //   })
      // );
      // recordOpsMap[foreignTableId][recordId].push(
      //   RecordOpBuilder.editor.setRecord.build({
      //     fieldId,
      //     newCellValue,
      //     oldCellValue,
      //   })
      // );
    });
    return {
      recordOpsMap,
    };
  }

  private async modifyType(
    prisma: Prisma.TransactionClient,
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    if (oldField.isComputed) {
      await prisma.reference.deleteMany({
        where: { toFieldId: oldField.id },
      });
    }

    if (newField.isComputed) {
      await this.fieldSupplementService.createReference(prisma, newField);
    }

    if (newField.type === FieldType.SingleSelect || newField.type === FieldType.MultipleSelect) {
      return this.convert2Select(prisma, tableId, newField, oldField);
    }

    if (newField.type === FieldType.Link) {
      return this.convertLink(prisma, tableId, newField, oldField);
    }
  }

  /**
   * convert a field to another field type
   * 1. create supplement field if needed (link field target foreignTableId changed)
   * 2. convert all cellValue to match new field type
   * 3. update current field vo(dbFieldName, cellValueType, dbFieldType)
   * 4. re-generate new cellValue type and dbFieldType to all reference field
   * 5. re-calculate from current field
   */
  private async updateField(
    transactionKey: string,
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    const connection = this.shareDbService.getConnection(transactionKey);
    const prisma = this.transactionService.getTransactionSync(transactionKey);

    const { ops, keys } = this.getOriginFieldOps(newField, oldField);
    await this.submitFieldOps(connection, tableId, newField.id, ops);
    let result: IModifiedResult | undefined;
    const linkResult = await this.supplementLink(prisma, connection, tableId, newField, oldField);

    if (keys.includes('type')) {
      result = await this.modifyType(prisma, tableId, newField, oldField);
    } else if (keys.includes('options')) {
      result = await this.modifyOptions(prisma, tableId, newField, oldField);
    }

    const refFieldOpsMap = await this.updateReferencedFields(prisma, newField, oldField);

    const fieldOpsMap = composeMaps([result?.fieldOpsMap, refFieldOpsMap]);
    fieldOpsMap && (await this.submitFieldOpsMap(connection, fieldOpsMap));

    if (result?.recordOpsMap) {
      await this.calculateAndSaveRecords(transactionKey, result.recordOpsMap);
    }
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
    return new Promise((resolve, reject) => {
      doc.fetch(() => {
        doc.submitOp(ops, undefined, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });
    });
  }

  async updateFieldById(
    transactionKey: string,
    tableId: string,
    fieldId: string,
    updateFieldRo: IUpdateFieldRo
  ) {
    const prisma = this.transactionService.getTransactionSync(transactionKey);

    const fieldVo = await this.fieldService.getField(tableId, fieldId, prisma);
    if (!fieldVo) {
      throw new BadRequestException(`Not found fieldId(${fieldId})`);
    }

    const oldFieldInstance = createFieldInstanceByVo(fieldVo);
    const preparedRo = await this.fieldSupplementService.prepareField(updateFieldRo);
    const newFieldInstance = createFieldInstanceByRo(preparedRo);

    await this.updateField(transactionKey, tableId, newFieldInstance, oldFieldInstance);

    return instanceToPlain(newFieldInstance, { excludePrefixes: ['_'] }) as IFieldVo;
  }
}
