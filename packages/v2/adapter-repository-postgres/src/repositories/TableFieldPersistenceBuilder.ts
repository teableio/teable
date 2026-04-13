import {
  DbFieldName,
  FieldOptionsDtoVisitor,
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
  description: string | null;
  options: string | null;
  meta: string | null;
  ai_config: string | null;
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
  has_error: boolean | null;
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

type LookupOptionsValue = {
  linkFieldId?: string;
  foreignTableId?: string;
  lookupFieldId?: string;
  relationship?: string;
  [key: string]: unknown;
};

type ConditionalLookupOptionsValue = {
  foreignTableId?: string;
  lookupFieldId?: string;
  condition?: Record<string, unknown>;
  [key: string]: unknown;
};

type RollupConfigValue = {
  linkFieldId?: string;
  foreignTableId?: string;
  lookupFieldId?: string;
  condition?: Record<string, unknown>;
  [key: string]: unknown;
};

type LookupFieldLike = Field & {
  innerField(): Result<Field, DomainError>;
  innerOptionsPatch(): Readonly<Record<string, unknown>> | undefined;
  lookupOptionsDto(): LookupOptionsValue;
};

type ConditionalLookupFieldLike = Field & {
  innerField(): Result<Field, DomainError>;
  innerOptionsPatch(): Readonly<Record<string, unknown>> | undefined;
  conditionalLookupOptionsDto(): ConditionalLookupOptionsValue;
};

type RollupFieldLike = Field & {
  configDto(): RollupConfigValue;
};

export class TableFieldPersistenceBuilder {
  private dtoValue?: ITablePersistenceDTO;
  private storageTypeByIdValue?: ReadonlyMap<string, IFieldStorageType>;
  private fieldByIdValue?: ReadonlyMap<string, Field>;

  constructor(private readonly params: TableFieldPersistenceBuilderParams) {
    this.dtoValue = params.dto;
  }

  buildDbFieldMeta(): Result<ReadonlyArray<ITableDbFieldMeta>, DomainError> {
    const dtoResult = this.getDto();
    if (dtoResult.isErr()) return err(dtoResult.error);
    const dto = dtoResult.value;

    const reservedNames = new Set(baseRecordColumnNames);
    const fields = dto.fields.map((field) => {
      const baseName = field.dbFieldName ?? convertNameToValidCharacter(field.name, 40);
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
          field: this.getFieldById().get(field.field.id),
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
        field,
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

  private getFieldById(): ReadonlyMap<string, Field> {
    if (this.fieldByIdValue) return this.fieldByIdValue;

    this.fieldByIdValue = new Map(
      this.params.table.getFields().map((field) => [field.id().toString(), field] as const)
    );
    return this.fieldByIdValue;
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
    field?: Field;
    storageType: IFieldStorageType;
    dbFieldName: string;
    order: number;
  }): TableFieldRow {
    const { table, now, actorId } = this.params;
    const lookupOptions = this.serializeLookupOptions(params.fieldDto, params.field);
    const lookupLinkedFieldId = this.resolveLookupLinkedFieldId(params.fieldDto, params.field);
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

    const serializedAiConfig =
      params.fieldDto.aiConfig === undefined || params.fieldDto.aiConfig === null
        ? null
        : JSON.stringify(params.fieldDto.aiConfig);

    return {
      id: params.fieldDto.id,
      name: params.fieldDto.name,
      description: params.fieldDto.description ?? null,
      options: this.serializeFieldOptions(params.fieldDto, params.field),
      meta: this.serializeFieldMeta(params.fieldDto),
      ai_config: serializedAiConfig,
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
      has_error: typeof params.fieldDto.hasError === 'boolean' ? params.fieldDto.hasError : null,
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

  private serializeFieldOptions(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): string | null {
    const resolvedFieldOptions = this.resolveFieldOptions(field, domainField);
    if (resolvedFieldOptions === undefined) return null;

    if (field.type === 'conditionalLookup') {
      const innerOptions = this.resolveConditionalLookupInnerOptions(field, domainField);
      if (innerOptions === undefined) return null;
      return JSON.stringify(innerOptions);
    }

    // For conditionalRollup, match v1 format: flatten config into options
    // v1 stores: expression, timeZone, formatting, showAs, foreignTableId, lookupFieldId, filter, sort, limit
    if (field.type === 'conditionalRollup') {
      const config = this.resolveConditionalRollupConfig(field, domainField);
      if (!config) return JSON.stringify(resolvedFieldOptions);
      const condition = config.condition as Record<string, unknown> | undefined;
      return JSON.stringify({
        ...resolvedFieldOptions,
        foreignTableId: config.foreignTableId,
        lookupFieldId: config.lookupFieldId,
        // Convert condition to v1 filter format
        filter: condition?.filter ?? null,
        sort: condition?.sort,
        limit: condition?.limit,
      });
    }

    return JSON.stringify(resolvedFieldOptions);
  }

  private serializeLookupOptions(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): string | null {
    if (field.type === 'conditionalLookup') {
      const opts = this.resolveConditionalLookupOptions(field, domainField);
      if (!opts) return null;
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
    const lookupDefinition = this.resolveLookupOptions(field, domainField);
    if (field.isLookup && lookupDefinition) {
      const linkOptions = this.resolveLinkFieldOptions(lookupDefinition.linkFieldId);
      if (!linkOptions) return JSON.stringify(lookupDefinition);
      const normalizedLinkOptions = this.normalizeLookupLinkedOptions(linkOptions);
      return JSON.stringify({
        ...normalizedLinkOptions,
        ...lookupDefinition,
        linkFieldId: lookupDefinition.linkFieldId,
      });
    }

    // Handle rollup fields (config contains linkFieldId, foreignTableId, lookupFieldId)
    const rollupConfig = this.resolveRollupConfig(field, domainField);
    if (field.type === 'rollup' && rollupConfig) {
      const linkOptions = this.resolveLinkFieldOptions(rollupConfig.linkFieldId);
      if (!linkOptions) return JSON.stringify(rollupConfig);
      return JSON.stringify({
        ...this.normalizeLookupLinkedOptions(linkOptions),
        ...rollupConfig,
        linkFieldId: rollupConfig.linkFieldId,
      });
    }

    return null;
  }

  private resolveLookupLinkedFieldId(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): string | null {
    if (field.type === 'conditionalLookup') {
      return null;
    }

    // Handle lookup fields
    const lookupDefinition = this.resolveLookupOptions(field, domainField);
    if (field.isLookup && lookupDefinition) {
      return lookupDefinition.linkFieldId ?? null;
    }

    // Handle rollup fields
    const rollupConfig = this.resolveRollupConfig(field, domainField);
    if (field.type === 'rollup' && rollupConfig) {
      return rollupConfig.linkFieldId ?? null;
    }

    return null;
  }

  private resolveFieldOptions(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): unknown | undefined {
    if (field.type === 'conditionalLookup') {
      return this.resolveConditionalLookupInnerOptions(field, domainField);
    }
    if (field.options !== undefined) {
      return field.options;
    }
    return domainField ? this.extractPersistedOptionsFromField(domainField) : undefined;
  }

  private resolveConditionalLookupInnerOptions(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): unknown | undefined {
    if (field.type !== 'conditionalLookup') {
      return field.options;
    }
    if (field.innerOptions !== undefined) {
      return field.innerOptions;
    }
    if (!domainField || domainField.type().toString() !== 'conditionalLookup') {
      return undefined;
    }
    return this.extractLookupInnerOptions(domainField as ConditionalLookupFieldLike);
  }

  private resolveConditionalLookupOptions(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): ConditionalLookupOptionsValue | undefined {
    if (field.type !== 'conditionalLookup') {
      return undefined;
    }
    if (field.options && typeof field.options === 'object' && !Array.isArray(field.options)) {
      return field.options as ConditionalLookupOptionsValue;
    }
    if (!domainField || domainField.type().toString() !== 'conditionalLookup') {
      return undefined;
    }
    return (domainField as ConditionalLookupFieldLike).conditionalLookupOptionsDto();
  }

  private resolveLookupOptions(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): LookupOptionsValue | undefined {
    if (field.lookupOptions) {
      return field.lookupOptions as LookupOptionsValue;
    }
    if (!domainField || domainField.type().toString() !== 'lookup') {
      return undefined;
    }
    return (domainField as LookupFieldLike).lookupOptionsDto();
  }

  private resolveRollupConfig(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): RollupConfigValue | undefined {
    if (field.type !== 'rollup') {
      return undefined;
    }
    if (field.config) {
      return field.config as RollupConfigValue;
    }
    if (!domainField || domainField.type().toString() !== 'rollup') {
      return undefined;
    }
    return (domainField as RollupFieldLike).configDto();
  }

  private resolveConditionalRollupConfig(
    field: ITableFieldPersistenceDTO,
    domainField?: Field
  ): RollupConfigValue | undefined {
    if (field.type !== 'conditionalRollup') {
      return undefined;
    }
    if (field.config) {
      return field.config as RollupConfigValue;
    }
    if (!domainField || domainField.type().toString() !== 'conditionalRollup') {
      return undefined;
    }
    return (domainField as RollupFieldLike).configDto();
  }

  private extractPersistedOptionsFromField(field: Field): unknown | undefined {
    if (field.type().toString() === 'lookup') {
      return this.extractLookupInnerOptions(field as LookupFieldLike);
    }
    if (field.type().toString() === 'conditionalLookup') {
      return this.extractLookupInnerOptions(field as ConditionalLookupFieldLike);
    }

    const optionsResult = field.accept(new FieldOptionsDtoVisitor());
    return optionsResult.isOk() ? optionsResult.value : undefined;
  }

  private extractLookupInnerOptions(
    field: LookupFieldLike | ConditionalLookupFieldLike
  ): unknown | undefined {
    const innerFieldResult = field.innerField();
    if (innerFieldResult.isErr()) {
      return undefined;
    }

    const innerOptionsResult = innerFieldResult.value.accept(new FieldOptionsDtoVisitor());
    if (innerOptionsResult.isErr()) {
      return undefined;
    }

    return this.mergeLookupInnerOptions(innerOptionsResult.value, field.innerOptionsPatch());
  }

  private mergeLookupInnerOptions(
    innerOptions: unknown,
    innerOptionsPatch?: Readonly<Record<string, unknown>>
  ): unknown | undefined {
    if (!innerOptionsPatch || Object.keys(innerOptionsPatch).length === 0) {
      return innerOptions;
    }

    if (!innerOptions || typeof innerOptions !== 'object' || Array.isArray(innerOptions)) {
      return innerOptions;
    }

    return {
      ...(innerOptions as Record<string, unknown>),
      ...innerOptionsPatch,
    };
  }

  private normalizeLookupLinkedOptions(
    linkOptions: ILinkFieldOptionsDTO
  ): Partial<ILinkFieldOptionsDTO> {
    const options: Partial<ILinkFieldOptionsDTO> = { ...linkOptions };
    if (options.isOneWay === false) {
      delete options.isOneWay;
    }
    if ('symmetricFieldId' in options) {
      delete options.symmetricFieldId;
    }
    return options;
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
