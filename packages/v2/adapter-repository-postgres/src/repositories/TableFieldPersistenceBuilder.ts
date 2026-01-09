import {
  DbFieldName,
  FieldSpecBuilder,
  type Field,
  type ILinkFieldOptionsDTO,
  type ITableFieldPersistenceDTO,
  type ITableMapper,
  type ITablePersistenceDTO,
  type Table,
  domainError,
  type DomainError,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ITableDbFieldMeta } from '../db/tableDbMeta';
import {
  baseRecordColumnNames,
  convertNameToValidCharacter,
  ensureUniqueDbFieldName,
} from '../naming';
import {
  FieldStorageTypeVisitor,
  type IFieldStorageType,
} from './visitors/FieldStorageTypeVisitor';

export type TableFieldRow = {
  id: string;
  name: string;
  description: null;
  options: string | null;
  meta: string | null;
  ai_config: null;
  type: string;
  cell_value_type: string;
  is_multiple_cell_value: boolean;
  db_field_type: string;
  db_field_name: string;
  not_null: boolean | null;
  unique: boolean | null;
  is_primary: boolean | null;
  is_computed: boolean | null;
  is_lookup: boolean | null;
  is_conditional_lookup: boolean | null;
  is_pending: null;
  has_error: null;
  lookup_linked_field_id: string | null;
  lookup_options: string | null;
  table_id: string;
  order: number;
  version: number;
  created_time: Date;
  last_modified_time: Date;
  deleted_time: null;
  created_by: string;
  last_modified_by: string;
};

type TableFieldPersistenceBuilderParams = {
  table: Table;
  tableMapper: ITableMapper;
  now: Date;
  actorId: string;
  dto?: ITablePersistenceDTO;
};

export class TableFieldPersistenceBuilder {
  private dtoValue?: ITablePersistenceDTO;
  private storageTypeByIdValue?: ReadonlyMap<string, IFieldStorageType>;

  constructor(private readonly params: TableFieldPersistenceBuilderParams) {
    this.dtoValue = params.dto;
  }

  buildDbFieldMeta(): Result<ReadonlyArray<ITableDbFieldMeta>, DomainError> {
    const dtoResult = this.getDto();
    if (dtoResult.isErr()) return err(dtoResult.error);
    const dto = dtoResult.value;

    const reservedNames = new Set(baseRecordColumnNames);
    const fields = dto.fields.map((field) => {
      const baseName = convertNameToValidCharacter(field.name, 40);
      const dbFieldName = ensureUniqueDbFieldName(baseName, reservedNames);
      reservedNames.add(dbFieldName);
      return { field, dbFieldName };
    });

    return ok(fields);
  }

  buildRowsFromDbMeta(
    fields: ReadonlyArray<ITableDbFieldMeta>
  ): Result<ReadonlyArray<TableFieldRow>, DomainError> {
    const storageTypeByIdResult = this.getStorageTypeById();
    if (storageTypeByIdResult.isErr()) return err(storageTypeByIdResult.error);
    const storageTypeById = storageTypeByIdResult.value;

    const results = fields.map((field, index) => {
      const storageType = storageTypeById.get(field.field.id);
      if (!storageType)
        return err(
          domainError.validation({
            message: `Missing storage type for field ${field.field.id}`,
          })
        );
      return ok(
        this.buildRowValue({
          fieldDto: field.field,
          storageType,
          dbFieldName: field.dbFieldName,
          order: index + 1,
        })
      );
    });

    return results.reduce<Result<ReadonlyArray<TableFieldRow>, DomainError>>(
      (acc, next) => acc.andThen((rows) => next.map((row) => [...rows, row])),
      ok([])
    );
  }

  buildRowForField(field: Field): Result<TableFieldRow, DomainError> {
    const fieldDtoResult = this.resolveFieldDto(field);
    if (fieldDtoResult.isErr()) return err(fieldDtoResult.error);
    const { fieldDto, storageType } = fieldDtoResult.value;

    const dbFieldNameResult = this.resolveDbFieldName(field);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);

    const orderResult = this.resolveFieldOrder(field);
    if (orderResult.isErr()) return err(orderResult.error);

