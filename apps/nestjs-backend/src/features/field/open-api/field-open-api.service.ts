import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FieldOpBuilder, IFieldRo } from '@teable/core';
import type { IFieldVo, IConvertFieldRo, IUpdateFieldRo, IOtOperation } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../../configs/threshold.config';
import type { IClsStore } from '../../../types/cls';
import { Timing } from '../../../utils/timing';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { GraphService } from '../../graph/graph.service';
import { FieldConvertingService } from '../field-calculate/field-converting.service';
import { FieldCreatingService } from '../field-calculate/field-creating.service';
import { FieldDeletingService } from '../field-calculate/field-deleting.service';
import { FieldSupplementService } from '../field-calculate/field-supplement.service';
import { FieldService } from '../field.service';
import { createFieldInstanceByVo } from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly graphService: GraphService,
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly cls: ClsService<IClsStore>,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async planField(tableId: string, fieldId: string) {
    return await this.graphService.planField(tableId, fieldId);
  }

  async planFieldCreate(tableId: string, fieldRo: IFieldRo) {
    return await this.graphService.planFieldCreate(tableId, fieldRo);
  }

  async planFieldConvert(tableId: string, fieldId: string, updateFieldRo: IConvertFieldRo) {
    return await this.graphService.planFieldConvert(tableId, fieldId, updateFieldRo);
  }

  @Timing()
  async createField(tableId: string, fieldRo: IFieldRo) {
    const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, fieldRo);
    const fieldInstance = createFieldInstanceByVo(fieldVo);
    const newFields = await this.prismaService.$tx(async () => {
      return await this.fieldCreatingService.alterCreateField(tableId, fieldInstance);
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

    return fieldVo;
  }

  async deleteField(tableId: string, fieldId: string) {
    const field = await this.fieldDeletingService.getField(tableId, fieldId);
    if (!field) {
      throw new NotFoundException(`Field ${fieldId} not found`);
    }

    await this.prismaService.$tx(async () => {
      await this.fieldDeletingService.alterDeleteField(tableId, field);
    });
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
    const { newField, oldField, modifiedOps, supplementChange } =
      await this.fieldConvertingService.stageAnalysis(tableId, fieldId, updateFieldRo);
    this.cls.set('oldField', oldField);

    // 2. stage alter field
    await this.prismaService.$tx(async () => {
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

    return instanceToPlain(newField, { excludePrefixes: ['_'] }) as IFieldVo;
  }
}
