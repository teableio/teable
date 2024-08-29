import { Injectable, Logger } from '@nestjs/common';
import type { IColumnMeta } from '@teable/core';
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

  async createFieldItem(tableId: string, field: IFieldInstance, columnMeta?: IColumnMeta) {
    const fieldId = field.id;

    await this.fieldSupplementService.createReference(field);

    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    await this.fieldService.batchCreateFields(tableId, dbTableName, [field]);

    await this.viewService.initViewColumnMeta(tableId, [fieldId], columnMeta && [columnMeta]);
  }

  async alterCreateField(tableId: string, field: IFieldInstance, columnMeta?: IColumnMeta) {
    const newFields: { tableId: string; field: IFieldInstance }[] = [];
    if (field.type === FieldType.Link && !field.isLookup) {
      await this.fieldSupplementService.createForeignKey(field.options);
      await this.createFieldItem(tableId, field, columnMeta);
      newFields.push({ tableId, field });

      if (field.options.symmetricFieldId) {
        const symmetricField = await this.fieldSupplementService.generateSymmetricField(
          tableId,
          field
        );

        await this.createFieldItem(field.options.foreignTableId, symmetricField);
        newFields.push({ tableId: field.options.foreignTableId, field: symmetricField });
      }

      return newFields;
    }

    await this.createFieldItem(tableId, field, columnMeta);
    return [{ tableId, field: field }];
  }
}
