import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FieldKeyType, FieldOpBuilder, IFieldRo } from '@teable/core';
import type {
  IFieldVo,
  IConvertFieldRo,
  IUpdateFieldRo,
  IOtOperation,
  IColumnMeta,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { groupBy } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../../configs/threshold.config';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { Timing } from '../../../utils/timing';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { GraphService } from '../../graph/graph.service';
import { RecordService } from '../../record/record.service';
import { ViewService } from '../../view/view.service';
import { FieldConvertingService } from '../field-calculate/field-converting.service';
import { FieldCreatingService } from '../field-calculate/field-creating.service';
import { FieldDeletingService } from '../field-calculate/field-deleting.service';
import { FieldSupplementService } from '../field-calculate/field-supplement.service';
import { FieldViewSyncService } from '../field-calculate/field-view-sync.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import {
  createFieldInstanceByRaw,
  createFieldInstanceByVo,
  rawField2FieldObj,
} from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly graphService: GraphService,
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly viewService: ViewService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly fieldViewSyncService: FieldViewSyncService,
    private readonly recordService: RecordService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async planField(tableId: string, fieldId: string) {
    return await this.graphService.planField(tableId, fieldId);
  }

  async planFieldCreate(tableId: string, fieldRo: IFieldRo) {
    return await this.graphService.planFieldCreate(tableId, fieldRo);
  }

  // TODO add delete relative check
  async planFieldConvert(tableId: string, fieldId: string, updateFieldRo: IConvertFieldRo) {
    return await this.graphService.planFieldConvert(tableId, fieldId, updateFieldRo);
  }

  private async checkAndResolveError(tableId: string, field: IFieldInstance) {
    const fieldReferenceIds = this.fieldSupplementService.getFieldReferenceIds(field);
    const refFields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldReferenceIds }, deletedTime: null },
      select: { id: true },
    });

    if (refFields.length !== fieldReferenceIds.length) {
      return;
    }

    const curReference = await this.prismaService.txClient().reference.findMany({
      where: {
        toFieldId: field.id,
      },
    });
    const missingReferenceIds = fieldReferenceIds.filter(
      (refId) => !curReference.find((ref) => ref.fromFieldId === refId)
    );

    await this.prismaService.txClient().reference.createMany({
      data: missingReferenceIds.map((refId) => ({
        fromFieldId: refId,
        toFieldId: field.id,
      })),
    });

    await this.fieldService.resolveError(tableId, [field.id]);
  }

  private async restoreReference(references: string[]) {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: references }, hasError: true, deletedTime: null },
    });

    for (const refFieldRaw of fieldRaws) {
      const refField = createFieldInstanceByRaw(refFieldRaw);
      await this.checkAndResolveError(refFieldRaw.tableId, refField);
    }
  }

  @Timing()
  async createFields(
    tableId: string,
    fields: (IFieldVo & { columnMeta?: IColumnMeta; references?: string[] })[]
  ) {
    const newFields = await this.prismaService.$tx(async () => {
      const newFields: { tableId: string; field: IFieldInstance }[] = [];
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const { columnMeta, references, ...fieldVo } = field;

        const fieldInstance = createFieldInstanceByVo(fieldVo);

        const createResult = await this.fieldCreatingService.alterCreateField(
          tableId,
          fieldInstance,
          columnMeta
        );

        if (references) {
          await this.restoreReference(references);
        }

        newFields.push(...createResult);
      }

      return newFields;
    });

    await this.prismaService.$tx(
      async () => {
        for (const { tableId, field } of newFields) {
          if (field.isComputed) {
            await this.fieldCalculationService.calculateFields(tableId, [field.id]);
            await this.fieldService.resolvePending(tableId, [field.id]);
          }
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  private async getFieldReferenceMap(fieldIds: string[]) {
    const referencesRaw = await this.prismaService.reference.findMany({
      where: {
        fromFieldId: { in: fieldIds },
      },
      select: {
        fromFieldId: true,
        toFieldId: true,
      },
    });
    return groupBy(referencesRaw, 'fromFieldId');
  }

  @Timing()
  async createField(tableId: string, fieldRo: IFieldRo, windowId?: string) {
    const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, fieldRo);
    const fieldInstance = createFieldInstanceByVo(fieldVo);
    const columnMeta = fieldRo.order && {
      [fieldRo.order.viewId]: { order: fieldRo.order.orderIndex },
    };
    const newFields = await this.prismaService.$tx(async () => {
      return await this.fieldCreatingService.alterCreateField(tableId, fieldInstance, columnMeta);
    });

    await this.prismaService.$tx(
      async () => {
        for (const { tableId, field } of newFields) {
          if (field.isComputed) {
            await this.fieldCalculationService.calculateFields(tableId, [field.id]);
            await this.fieldService.resolvePending(tableId, [field.id]);
          }
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    const referenceMap = await this.getFieldReferenceMap([fieldVo.id]);

    this.eventEmitterService.emit(Events.OPERATION_FIELDS_CREATE, {
      windowId,
      tableId,
      userId: this.cls.get('user.id'),
      fields: [
        {
          ...fieldVo,
          columnMeta,
          references: referenceMap[fieldVo.id]?.map((ref) => ref.toFieldId),
        },
      ],
    });

    return fieldVo;
  }

  @Timing()
  async deleteFields(tableId: string, fieldIds: string[], windowId?: string) {
    const fieldRaws = await this.prismaService.field.findMany({
      where: { tableId, id: { in: fieldIds }, deletedTime: null },
    });

    const fieldVos = fieldRaws.map(rawField2FieldObj);
    const fields = fieldVos.map(createFieldInstanceByVo);

    if (fields.length !== fieldIds.length) {
      const notExistField = fieldIds.find((id) => !fields.find((field) => field.id === id));
      throw new NotFoundException(`Field ${notExistField} not found`);
    }

    const nonComputedFields = fields.filter((field) => !field.isComputed);
    const records = await this.recordService.getRecordsFields(tableId, {
      projection: nonComputedFields.map((field) => field.id),
      fieldKeyType: FieldKeyType.Id,
      take: -1,
    });

    const columnsMeta = await this.viewService.getColumnsMetaMap(tableId, fieldIds);
    const referenceMap = await this.getFieldReferenceMap(fieldIds);

    await this.prismaService.$tx(async () => {
      await this.fieldViewSyncService.deleteViewRelativeByFields(
        tableId,
        fields.map((f) => f.id)
      );
      for (const field of fields) {
        await this.fieldDeletingService.alterDeleteField(tableId, field);
      }
    });

    this.eventEmitterService.emitAsync(Events.OPERATION_FIELDS_DELETE, {
      windowId,
      tableId,
      userId: this.cls.get('user.id'),
      fields: fieldVos.map((field, i) => ({
        ...field,
        columnMeta: columnsMeta[i],
        references: referenceMap[field.id]?.map((ref) => ref.toFieldId),
      })),
      records,
    });

    return fields;
  }

  async deleteField(tableId: string, fieldId: string, windowId?: string) {
    await this.deleteFields(tableId, [fieldId], windowId);
  }

  private async updateUniqProperty(
    tableId: string,
    fieldId: string,
    key: 'name' | 'dbFieldName',
    value: string
  ) {
    const result = await this.prismaService.field
      .findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
        select: { [key]: true },
      })
      .catch(() => {
        throw new NotFoundException(`Field ${fieldId} not found`);
      });

    const hasDuplicated = await this.prismaService.field.findFirst({
      where: { tableId, [key]: value, deletedTime: null },
      select: { id: true },
    });

    if (hasDuplicated) {
      throw new BadRequestException(`Field ${key} ${value} already exists`);
    }

    return FieldOpBuilder.editor.setFieldProperty.build({
      key,
      oldValue: result[key],
      newValue: value,
    });
  }

  async updateField(tableId: string, fieldId: string, updateFieldRo: IUpdateFieldRo) {
    const ops: IOtOperation[] = [];
    if (updateFieldRo.name) {
      const op = await this.updateUniqProperty(tableId, fieldId, 'name', updateFieldRo.name);
      ops.push(op);
    }

    if (updateFieldRo.dbFieldName) {
      const op = await this.updateUniqProperty(
        tableId,
        fieldId,
        'dbFieldName',
        updateFieldRo.dbFieldName
      );
      ops.push(op);
    }

    if (updateFieldRo.description !== undefined) {
      const { description } = await this.prismaService.field
        .findFirstOrThrow({
          where: { id: fieldId, deletedTime: null },
          select: { description: true },
        })
        .catch(() => {
          throw new NotFoundException(`Field ${fieldId} not found`);
        });

      ops.push(
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'description',
          oldValue: description,
          newValue: updateFieldRo.description,
        })
      );
    }

    await this.prismaService.$tx(async () => {
      await this.fieldService.batchUpdateFields(tableId, [{ fieldId, ops }]);
    });
  }

  async convertField(
    tableId: string,
    fieldId: string,
    updateFieldRo: IConvertFieldRo
  ): Promise<IFieldVo> {
    // 1. stage analysis and collect field changes
    const { newField, oldField, modifiedOps, supplementChange, needSupplementFieldConstraint } =
      await this.fieldConvertingService.stageAnalysis(tableId, fieldId, updateFieldRo);
    this.cls.set('oldField', oldField);

    // 2. stage alter field
    await this.prismaService.$tx(async () => {
      await this.fieldViewSyncService.convertFieldRelative(tableId, newField, oldField);
      await this.fieldConvertingService.stageAlter(tableId, newField, oldField, modifiedOps);
      await this.fieldConvertingService.alterSupplementLink(
        tableId,
        newField,
        oldField,
        supplementChange
      );
    });

    // 3. stage apply record changes and calculate field
    await this.prismaService.$tx(
      async () => {
        await this.fieldConvertingService.stageCalculate(tableId, newField, oldField, modifiedOps);

        if (supplementChange) {
          const { tableId, newField, oldField } = supplementChange;
          await this.fieldConvertingService.stageCalculate(tableId, newField, oldField);
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    // 4. stage supplement field constraint
    if (needSupplementFieldConstraint) {
      await this.fieldConvertingService.supplementFieldConstraint(tableId, newField);
    }

    return instanceToPlain(newField, { excludePrefixes: ['_'] }) as IFieldVo;
  }
}
