import { Injectable, Logger } from '@nestjs/common';
import type { IColumn, IColumnMeta } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ViewService } from '../../view/view.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
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

  async createFieldItem(
    tableId: string,
    field: IFieldInstance,
    initViewColumnMap?: Record<string, IColumn>
  ) {
    const fieldId = field.id;

    await this.fieldSupplementService.createReference(field);
    await this.fieldSupplementService.createFieldTaskReference(tableId, field);

    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    await this.fieldService.batchCreateFields(tableId, dbTableName, [field]);

    await this.viewService.initViewColumnMeta(
      tableId,
      [fieldId],
      initViewColumnMap && [initViewColumnMap]
    );
  }

  async createFields(
    tableId: string,
    fieldInstances: IFieldInstance[],
    initViewColumnMap?: Record<string, IColumn>
  ) {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    for (const field of fieldInstances) {
      await this.fieldSupplementService.createReference(field);
      await this.fieldSupplementService.createFieldTaskReference(tableId, field);
    }
    const fieldIds = fieldInstances.map((field) => field.id);
    await this.viewService.initViewColumnMeta(
      tableId,
      fieldIds,
      initViewColumnMap && fieldIds.map(() => initViewColumnMap)
    );

    await this.fieldService.batchCreateFieldsAtOnce(tableId, dbTableName, fieldInstances);
  }

  async alterCreateField(tableId: string, field: IFieldInstance, columnMeta?: IColumnMeta) {
    const newFields: { tableId: string; field: IFieldInstance }[] = [];
    if (field.type === FieldType.Link && !field.isLookup) {
      await this.fieldSupplementService.createForeignKey(tableId, field);
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

  async alterCreateFields(
    tableId: string,
    fieldInstances: IFieldInstance[],
    columnMeta?: IColumnMeta
  ) {
    const newFields: { tableId: string; field: IFieldInstance }[] = fieldInstances.map((field) => ({
      tableId,
      field,
    }));

    const primaryField = fieldInstances.find((field) => field.isPrimary)!;

    await this.createFieldItem(tableId, primaryField, columnMeta);

    const linkFields = fieldInstances.filter(
      (field) => field.type === FieldType.Link && !field.isLookup
    ) as LinkFieldDto[];

    for (const field of linkFields) {
      await this.fieldSupplementService.createForeignKey(tableId, field);
      await this.createFieldItem(tableId, field, columnMeta);
      if (field.options.symmetricFieldId) {
        const symmetricField = await this.fieldSupplementService.generateSymmetricField(
          tableId,
          field
        );

        await this.createFieldItem(field.options.foreignTableId, symmetricField);
        newFields.push({ tableId: field.options.foreignTableId, field: symmetricField });
      }
    }

    const otherFields = fieldInstances.filter(
      ({ id, isPrimary }) =>
        (linkFields.length ? !linkFields.map(({ id }) => id).includes(id) : true) && !isPrimary
    );

    await this.createFields(tableId, otherFields, columnMeta);
    return newFields;
  }
}
