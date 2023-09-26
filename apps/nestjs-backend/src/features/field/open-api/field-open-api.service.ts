import { Injectable, Logger } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { FieldSupplementService } from '../field-supplement.service';
import { createFieldInstanceByVo } from '../model/factory';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';

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
      const fieldVo = await this.fieldSupplementService.prepareCreateField(fieldRo);
      const fieldInstance = createFieldInstanceByVo(fieldVo);
      return await this.fieldCreatingService.createField(tableId, fieldInstance);
    });
  }

  async deleteField(tableId: string, fieldId: string) {
    return await this.prismaService.$tx(async () => {
      return await this.fieldDeletingService.deleteField(tableId, fieldId);
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
