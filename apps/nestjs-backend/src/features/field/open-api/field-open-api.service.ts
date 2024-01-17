import { Injectable, Logger } from '@nestjs/common';
import { IFieldRo } from '@teable-group/core';
import type { IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { Timing } from '../../../utils/timing';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { GraphService } from '../../graph/graph.service';
import { FieldConvertingService } from '../field-calculate/field-converting.service';
import { FieldCreatingService } from '../field-calculate/field-creating.service';
import { FieldDeletingService } from '../field-calculate/field-deleting.service';
import { FieldSupplementService } from '../field-calculate/field-supplement.service';
import { createFieldInstanceByVo } from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly prismaService: PrismaService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly graphService: GraphService
  ) {}

  async planField(tableId: string, fieldId: string) {
    return await this.graphService.planField(tableId, fieldId);
  }

  async planFieldCreate(tableId: string, fieldRo: IFieldRo) {
    return await this.graphService.planFieldCreate(tableId, fieldRo);
  }

  async planFieldUpdate(tableId: string, fieldId: string, updateFieldRo: IUpdateFieldRo) {
    return await this.graphService.planFieldUpdate(tableId, fieldId, updateFieldRo);
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
          }
        }
      },
      { timeout: 1_000_000 }
    );

    return fieldVo;
  }

  async deleteField(tableId: string, fieldId: string) {
    const field = await this.fieldDeletingService.getField(tableId, fieldId);

    await this.prismaService.$tx(async () => {
      await this.fieldDeletingService.alterDeleteField(tableId, field);
    });
  }

  async updateField(
    tableId: string,
    fieldId: string,
    updateFieldRo: IUpdateFieldRo
  ): Promise<IFieldVo> {
    // 1. stage analysis and collect field changes
    const { newField, oldField, modifiedOps, supplementChange } =
      await this.fieldConvertingService.stageAnalysis(tableId, fieldId, updateFieldRo);

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
    await this.prismaService.$tx(async () => {
      await this.fieldConvertingService.stageCalculate(tableId, newField, oldField, modifiedOps);

      if (supplementChange) {
        const { tableId, newField, oldField } = supplementChange;
        await this.fieldConvertingService.stageCalculate(tableId, newField, oldField);
      }
    });

    return instanceToPlain(newField, { excludePrefixes: ['_'] }) as IFieldVo;
  }
}
