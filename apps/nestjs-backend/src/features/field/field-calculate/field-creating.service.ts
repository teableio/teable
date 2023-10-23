import { Injectable, Logger } from '@nestjs/common';
import type { IFieldVo } from '@teable-group/core';
import { FieldOpBuilder, getUniqName, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { FieldSupplementService } from './field-supplement.service';

@Injectable()
export class FieldCreatingService {
  private logger = new Logger(FieldCreatingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService
  ) {}

  async uniqFieldName(tableId: string, fieldName: string) {
    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true },
    });

    const names = fieldRaw.map((item) => item.name);
    const uniqName = getUniqName(fieldName, names);
    if (uniqName !== fieldName) {
      return uniqName;
    }
    return fieldName;
  }

  async createAndCalculate(tableId: string, field: IFieldInstance) {
    const fieldId = field.id;

    const uniqName = await this.uniqFieldName(tableId, field.name);

    field.name = uniqName;

    await this.fieldSupplementService.createReference(field);

    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    await this.fieldService.batchCreateFields(tableId, dbTableName, [field]);

    if (field.isComputed) {
      await this.fieldCalculationService.calculateFields(tableId, [fieldId]);
    }

    return this.createField2Ops(field);
  }

  async createField(tableId: string, field: IFieldInstance): Promise<IFieldVo> {
    if (field.type === FieldType.Link && !field.isLookup) {
      await this.fieldSupplementService.createForeignKey(tableId, field);
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        field
      );

      await this.createAndCalculate(field.options.foreignTableId, symmetricField);
      return this.createAndCalculate(tableId, field);
    }

    return this.createAndCalculate(tableId, field);
  }

  createField2Ops(fieldInstance: IFieldInstance) {
    return FieldOpBuilder.creator.build(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as IFieldVo
    );
  }
}
