import { Injectable, Logger } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { FieldConvertingService } from '../field-calculate/field-converting.service';
import { FieldCreatingService } from '../field-calculate/field-creating.service';
import { FieldDeletingService } from '../field-calculate/field-deleting.service';
import { FieldSupplementService } from '../field-calculate/field-supplement.service';
import { createFieldInstanceByVo } from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly fieldSupplementService: FieldSupplementService
  ) {}

  async createField(tableId: string, fieldRo: IFieldRo) {
    return await this.prismaService.$tx(async () => {
      const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, fieldRo);
      const fieldInstance = createFieldInstanceByVo(fieldVo);
      return await this.fieldCreatingService.createField(tableId, fieldInstance);
    });
  }

  async deleteField(tableId: string, fieldId: string) {
    await this.prismaService.$tx(async () => {
      await this.fieldDeletingService.deleteField(tableId, fieldId);
    });
  }

  async updateFieldById(
    tableId: string,
    fieldId: string,
    updateFieldRo: IUpdateFieldRo
  ): Promise<IFieldVo> {
    return await this.prismaService.$tx(async () => {
      return await this.fieldConvertingService.updateFieldById(tableId, fieldId, updateFieldRo);
    });
  }
}
