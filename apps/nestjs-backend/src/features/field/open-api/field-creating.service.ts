import { Injectable, Logger } from '@nestjs/common';
import type { IFieldVo } from '@teable-group/core';
import { FieldOpBuilder, getUniqName, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { merge } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';

@Injectable()
export class FieldCreatingService {
  private logger = new Logger(FieldCreatingService.name);

  constructor(
    private readonly shareDbService: ShareDbService,
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

    const rawOpsMap = await this.fieldService.batchCreateFields(tableId, dbTableName, [field]);

    if (field.isComputed) {
      const rowRawOpsMap = await this.fieldCalculationService.calculateFields(tableId, [fieldId]);
      merge(rawOpsMap, rowRawOpsMap);
    }

    return {
      snapshot: this.createField2Ops(field),
      rawOpsMap,
    };
  }

  async createField(tableId: string, field: IFieldInstance): Promise<IFieldVo> {
    if (field.type === FieldType.Link && !field.isLookup) {
      await this.fieldSupplementService.createForeignKey(tableId, field);
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        field
      );

      const result1 = await this.createAndCalculate(tableId, field);
      const result2 = await this.createAndCalculate(field.options.foreignTableId, symmetricField);
      result1.rawOpsMap && this.shareDbService.publishOpsMap(result1.rawOpsMap);
      result2.rawOpsMap && this.shareDbService.publishOpsMap(result2.rawOpsMap);
      return result1.snapshot;
    }
    const result = await this.createAndCalculate(tableId, field);
    result.rawOpsMap && this.shareDbService.publishOpsMap(result.rawOpsMap);
    console.log('publish:', JSON.stringify(result.rawOpsMap, null, 2));
    console.log(`create document ${tableId}.${field.id} succeed!`);
    return result.snapshot;
  }

  createField2Ops(fieldInstance: IFieldInstance) {
    return FieldOpBuilder.creator.build(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as IFieldVo
    );
  }
}
