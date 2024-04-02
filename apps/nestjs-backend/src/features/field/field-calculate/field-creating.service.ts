import { Injectable, Logger } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ViewService } from '../../view/view.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { FieldSupplementService } from './field-supplement.service';

@Injectable()
export class FieldCreatingService {
  private logger = new Logger(FieldCreatingService.name);

  constructor(
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService,
    private readonly fieldSupplementService: FieldSupplementService
  ) {}

  async createFieldItem(tableId: string, field: IFieldInstance) {
    const fieldId = field.id;

    await this.fieldSupplementService.createReference(field);

    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    await this.fieldService.batchCreateFields(tableId, dbTableName, [field]);

    await this.viewService.updateViewColumnMetaOrder(tableId, [fieldId]);
  }

  async alterCreateField(tableId: string, field: IFieldInstance) {
    const newFields: { tableId: string; field: IFieldInstance }[] = [];
    if (field.type === FieldType.Link && !field.isLookup) {
      await this.fieldSupplementService.createForeignKey(field.options);
      if (field.options.symmetricFieldId) {
        const symmetricField = await this.fieldSupplementService.generateSymmetricField(
          tableId,
          field
        );

        await this.createFieldItem(field.options.foreignTableId, symmetricField);
        newFields.push({ tableId: field.options.foreignTableId, field: symmetricField });
      }
      await this.createFieldItem(tableId, field);
      newFields.push({ tableId, field });
      return newFields;
    }

    await this.createFieldItem(tableId, field);
    return [{ tableId, field: field }];
  }
}
