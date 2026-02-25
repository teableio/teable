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
    initViewColumnMap?: Record<string, IColumn>,
    isSymmetricField?: boolean
  ) {
    const fieldId = field.id;

    await this.fieldSupplementService.createReference(field);
    await this.fieldSupplementService.createFieldTaskReference(tableId, field);

    const dbTableName = await this.fieldService.getDbTableName(tableId);

    await this.fieldService.batchCreateFields(tableId, dbTableName, [field], isSymmetricField);

    await this.viewService.initViewColumnMeta(
      tableId,
      [fieldId],
      initViewColumnMap && [initViewColumnMap]
    );
  }

  private async createFieldItemsBatch(
    tableId: string,
    fieldInstances: IFieldInstance[],
    initViewColumnMapList?: Array<Record<string, IColumn> | undefined>,
    isSymmetricField?: boolean
  ) {
    if (!fieldInstances.length) return;

    const dbTableName = await this.fieldService.getDbTableName(tableId);

    for (const field of fieldInstances) {
      await this.fieldSupplementService.createReference(field);
    }
    await this.fieldSupplementService.createFieldTaskReferences(tableId, fieldInstances);

    await this.fieldService.batchCreateFields(
      tableId,
      dbTableName,
      fieldInstances,
      isSymmetricField
    );

    const fieldIds = fieldInstances.map((field) => field.id);
    const shouldInit =
      !!initViewColumnMapList?.length &&
      initViewColumnMapList.some((m) => m && Object.keys(m).length);
    const normalizedInitList = shouldInit
      ? initViewColumnMapList.map((m) => m ?? ({} as Record<string, IColumn>))
      : undefined;

    await this.viewService.initViewColumnMeta(tableId, fieldIds, normalizedInitList);
  }

  async createFields(
    tableId: string,
    fieldInstances: IFieldInstance[],
    initViewColumnMap?: Record<string, IColumn>
  ) {
    const dbTableName = await this.fieldService.getDbTableName(tableId);

    for (const field of fieldInstances) {
      await this.fieldSupplementService.createReference(field);
    }
    await this.fieldSupplementService.createFieldTaskReferences(tableId, fieldInstances);
    const fieldIds = fieldInstances.map((field) => field.id);
    await this.viewService.initViewColumnMeta(
      tableId,
      fieldIds,
      initViewColumnMap && fieldIds.map(() => initViewColumnMap)
    );

    await this.fieldService.batchCreateFieldsAtOnce(tableId, dbTableName, fieldInstances);
  }

  async alterCreateFieldsInExistingTable(
    tableId: string,
    fields: Array<{ field: IFieldInstance; columnMeta?: Record<string, IColumn> }>
  ) {
    if (!fields.length) return [] as { tableId: string; field: IFieldInstance }[];

    const baseFieldInstances = fields.map(({ field }) => field);
    const initViewColumnMapList = fields.map(({ columnMeta }) => columnMeta);

    await this.createFieldItemsBatch(tableId, baseFieldInstances, initViewColumnMapList);

    const created: { tableId: string; field: IFieldInstance }[] = baseFieldInstances.map(
      (field) => ({
        tableId,
        field,
      })
    );

    const linkFields = baseFieldInstances.filter(
      (field) => field.type === FieldType.Link && !field.isLookup
    ) as LinkFieldDto[];

    // Generate and create symmetric fields one-by-one so that each subsequent
    // generateSymmetricField can see the previously created field records and
    // PostgreSQL columns, avoiding duplicate dbFieldName collisions.
    for (const linkField of linkFields) {
      if (!linkField.options.symmetricFieldId) continue;
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        tableId,
        linkField
      );
      const foreignTableId = linkField.options.foreignTableId;
      await this.createFieldItemsBatch(foreignTableId, [symmetricField], undefined, true);
      created.push({ tableId: foreignTableId, field: symmetricField });
    }

    return created;
  }

  async alterCreateField(tableId: string, field: IFieldInstance, columnMeta?: IColumnMeta) {
    const newFields: { tableId: string; field: IFieldInstance }[] = [];
    if (field.type === FieldType.Link && !field.isLookup) {
      // Foreign key creation is now handled by the visitor in createFieldItem
      await this.createFieldItem(tableId, field, columnMeta);
      newFields.push({ tableId, field });

      if (field.options.symmetricFieldId) {
        const symmetricField = await this.fieldSupplementService.generateSymmetricField(
          tableId,
          field
        );

        await this.createFieldItem(field.options.foreignTableId, symmetricField, columnMeta, true);
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

    if (linkFields.length) {
      const initViewColumnMapList = columnMeta
        ? linkFields.map(() => columnMeta as unknown as Record<string, IColumn>)
        : undefined;
      await this.createFieldItemsBatch(tableId, linkFields, initViewColumnMapList);

      // Generate and create symmetric fields one-by-one to avoid duplicate
      // dbFieldName collisions when multiple links target the same foreign table.
      for (const field of linkFields) {
        if (!field.options.symmetricFieldId) continue;
        const symmetricField = await this.fieldSupplementService.generateSymmetricField(
          tableId,
          field
        );
        const foreignTableId = field.options.foreignTableId;
        await this.createFieldItemsBatch(foreignTableId, [symmetricField], undefined, true);
        newFields.push({ tableId: foreignTableId, field: symmetricField });
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