    return ok(
      this.buildRowValue({
        fieldDto,
        storageType,
        dbFieldName: dbFieldNameResult.value,
        order: orderResult.value,
      })
    );
  }

  private getDto(): Result<ITablePersistenceDTO, DomainError> {
    if (this.dtoValue) return ok(this.dtoValue);

    const dtoResult = this.params.tableMapper.toDTO(this.params.table);
    if (dtoResult.isErr()) return err(dtoResult.error);
    this.dtoValue = dtoResult.value;
    return ok(dtoResult.value);
  }

  private getStorageTypeById(): Result<ReadonlyMap<string, IFieldStorageType>, DomainError> {
    if (this.storageTypeByIdValue) return ok(this.storageTypeByIdValue);

    const visitor = new FieldStorageTypeVisitor();
    const applyResult = visitor.apply(this.params.table);
    if (applyResult.isErr()) return err(applyResult.error);
    this.storageTypeByIdValue = visitor.typesById();
    return ok(this.storageTypeByIdValue);
  }

  private resolveFieldDto(
    field: Field
  ): Result<{ fieldDto: ITableFieldPersistenceDTO; storageType: IFieldStorageType }, DomainError> {
    const dtoResult = this.getDto();
    if (dtoResult.isErr()) return err(dtoResult.error);
    const dto = dtoResult.value;

    const fieldDto = dto.fields.find((item) => item.id === field.id().toString());
    if (!fieldDto)
      return err(
        domainError.validation({
          message: `Missing field DTO for ${field.id().toString()}`,
        })
      );

    const storageTypeByIdResult = this.getStorageTypeById();
    if (storageTypeByIdResult.isErr()) return err(storageTypeByIdResult.error);
    const storageType = storageTypeByIdResult.value.get(field.id().toString());
    if (!storageType)
      return err(
        domainError.validation({
          message: `Missing storage type for field ${field.id().toString()}`,
        })
      );

    return ok({ fieldDto, storageType });
  }

  private resolveFieldOrder(field: Field): Result<number, DomainError> {
    const fieldSpecResult = FieldSpecBuilder.create().withFieldId(field.id()).build();
    if (fieldSpecResult.isErr()) return err(fieldSpecResult.error);
    const [matched] = this.params.table.getFields(fieldSpecResult.value);
    if (!matched)
      return err(
        domainError.validation({
          message: `Missing field order for ${field.id().toString()}`,
        })
      );

    const fields = this.params.table.getFields();
    for (let index = 0; index < fields.length; index += 1) {
      if (fields[index]?.id().equals(matched.id())) {
        return ok(index + 1);
      }
    }

    return err(
      domainError.validation({
        message: `Missing field order for ${field.id().toString()}`,
      })
    );
  }

  private resolveDbFieldName(field: Field): Result<string, DomainError> {
    const existingResult = field.dbFieldName().andThen((name) => name.value());
    if (existingResult.isOk()) return ok(existingResult.value);

    const reservedNames = new Set(baseRecordColumnNames);
    for (const existing of this.params.table.getFields()) {
      const nameResult = existing.dbFieldName().andThen((name) => name.value());
      if (nameResult.isOk()) reservedNames.add(nameResult.value);
    }

    const baseName = convertNameToValidCharacter(field.name().toString(), 40);
    const nextName = ensureUniqueDbFieldName(baseName, reservedNames);

    return DbFieldName.rehydrate(nextName).andThen((dbFieldName) =>
      field.setDbFieldName(dbFieldName).map(() => nextName)
    );
  }

  private buildRowValue(params: {
    fieldDto: ITableFieldPersistenceDTO;
    storageType: IFieldStorageType;
    dbFieldName: string;
    order: number;
  }): TableFieldRow {
    const { table, now, actorId } = this.params;
    const lookupOptions = this.serializeLookupOptions(params.fieldDto);
    const lookupLinkedFieldId = this.resolveLookupLinkedFieldId(params.fieldDto);
    const notNull = typeof params.fieldDto.notNull === 'boolean' ? params.fieldDto.notNull : null;
    const unique = typeof params.fieldDto.unique === 'boolean' ? params.fieldDto.unique : null;

    const isConditionalLookupField = params.fieldDto.type === 'conditionalLookup';
    const isLookup = isConditionalLookupField
      ? true
      : typeof params.fieldDto.isLookup === 'boolean'
        ? params.fieldDto.isLookup
        : null;
    const isConditionalLookup = isConditionalLookupField
      ? true
      : typeof params.fieldDto.isConditionalLookup === 'boolean'
        ? params.fieldDto.isConditionalLookup
        : null;
    const persistedType = this.resolvePersistedFieldType(params.fieldDto);

    return {
      id: params.fieldDto.id,
      name: params.fieldDto.name,
      description: null,
      options: this.serializeFieldOptions(params.fieldDto),
      meta: this.serializeFieldMeta(params.fieldDto),
      ai_config: null,
      type: persistedType,
      cell_value_type: params.storageType.cellValueType,
      is_multiple_cell_value: params.storageType.isMultipleCellValue,
      db_field_type: params.storageType.dbFieldType,
      db_field_name: params.dbFieldName,
      not_null: notNull,
      unique: unique,
      is_primary: params.fieldDto.id === table.primaryFieldId().toString() ? true : null,
      is_computed:
        typeof params.fieldDto.isComputed === 'boolean' ? params.fieldDto.isComputed : null,
      is_lookup: isLookup,
      is_conditional_lookup: isConditionalLookup,
      is_pending: null,
      has_error: null,
      lookup_linked_field_id: lookupLinkedFieldId,
      lookup_options: lookupOptions,
      table_id: table.id().toString(),
      order: params.order,
      version: 1,
      created_time: now,
      last_modified_time: now,
      deleted_time: null,
      created_by: actorId,
      last_modified_by: actorId,
    };
  }

  private serializeFieldOptions(field: ITableFieldPersistenceDTO): string | null {
    if (field.options === undefined) return null;

    if (field.type === 'conditionalLookup') {
      const innerOptions = field.innerOptions;
      if (innerOptions === undefined) return null;
      return JSON.stringify(innerOptions);
    }

    // For conditionalRollup, match v1 format: flatten config into options
    // v1 stores: expression, timeZone, formatting, showAs, foreignTableId, lookupFieldId, filter, sort, limit
    if (field.type === 'conditionalRollup' && field.config) {
      const config = field.config as Record<string, unknown>;
      const condition = config.condition as Record<string, unknown> | undefined;
      return JSON.stringify({
        ...field.options,
        foreignTableId: config.foreignTableId,
        lookupFieldId: config.lookupFieldId,
        // Convert condition to v1 filter format
        filter: condition?.filter ?? null,
        sort: condition?.sort,
        limit: condition?.limit,
      });
    }

    return JSON.stringify(field.options);
  }

  private serializeLookupOptions(field: ITableFieldPersistenceDTO): string | null {
    if (field.type === 'conditionalLookup') {
      const opts = field.options as Record<string, unknown>;
      const condition = opts.condition as Record<string, unknown> | undefined;
      return JSON.stringify({
        foreignTableId: opts.foreignTableId,
        lookupFieldId: opts.lookupFieldId,
        filter: condition?.filter ?? null,
        sort: condition?.sort,
        limit: condition?.limit,
      });
    }

    // Handle lookup fields (lookupOptions is directly on the DTO)
    if (field.isLookup && field.lookupOptions) {
      const linkOptions = this.resolveLinkFieldOptions(field.lookupOptions.linkFieldId);
      if (!linkOptions) return JSON.stringify(field.lookupOptions);
      return JSON.stringify({
        ...linkOptions,
        ...field.lookupOptions,
        linkFieldId: field.lookupOptions.linkFieldId,
      });
    }

    // Handle rollup fields (config contains linkFieldId, foreignTableId, lookupFieldId)
    if (field.type === 'rollup' && field.config) {
      const linkOptions = this.resolveLinkFieldOptions(field.config.linkFieldId);
      if (!linkOptions) return JSON.stringify(field.config);
      return JSON.stringify({
        ...linkOptions,
        ...field.config,
        linkFieldId: field.config.linkFieldId,
      });
    }

    return null;
  }

  private resolveLookupLinkedFieldId(field: ITableFieldPersistenceDTO): string | null {
    if (field.type === 'conditionalLookup') {
      return null;
    }

    // Handle lookup fields
    if (field.isLookup && field.lookupOptions) {
      return field.lookupOptions.linkFieldId ?? null;
    }

    // Handle rollup fields
    if (field.type === 'rollup' && field.config) {
      return field.config.linkFieldId ?? null;
    }

    return null;
  }

  private resolveLinkFieldOptions(
    linkFieldId: string | undefined
  ): ILinkFieldOptionsDTO | undefined {
    if (!linkFieldId) return undefined;
    const dto = this.dtoValue;
    if (!dto) return undefined;
    const linkField = dto.fields.find((item) => item.id === linkFieldId && item.type === 'link');
    if (!linkField || linkField.type !== 'link') return undefined;
    return linkField.options;
  }

  private serializeFieldMeta(field: ITableFieldPersistenceDTO): string | null {
    if ('meta' in field && field.meta !== undefined) {
      return JSON.stringify(field.meta);
    }
    return null;
  }

  private resolvePersistedFieldType(field: ITableFieldPersistenceDTO): string {
    if (field.type !== 'conditionalLookup') return field.type;
    if (field.innerType && field.innerType.length > 0) return field.innerType;
    return 'singleLineText';
  }
}
