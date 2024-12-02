import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type {
  IFieldPropertyKey,
  ILookupOptionsVo,
  IOtOperation,
  ISelectFieldChoice,
  IConvertFieldRo,
} from '@teable/core';
import {
  ColorUtils,
  DbFieldType,
  FIELD_VO_PROPERTIES,
  FieldOpBuilder,
  FieldType,
  generateChoiceId,
  isMultiValueLink,
  PRIMARY_SUPPORTED_TYPES,
  RecordOpBuilder,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { difference, intersection, isEmpty, isEqual, keyBy, set } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import {
  majorFieldKeysChanged,
  majorOptionsKeyChanged,
  NON_INFECT_OPTION_KEYS,
} from '../../../utils/major-field-keys-changed';
import { BatchService } from '../../calculation/batch.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import type { IFkRecordMap } from '../../calculation/link.service';
import { LinkService } from '../../calculation/link.service';
import { ReferenceService } from '../../calculation/reference.service';
import type { ICellContext } from '../../calculation/utils/changes';
import { formatChangesToOps } from '../../calculation/utils/changes';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import { composeOpMaps } from '../../calculation/utils/compose-maps';
import { CollaboratorService } from '../../collaborator/collaborator.service';
import { FieldService } from '../field.service';
import type { IFieldInstance, IFieldMap } from '../model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../model/factory';
import { FormulaFieldDto } from '../model/field-dto/formula-field.dto';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import type { MultipleSelectFieldDto } from '../model/field-dto/multiple-select-field.dto';
import type { RatingFieldDto } from '../model/field-dto/rating-field.dto';
import { RollupFieldDto } from '../model/field-dto/rollup-field.dto';
import type { SingleSelectFieldDto } from '../model/field-dto/single-select-field.dto';
import type { UserFieldDto } from '../model/field-dto/user-field.dto';
import { FieldConvertingLinkService } from './field-converting-link.service';
import { FieldSupplementService } from './field-supplement.service';

@Injectable()
export class FieldConvertingService {
  private readonly logger = new Logger(FieldConvertingService.name);

  constructor(
    private readonly linkService: LinkService,
    private readonly fieldService: FieldService,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly referenceService: ReferenceService,
    private readonly fieldConvertingLinkService: FieldConvertingLinkService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly collaboratorService: CollaboratorService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
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

  /**
   * Mutate field instance directly, because we should update fieldInstance in fieldMap for next field operation
   */
  private buildOpAndMutateField(field: IFieldInstance, key: IFieldPropertyKey, value: unknown) {
    if (isEqual(field[key], value)) {
      return;
    }
    const oldValue = field[key];
    (field[key] as unknown) = value;
    return FieldOpBuilder.editor.setFieldProperty.build({ key, oldValue, newValue: value });
  }

  /**
   * 1. check if the lookup field is valid, if not mark error
   * 2. update lookup field properties
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private updateLookupField(field: IFieldInstance, fieldMap: IFieldMap): IOtOperation[] {
    const ops: (IOtOperation | undefined)[] = [];
    const lookupOptions = field.lookupOptions as ILookupOptionsVo;
    const linkField = fieldMap[lookupOptions.linkFieldId] as LinkFieldDto;
    const lookupField = fieldMap[lookupOptions.lookupFieldId];
    const { showAs: _, ...inheritableOptions } = lookupField.options as Record<string, unknown>;
    const {
      formatting = inheritableOptions.formatting,
      showAs,
      ...inheritOptions
    } = field.options as Record<string, unknown>;
    const cellValueTypeChanged = field.cellValueType !== lookupField.cellValueType;

    if (field.type !== lookupField.type) {
      ops.push(this.buildOpAndMutateField(field, 'type', lookupField.type));
    }

    if (lookupOptions.relationship !== linkField.options.relationship) {
      ops.push(
        this.buildOpAndMutateField(field, 'lookupOptions', {
          ...lookupOptions,
          relationship: linkField.options.relationship,
          fkHostTableName: linkField.options.fkHostTableName,
          selfKeyName: linkField.options.selfKeyName,
          foreignKeyName: linkField.options.foreignKeyName,
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
      lookupField.cellValueType,
      lookupField.isMultipleCellValue || isMultiValueLink(relationship)
    );

    if (field.cellValueType !== cellValueType) {
      ops.push(this.buildOpAndMutateField(field, 'cellValueType', cellValueType));
    }
    if (field.isMultipleCellValue !== isMultipleCellValue) {
      ops.push(this.buildOpAndMutateField(field, 'isMultipleCellValue', isMultipleCellValue));
    }
    return ops.filter(Boolean) as IOtOperation[];
  }

  private updateDbFieldType(field: IFieldInstance) {
    const ops: IOtOperation[] = [];
    const dbFieldType = this.fieldSupplementService.getDbFieldType(
      field.type,
      field.cellValueType,
      field.isMultipleCellValue
    );

    if (field.dbFieldType !== dbFieldType) {
      const op1 = this.buildOpAndMutateField(field, 'dbFieldType', dbFieldType);
      op1 && ops.push(op1);
    }
    return ops;
  }

  private async generateReferenceFieldOps(fieldId: string) {
    const topoOrdersContext = await this.fieldCalculationService.getTopoOrdersContext([fieldId]);

    const { fieldMap, fieldId2TableId } = topoOrdersContext;

    // get all fields after current field
    const topoOrders = topoOrdersContext.topoOrders.slice(
      topoOrdersContext.topoOrders.findIndex((item) => item.id === fieldId) + 1
    );

    if (!topoOrders.length) {
      return {};
    }

    const { pushOpsMap, getOpsMap } = this.fieldOpsMap();

    for (let i = 0; i < topoOrders.length; i++) {
      const topoOrder = topoOrders[i];
      // curField will be mutate in loop
      const curField = fieldMap[topoOrder.id];
      const tableId = fieldId2TableId[curField.id];
      if (curField.isLookup) {
        pushOpsMap(tableId, curField.id, this.updateLookupField(curField, fieldMap));
      } else if (curField.type === FieldType.Formula) {
        pushOpsMap(tableId, curField.id, this.updateFormulaField(curField, fieldMap));
      } else if (curField.type === FieldType.Rollup) {
        pushOpsMap(tableId, curField.id, this.updateRollupField(curField, fieldMap));
      }
      pushOpsMap(tableId, curField.id, this.updateDbFieldType(curField));
    }

    return getOpsMap();
  }

  /**
   * get deep deference in options, and return changes
   * formatting, showAs should be ignore
   */
  private getOptionsChanges(
    newOptions: Record<string, unknown>,
    oldOptions: Record<string, unknown>,
    valueTypeChange?: boolean
  ): Record<string, unknown> {
    const optionsChanges: Record<string, unknown> = {};

    newOptions = { ...newOptions };
    oldOptions = { ...oldOptions };
    const nonInfectKeys = Array.from(NON_INFECT_OPTION_KEYS);
    nonInfectKeys.forEach((key) => {
      delete newOptions[key];
      delete oldOptions[key];
    });

    const newOptionsKeys = Object.keys(newOptions);
    const oldOptionsKeys = Object.keys(oldOptions);

    const addedOptionsKeys = difference(newOptionsKeys, oldOptionsKeys);
    const removedOptionsKeys = difference(oldOptionsKeys, newOptionsKeys);
    const editedOptionsKeys = intersection(newOptionsKeys, oldOptionsKeys).filter(
      (key) => !isEqual(oldOptions[key], newOptions[key])
    );

    addedOptionsKeys.forEach((key) => (optionsChanges[key] = newOptions[key]));
    editedOptionsKeys.forEach((key) => (optionsChanges[key] = newOptions[key]));
    removedOptionsKeys.forEach((key) => (optionsChanges[key] = null));

    // clean formatting, showAs when valueType change
    valueTypeChange && nonInfectKeys.forEach((key) => (optionsChanges[key] = null));

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

    return Boolean(changedProperties.length || !isEmpty(optionsChanges));
  }

  // lookupOptions of lookup field and rollup field must be consistent with linkField Settings
  // And they don't belong in the referenceField
  private async updateLookupRollupRef(
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<IOpsMap | undefined> {
    if (newField.type !== FieldType.Link || oldField.type !== FieldType.Link) {
      return;
    }

    // ignore foreignTableId change
    if (newField.options.foreignTableId !== oldField.options.foreignTableId) {
      return;
    }

    const { relationship, fkHostTableName, foreignKeyName, selfKeyName } = newField.options;
    if (
      relationship === oldField.options.relationship &&
      fkHostTableName === oldField.options.fkHostTableName &&
      foreignKeyName === oldField.options.foreignKeyName &&
      selfKeyName === oldField.options.selfKeyName
    ) {
      return;
    }

    const relatedFieldsRaw = await this.prismaService.field.findMany({
      where: {
        lookupLinkedFieldId: newField.id,
        deletedTime: null,
      },
    });

    const relatedFields = relatedFieldsRaw.map(createFieldInstanceByRaw);

    const lookupToFields = await this.prismaService.field.findMany({
      where: {
        id: {
          in: relatedFields.map((field) => field.lookupOptions?.lookupFieldId as string),
        },
      },
    });
    const relatedFieldsRawMap = keyBy(relatedFieldsRaw, 'id');
    const lookupToFieldsMap = keyBy(lookupToFields, 'id');

    const { pushOpsMap, getOpsMap } = this.fieldOpsMap();

    relatedFields.forEach((field) => {
      const lookupOptions = field.lookupOptions!;
      const ops: IOtOperation[] = [];
      ops.push(
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'lookupOptions',
          newValue: {
            ...lookupOptions,
            relationship,
            fkHostTableName,
            foreignKeyName,
            selfKeyName,
          },
          oldValue: lookupOptions,
        })
      );

      const lookupToFieldRaw = lookupToFieldsMap[lookupOptions.lookupFieldId];

      if (field.isLookup) {
        const isMultipleCellValue =
          newField.isMultipleCellValue || lookupToFieldRaw.isMultipleCellValue || false;

        if (isMultipleCellValue !== field.isMultipleCellValue) {
          ops.push(
            FieldOpBuilder.editor.setFieldProperty.build({
              key: 'isMultipleCellValue',
              newValue: isMultipleCellValue,
              oldValue: field.isMultipleCellValue,
            }),
            FieldOpBuilder.editor.setFieldProperty.build({
              key: 'dbFieldType',
              newValue: this.fieldSupplementService.getDbFieldType(
                field.type,
                field.cellValueType,
                isMultipleCellValue
              ),
              oldValue: field.dbFieldType,
            })
          );
        }

        const newOptions = this.fieldSupplementService.prepareFormattingShowAs(
          field.options,
          JSON.parse(lookupToFieldRaw.options as string),
          field.cellValueType,
          isMultipleCellValue
        );

        if (!isEqual(newOptions, field.options)) {
          ops.push(
            FieldOpBuilder.editor.setFieldProperty.build({
              key: 'options',
              newValue: newOptions,
              oldValue: field.options,
            })
          );
        }
      }

      pushOpsMap(relatedFieldsRawMap[field.id].tableId, field.id, ops);
    });

    return getOpsMap();
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

    const refFieldOpsMap = await this.updateLookupRollupRef(newField, oldField);

    const fieldOpsMap = await this.generateReferenceFieldOps(newField.id);

    await this.submitFieldOpsMap(composeOpMaps([refFieldOpsMap, fieldOpsMap]));
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
          builder.orWhere(
            this.knex.raw(`CAST(?? AS text)`, [field.dbFieldName]),
            'LIKE',
            `%"${value}"%`
          );
        }
      })
      .toSQL()
      .toNative();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { __id: string; [dbFieldName: string]: string }[]
      >(nativeSql.sql, ...nativeSql.bindings);

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
      .$queryRawUnsafe<
        { __id: string; [dbFieldName: string]: string }[]
      >(nativeSql.sql, ...nativeSql.bindings);

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

    return this.updateOptionsFromSelectField(tableId, updatedChoiceMap, newField);
  }

  private async updateOptionsFromRatingField(
    tableId: string,
    field: RatingFieldDto
  ): Promise<IOpsMap | undefined> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
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

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { __id: string; [dbFieldName: string]: string }[]
      >(nativeSql.sql, ...nativeSql.bindings);

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
    tableId: string,
    newField: RatingFieldDto,
    oldField: RatingFieldDto
  ) {
    const newMax = newField.options.max;
    const oldMax = oldField.options.max;

    if (newMax >= oldMax) return;

    return await this.updateOptionsFromRatingField(tableId, newField);
  }

  private async updateOptionsFromUserField(
    tableId: string,
    field: UserFieldDto
  ): Promise<IOpsMap | undefined> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const opsMap: { [recordId: string]: IOtOperation[] } = {};
    const nativeSql = this.knex(dbTableName)
      .select('__id', field.dbFieldName)
      .whereNotNull(field.dbFieldName);

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ __id: string; [dbFieldName: string]: string }[]>(nativeSql.toQuery());

    for (const row of result) {
      const oldCellValue = field.convertDBValue2CellValue(row[field.dbFieldName]);
      let newCellValue;

      if (field.isMultipleCellValue && !Array.isArray(oldCellValue)) {
        newCellValue = [oldCellValue];
      } else if (!field.isMultipleCellValue && Array.isArray(oldCellValue)) {
        newCellValue = oldCellValue[0];
      } else {
        newCellValue = oldCellValue;
      }

      opsMap[row.__id] = [
        RecordOpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue,
          newCellValue: newCellValue,
        }),
      ];
    }

    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async modifyUserOptions(tableId: string, newField: UserFieldDto, oldField: UserFieldDto) {
    const newOption = newField.options.isMultiple;
    const oldOption = oldField.options.isMultiple;

    if (newOption === oldOption) return;

    return await this.updateOptionsFromUserField(tableId, newField);
  }

  private async modifyOptions(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<IOpsMap | undefined> {
    if (newField.isLookup) {
      return;
    }

    switch (newField.type) {
      case FieldType.Link:
        return await this.fieldConvertingLinkService.modifyLinkOptions(
          tableId,
          newField as LinkFieldDto,
          oldField as LinkFieldDto
        );
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect: {
        return await this.modifySelectOptions(
          tableId,
          newField as SingleSelectFieldDto,
          oldField as SingleSelectFieldDto
        );
      }
      case FieldType.Rating: {
        return await this.modifyRatingOptions(
          tableId,
          newField as RatingFieldDto,
          oldField as RatingFieldDto
        );
      }
      case FieldType.User: {
        return await this.modifyUserOptions(
          tableId,
          newField as UserFieldDto,
          oldField as UserFieldDto
        );
      }
    }
  }

  private getOriginFieldKeys(newField: IFieldInstance, oldField: IFieldInstance) {
    return FIELD_VO_PROPERTIES.filter((key) => !isEqual(newField[key], oldField[key]));
  }

  private getOriginFieldOps(newField: IFieldInstance, oldField: IFieldInstance) {
    return this.getOriginFieldKeys(newField, oldField).map((key) =>
      FieldOpBuilder.editor.setFieldProperty.build({
        key,
        newValue: newField[key],
        oldValue: oldField[key],
      })
    );
  }

  private async getDerivateByLink(tableId: string, innerOpsMap: IOpsMap['key']) {
    const changes: ICellContext[] = [];
    for (const recordId in innerOpsMap) {
      for (const op of innerOpsMap[recordId]) {
        const context = RecordOpBuilder.editor.setRecord.detect(op);
        if (!context) {
          throw new Error('Invalid operation');
        }
        changes.push({
          recordId,
          fieldId: context.fieldId,
          oldValue: null, // old value by no means when converting
          newValue: context.newCellValue,
        });
      }
    }

    const derivate = await this.linkService.getDerivateByLink(tableId, changes, true);
    const cellChanges = derivate?.cellChanges || [];

    const opsMapByLink = cellChanges.length ? formatChangesToOps(cellChanges) : {};

    return {
      opsMapByLink,
      fkRecordMap: derivate?.fkRecordMap,
    };
  }

  private async calculateAndSaveRecords(
    tableId: string,
    field: IFieldInstance,
    recordOpsMap: IOpsMap | void
  ) {
    if (!recordOpsMap || isEmpty(recordOpsMap)) {
      return;
    }

    let fkRecordMap: IFkRecordMap | undefined;
    if (field.type === FieldType.Link && !field.isLookup) {
      const result = await this.getDerivateByLink(tableId, recordOpsMap[tableId]);
      recordOpsMap = composeOpMaps([recordOpsMap, result.opsMapByLink]);
    }

    await this.batchService.updateRecords(recordOpsMap);

    await this.referenceService.calculateOpsMap(recordOpsMap, fkRecordMap);
  }

  private async getExistRecords(tableId: string, newField: IFieldInstance) {
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async convert2Select(
    tableId: string,
    newField: SingleSelectFieldDto | MultipleSelectFieldDto,
    oldField: IFieldInstance
  ) {
    const fieldId = newField.id;
    const records = await this.getExistRecords(tableId, oldField);
    const choices = newField.options.choices;
    const opsMap: { [recordId: string]: IOtOperation[] } = {};
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
      // mutate field
      this.buildOpAndMutateField(newField, 'options', {
        ...newField.options,
        choices: newChoices,
      });
    }

    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async convert2User(tableId: string, newField: UserFieldDto, oldField: IFieldInstance) {
    const fieldId = newField.id;
    const records = await this.getExistRecords(tableId, oldField);
    const baseCollabs = await this.collaboratorService.getBaseCollabsWithPrimary(tableId);
    const opsMap: { [recordId: string]: IOtOperation[] } = {};

    records.forEach((record) => {
      const oldCellValue = record.fields[fieldId];
      if (oldCellValue == null) {
        return;
      }

      if (!opsMap[record.id]) {
        opsMap[record.id] = [];
      }

      const cellStr = oldField.cellValue2String(oldCellValue);
      const newCellValue = newField.convertStringToCellValue(cellStr, { userSets: baseCollabs });

      opsMap[record.id].push(
        RecordOpBuilder.editor.setRecord.build({
          fieldId,
          newCellValue,
          oldCellValue,
        })
      );
    });

    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async basalConvert(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    // simple value type change is not need to convert
    if (
      oldField.type !== FieldType.LongText &&
      newField.type !== FieldType.Rating &&
      newField.cellValueType === oldField.cellValueType &&
      newField.isMultipleCellValue !== true &&
      oldField.isMultipleCellValue !== true &&
      newField.dbFieldType !== DbFieldType.Json &&
      oldField.dbFieldType !== DbFieldType.Json &&
      newField.dbFieldType === oldField.dbFieldType
    ) {
      return;
    }

    const fieldId = newField.id;
    const records = await this.getExistRecords(tableId, oldField);
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

    return isEmpty(opsMap) ? undefined : { [tableId]: opsMap };
  }

  private async modifyType(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<IOpsMap | undefined> {
    if (newField.isComputed) {
      return;
    }

    if (newField.type === FieldType.SingleSelect || newField.type === FieldType.MultipleSelect) {
      return this.convert2Select(tableId, newField, oldField);
    }

    if (newField.type === FieldType.Link) {
      return this.fieldConvertingLinkService.convertLink(tableId, newField, oldField);
    }

    if (newField.type === FieldType.User) {
      return this.convert2User(tableId, newField, oldField);
    }

    return this.basalConvert(tableId, newField, oldField);
  }

  async updateReference(newField: IFieldInstance, oldField: IFieldInstance) {
    if (!this.shouldUpdateReference(newField, oldField)) {
      return;
    }

    await this.prismaService.txClient().reference.deleteMany({
      where: { toFieldId: oldField.id },
    });

    await this.fieldSupplementService.createReference(newField);
  }

  private shouldUpdateReference(newField: IFieldInstance, oldField: IFieldInstance) {
    const keys = this.getOriginFieldKeys(newField, oldField);
    if (newField.type === FieldType.Link && !newField.isLookup) {
      return false;
    }

    // lookup options change
    if (newField.isLookup && oldField.isLookup) {
      return keys.includes('lookupOptions');
    }

    // major change
    if (keys.includes('type') || keys.includes('isComputed') || keys.includes('isLookup')) {
      return true;
    }

    // for same field with options change
    if (keys.includes('options')) {
      return (
        (newField.type === FieldType.Rollup || newField.type === FieldType.Formula) &&
        newField.options.expression !== (oldField as FormulaFieldDto).options.expression
      );
    }

    // for same field with lookup options change
    return keys.includes('lookupOptions');
  }

  private async generateModifiedOps(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ): Promise<IOpsMap | undefined> {
    const keys = this.getOriginFieldKeys(newField, oldField);

    if (newField.isLookup && oldField.isLookup) {
      return;
    }

    // for field type change, isLookup change, isComputed change
    if (keys.includes('type') || keys.includes('isComputed') || keys.includes('isLookup')) {
      return this.modifyType(tableId, newField, oldField);
    }

    // for same field with options change
    if (keys.includes('options') && majorOptionsKeyChanged(oldField.options, newField.options)) {
      return await this.modifyOptions(tableId, newField, oldField);
    }
  }

  needCalculate(newField: IFieldInstance, oldField: IFieldInstance) {
    if (!newField.isComputed) {
      return false;
    }

    return majorFieldKeysChanged(oldField, newField);
  }

  private async calculateField(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    if (!newField.isComputed) {
      return;
    }

    if (!majorFieldKeysChanged(oldField, newField)) {
      return;
    }

    this.logger.log(`calculating field: ${newField.name}`);

    await this.fieldCalculationService.calculateFields(tableId, [newField.id]);
    await this.fieldService.resolvePending(tableId, [newField.id]);
  }

  private async submitFieldOpsMap(fieldOpsMap: IOpsMap | undefined) {
    if (!fieldOpsMap) {
      return;
    }

    for (const tableId in fieldOpsMap) {
      const opData = Object.entries(fieldOpsMap[tableId]).map(([fieldId, ops]) => ({
        fieldId,
        ops,
      }));
      await this.fieldService.batchUpdateFields(tableId, opData);
    }
  }

  // for link ref and create or delete supplement link, (create, delete do not need calculate)
  async deleteOrCreateSupplementLink(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    await this.fieldConvertingLinkService.deleteOrCreateSupplementLink(tableId, newField, oldField);
  }

  private needTempleCloseFieldConstraint(newField: IFieldInstance, oldField: IFieldInstance) {
    return majorFieldKeysChanged(oldField, newField) && (oldField.unique || oldField.notNull);
  }

  async alterFieldConstraint(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    if (!this.needTempleCloseFieldConstraint(newField, oldField)) {
      return;
    }
    const { unique, notNull, dbFieldName } = newField;
    const fieldValidationQuery = this.knex.schema
      .alterTable(dbTableName, (table) => {
        if (unique) table.unique(dbFieldName);
        if (notNull) table.dropNullable(dbFieldName);
      })
      .toQuery();
    await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
  }

  async closeConstraint(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const { unique, notNull, dbFieldName } = oldField;

    if (!this.needTempleCloseFieldConstraint(newField, oldField)) {
      return;
    }

    const fieldValidationQuery = this.knex.schema
      .alterTable(dbTableName, (table) => {
        if (unique) table.dropUnique([dbFieldName]);
        if (notNull) table.setNullable(dbFieldName);
      })
      .toQuery();

    await this.prismaService.$executeRawUnsafe(fieldValidationQuery);
  }

  async stageAnalysis(tableId: string, fieldId: string, updateFieldRo: IConvertFieldRo) {
    const oldFieldVo = await this.fieldService.getField(tableId, fieldId);
    if (!oldFieldVo) {
      throw new BadRequestException(`Not found fieldId(${fieldId})`);
    }

    const oldField = createFieldInstanceByVo(oldFieldVo);

    if (oldField.isPrimary && !PRIMARY_SUPPORTED_TYPES.has(updateFieldRo.type)) {
      throw new BadRequestException(
        `Field type ${updateFieldRo.type} is not supported as primary field`
      );
    }

    const newFieldVo = await this.fieldSupplementService.prepareUpdateField(
      tableId,
      updateFieldRo,
      oldField
    );

    const newField = createFieldInstanceByVo(newFieldVo);
    const modifiedOps = await this.generateModifiedOps(tableId, newField, oldField);

    // 2. collect changes effect by the supplement(link) field
    // supplementChange is only for link relationship change
    const references = (await this.fieldConvertingLinkService.analysisReference(oldField)) || [];
    const supplementChange = await this.fieldConvertingLinkService.analysisSupplementLink(
      newField,
      oldField
    );
    return {
      newField,
      oldField,
      modifiedOps,
      supplementChange,
      references: references.concat(fieldId),
    };
  }

  async stageAlter(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    const ops = this.getOriginFieldOps(newField, oldField);

    if (this.needCalculate(newField, oldField)) {
      ops.push(
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'isPending',
          newValue: true,
          oldValue: undefined,
        })
      );
    }

    // apply current field changes
    await this.fieldService.batchUpdateFields(tableId, [{ fieldId: newField.id, ops }]);

    await this.updateReference(newField, oldField);

    // apply referenced fields changes
    await this.updateReferencedFields(newField, oldField);
  }

  async stageCalculate(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance,
    recordOpsMap?: IOpsMap
  ) {
    // calculate and submit records
    await this.calculateAndSaveRecords(tableId, newField, recordOpsMap);

    // calculate computed fields
    await this.calculateField(tableId, newField, oldField);
  }
}
