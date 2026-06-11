import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../../base/BaseId';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../../shared/specification/composeAndSpecs';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { DbTableName } from '../../DbTableName';
import { ForeignTable } from '../../ForeignTable';
import type {
  FieldDeletionContext,
  FieldDeletionReaction,
  OnTeableFieldDeleted,
} from '../../OnTeableFieldDeleted';
import type {
  OnTeableTableDeleted,
  TableDeletionContext,
  TableDeletionReaction,
} from '../../OnTeableTableDeleted';
import { UpdateLinkConfigSpec } from '../../specs/field-updates/UpdateLinkConfigSpec';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { ViewId } from '../../views/ViewId';
import type { DbFieldName } from '../DbFieldName';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import {
  buildFieldFilterSyncPlan,
  hasFieldFilterSyncPlanChanges,
  hasFieldReferenceInFilter,
  isEquivalentFilter,
  syncFilterByFieldChangesWithId,
  syncFilterByFieldChanges,
} from '../filter-sync';
import type {
  ForeignTableRelatedField,
  ForeignTableValidationContext,
} from '../ForeignTableRelatedField';
import type { FieldUpdateContext, OnTeableFieldUpdated } from '../OnTeableFieldUpdated';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import {
  LinkFieldConfig,
  type LinkFieldConfigValue,
  type LinkFieldDbConfig,
} from './LinkFieldConfig';
import { LinkFieldMeta, type LinkFieldMetaValue } from './LinkFieldMeta';
import type { LinkRelationship } from './LinkRelationship';
import { SingleLineTextField } from './SingleLineTextField';

export class LinkField
  extends Field
  implements
    ForeignTableRelatedField,
    OnTeableFieldUpdated,
    OnTeableFieldDeleted,
    OnTeableTableDeleted
{
  private constructor(
    id: FieldId,
    name: FieldName,
    private configValue: LinkFieldConfig,
    private readonly metaValue: LinkFieldMeta | undefined
  ) {
    super(id, name, FieldType.link());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    config: LinkFieldConfig;
    meta?: LinkFieldMeta;
  }): Result<LinkField, DomainError> {
    return ok(new LinkField(params.id, params.name, params.config, params.meta));
  }

  static createNew(params: {
    id: FieldId;
    name: FieldName;
    config: LinkFieldConfig;
    baseId: BaseId;
    hostTableId: TableId;
    hostTableDbTableName?: DbTableName;
    foreignTableDbTableName?: DbTableName;
    meta?: LinkFieldMeta;
  }): Result<LinkField, DomainError> {
    const metaResult = params.meta
      ? ok(params.meta)
      : LinkField.defaultMetaForConfig(params.config);

    return LinkField.normalizeCrossBaseConfig(params.config, params.baseId).andThen((config) =>
      metaResult.andThen((meta) =>
        LinkField.create({
          id: params.id,
          name: params.name,
          config,
          meta,
        }).andThen((field) =>
          field
            .ensureDbConfig({
              baseId: params.baseId,
              hostTableId: params.hostTableId,
              hostTableDbTableName: params.hostTableDbTableName,
              foreignTableDbTableName: params.foreignTableDbTableName,
            })
            .map(() => field)
        )
      )
    );
  }

  config(): LinkFieldConfig {
    return this.configValue;
  }

  configDto(): Result<LinkFieldConfigValue, DomainError> {
    return this.configValue.toDto();
  }

  meta(): LinkFieldMeta | undefined {
    return this.metaValue;
  }

  metaDto(): LinkFieldMetaValue | undefined {
    return this.metaValue?.toDto();
  }

  baseId(): BaseId | undefined {
    return this.configValue.baseId();
  }

  relationship(): LinkRelationship {
    return this.configValue.relationship();
  }

  foreignTableId(): TableId {
    return this.configValue.foreignTableId();
  }

  lookupFieldId(): FieldId {
    return this.configValue.lookupFieldId();
  }

  symmetricFieldId(): FieldId | undefined {
    return this.configValue.symmetricFieldId();
  }

  isOneWay(): boolean {
    return this.configValue.isOneWay();
  }

  isMultipleValue(): boolean {
    return this.configValue.isMultipleValue();
  }

  /**
   * Returns true if this link field requires that each foreign record
   * can only be linked to ONE source record (exclusivity constraint).
   *
   * This is true for oneOne and oneMany relationships.
   */
  requiresExclusiveForeignRecord(): boolean {
    return this.relationship().requiresExclusiveForeignRecord();
  }

  fkHostTableName(): DbTableName {
    return this.configValue.fkHostTableName();
  }

  fkHostTableNameString(): Result<string, DomainError> {
    return this.configValue.fkHostTableNameString();
  }

  selfKeyName(): DbFieldName {
    return this.configValue.selfKeyName();
  }

  selfKeyNameString(): Result<string, DomainError> {
    return this.configValue.selfKeyNameString();
  }

  foreignKeyName(): DbFieldName {
    return this.configValue.foreignKeyName();
  }

  foreignKeyNameString(): Result<string, DomainError> {
    return this.configValue.foreignKeyNameString();
  }

  filterByViewId(): ViewId | null | undefined {
    return this.configValue.filterByViewId();
  }

  visibleFieldIds(): ReadonlyArray<FieldId> | null | undefined {
    return this.configValue.visibleFieldIds();
  }

  isCrossBase(): boolean {
    return this.configValue.isCrossBase();
  }

  hasOrderColumn(): boolean {
    return this.metaValue?.hasOrderColumn() ?? false;
  }

  orderColumnName(): Result<string, DomainError> {
    // One-way OneMany can keep a legacy ManyMany junction "__order" column during
    // metadata-only relationship switches.
    if (this.relationship().toString() === 'oneMany' && this.isOneWay() && this.hasOrderColumn()) {
      return ok('__order');
    }
    return this.configValue.orderColumnName();
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return this.configDto().andThen((config) =>
      LinkFieldConfig.create({
        baseId: config.baseId,
        relationship: config.relationship,
        foreignTableId: config.foreignTableId,
        lookupFieldId: config.lookupFieldId,
        isOneWay: true,
        symmetricFieldId: undefined,
        filterByViewId: config.filterByViewId ?? undefined,
        visibleFieldIds: config.visibleFieldIds ?? undefined,
        filter: config.filter ?? undefined,
      }).andThen((nextConfig) =>
        LinkField.createNew({
          id: params.newId,
          name: params.newName,
          config: nextConfig,
          baseId: params.baseId,
          hostTableId: params.tableId,
          meta: this.meta(),
        })
      )
    );
  }

  lookupField(foreignTable: ForeignTable): Result<Field, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() =>
      foreignTable.fieldById(this.lookupFieldId())
    );
  }

  symmetricField(foreignTable: ForeignTable): Result<Field | undefined, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() => {
      const symmetricFieldId = this.symmetricFieldId();
      if (!symmetricFieldId) return ok(undefined);
      return foreignTable.fieldById(symmetricFieldId);
    });
  }

  visibleFields(
    foreignTable: ForeignTable
  ): Result<ReadonlyArray<Field> | null | undefined, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() => {
      const fieldIds = this.visibleFieldIds();
      if (fieldIds === null || fieldIds === undefined) return ok(fieldIds);
      return fieldIds.reduce<Result<ReadonlyArray<Field>, DomainError>>(
        (acc, fieldId) =>
          acc.andThen((fields) =>
            foreignTable.fieldById(fieldId).map((field) => [...fields, field])
          ),
        ok([])
      );
    });
  }

  buildSymmetricField(params: {
    foreignTable: ForeignTable;
    hostTable: Table;
    symmetricFieldId?: FieldId;
  }): Result<LinkField, DomainError> {
    const { foreignTable, hostTable } = params;
    if (this.isOneWay())
      return err(domainError.unexpected({ message: 'One-way link has no symmetric field' }));

    const symmetricFieldIdResult = params.symmetricFieldId
      ? ok(params.symmetricFieldId)
      : this.symmetricFieldId()
        ? ok(this.symmetricFieldId()!)
        : FieldId.generate();

    const baseId = this.baseId()
      ? this.baseId()!.equals(hostTable.baseId())
        ? undefined
        : hostTable.baseId().toString()
      : undefined;
    const lookupFieldId = hostTable.primaryFieldId().toString();

    const symmetricDbConfigResult: Result<LinkFieldDbConfig | undefined, DomainError> =
      this.config().hasDbConfig()
        ? this.fkHostTableNameString().andThen((fkHostTableName) =>
            this.selfKeyNameString().andThen((selfKeyName) =>
              this.foreignKeyNameString().andThen((foreignKeyName) =>
                LinkFieldConfig.swapDbConfig({
                  fkHostTableName,
                  selfKeyName,
                  foreignKeyName,
                })
              )
            )
          )
        : ok<LinkFieldDbConfig | undefined, DomainError>(undefined);

    return this.lookupField(foreignTable).andThen(() =>
      symmetricFieldIdResult.andThen((symmetricFieldId) =>
        symmetricDbConfigResult.andThen((symmetricDbConfig) =>
          this.setSymmetricFieldId(symmetricFieldId).andThen(() =>
            this.resolveSymmetricFieldName(hostTable, foreignTable).andThen((symmetricName) => {
              return LinkFieldConfig.create({
                baseId,
                relationship: this.relationship().reverse().toString(),
                foreignTableId: hostTable.id().toString(),
                lookupFieldId,
                isOneWay: false,
                symmetricFieldId: this.id().toString(),
              }).andThen((config) =>
                (symmetricDbConfig ? config.withDbConfig(symmetricDbConfig) : ok(config)).andThen(
                  (finalConfig) =>
                    LinkField.create({
                      id: symmetricFieldId,
                      name: symmetricName,
                      config: finalConfig,
                      meta: this.meta(),
                    })
                )
              );
            })
          )
        )
      )
    );
  }

  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError> {
    const foreignTableResult = this.resolveForeignTable(context.foreignTables);
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    const lookupResult = this.lookupField(foreignTable);
    if (lookupResult.isErr()) return err(lookupResult.error);

    const visibleResult = this.visibleFields(foreignTable);
    if (visibleResult.isErr()) return err(visibleResult.error);

    return ok(undefined);
  }

  validateAutoCreateTarget(hostTable: Table, foreignTable: Table): Result<void, DomainError> {
    if (foreignTable.id().equals(hostTable.id())) {
      return err(
        domainError.validation({
          code: 'paste.link_auto_create_self_link_unsupported',
          message: 'Auto-creating linked rows from paste is not supported for self links.',
          details: {
            tableId: hostTable.id().toString(),
            fieldId: this.id().toString(),
            foreignTableId: foreignTable.id().toString(),
          },
        })
      );
    }

    if (!this.lookupFieldId().equals(foreignTable.primaryFieldId())) {
      return err(
        domainError.validation({
          code: 'paste.link_auto_create_requires_primary_lookup',
          message:
            'Auto-creating linked rows from paste requires the link title field to use the foreign primary field.',
          details: {
            tableId: hostTable.id().toString(),
            fieldId: this.id().toString(),
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: this.lookupFieldId().toString(),
            primaryFieldId: foreignTable.primaryFieldId().toString(),
          },
        })
      );
    }

    return foreignTable.validateCreateWithPrimaryOnly();
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLinkField(this);
  }

  onDependencyUpdated(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    _context: FieldUpdateContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const filter = this.configValue.filter();
    if (filter == null) return ok(undefined);

    const plan = buildFieldFilterSyncPlan(updatedField, updateSpecs);
    if (!hasFieldFilterSyncPlanChanges(plan)) return ok(undefined);
    if (!hasFieldReferenceInFilter(filter, updatedField.id())) return ok(undefined);

    const nextFilter = syncFilterByFieldChanges(filter, updatedField.id(), plan);
    if (isEquivalentFilter(filter, nextFilter)) return ok(undefined);

    return this.configDto().andThen((currentDto) =>
      LinkFieldConfig.create({
        ...currentDto,
        filter: nextFilter,
      }).map((nextConfig) =>
        composeAndSpecsOrUndefined([
          UpdateLinkConfigSpec.create(this.id(), this.configValue, nextConfig),
        ])
      )
    );
  }

  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<FieldDeletionReaction | undefined, DomainError> {
    const deletedFromHostTable = context.sourceTable.id().equals(context.table.id());
    const deletedFromForeignTable = context.sourceTable.id().equals(this.foreignTableId());
    const filter = this.configValue.filter();
    const visibleFieldIds = this.configValue.visibleFieldIds();
    const deletedLookupField =
      deletedFromForeignTable && deletedField.id().equals(this.lookupFieldId());

    const shouldCleanForeignFilter =
      deletedFromForeignTable &&
      filter != null &&
      hasFieldReferenceInFilter(filter, deletedField.id());
    const nextFilter = shouldCleanForeignFilter
      ? syncFilterByFieldChangesWithId(filter, deletedField.id().toString(), {
          removeReferencedFilterItems: true,
          renamedSelectOptionValues: new Map(),
          removedSelectOptionValues: new Set(),
        })
      : filter;
    const shouldCleanVisibleFieldIds =
      deletedFromForeignTable &&
      visibleFieldIds != null &&
      visibleFieldIds.some((fieldId) => fieldId.equals(deletedField.id()));
    const nextVisibleFieldIds = shouldCleanVisibleFieldIds
      ? visibleFieldIds?.filter((fieldId) => !fieldId.equals(deletedField.id())) ?? null
      : visibleFieldIds;
    const normalizedVisibleFieldIds =
      nextVisibleFieldIds != null && nextVisibleFieldIds.length === 0 ? null : nextVisibleFieldIds;

    if (deletedLookupField) {
      const fallbackLookupFieldId = context.sourceTable.primaryFieldId();
      if (fallbackLookupFieldId.equals(deletedField.id())) {
        if (this.hasError().isError()) {
          return ok(undefined);
        }
        return ok({
          spec: TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()),
          relatedFieldIds: [this.id()],
        });
      }

      return this.configDto().andThen((currentDto) =>
        LinkFieldConfig.create({
          ...currentDto,
          lookupFieldId: fallbackLookupFieldId.toString(),
          ...(shouldCleanForeignFilter ? { filter: nextFilter } : {}),
          ...(shouldCleanVisibleFieldIds ? { visibleFieldIds: normalizedVisibleFieldIds } : {}),
        })
          .map((nextConfig) =>
            composeAndSpecsOrUndefined([
              UpdateLinkConfigSpec.create(this.id(), this.configValue, nextConfig),
              ...(this.hasError().isError()
                ? [TableUpdateFieldHasErrorSpec.clearError(this.id(), this.hasError())]
                : []),
            ])
          )
          .map((spec) =>
            spec
              ? {
                  spec,
                  relatedFieldIds: [this.id()],
                }
              : undefined
          )
      );
    }

    if (deletedFromForeignTable) {
      const hasConfigCleanup =
        (shouldCleanForeignFilter && !isEquivalentFilter(filter, nextFilter)) ||
        shouldCleanVisibleFieldIds;
      if (!hasConfigCleanup) {
        return ok(undefined);
      }

      return this.configDto().andThen((currentDto) =>
        LinkFieldConfig.create({
          ...currentDto,
          ...(shouldCleanForeignFilter ? { filter: nextFilter } : {}),
          ...(shouldCleanVisibleFieldIds ? { visibleFieldIds: normalizedVisibleFieldIds } : {}),
        })
          .map((nextConfig) =>
            composeAndSpecsOrUndefined([
              UpdateLinkConfigSpec.create(this.id(), this.configValue, nextConfig),
            ])
          )
          .map((spec) =>
            spec
              ? {
                  spec,
                  relatedFieldIds: [this.id()],
                }
              : undefined
          )
      );
    }

    const shouldSetError =
      deletedFromHostTable &&
      filter != null &&
      hasFieldReferenceInFilter(filter, deletedField.id());

    if (!shouldSetError || this.hasError().isError()) {
      return ok(undefined);
    }

    return ok({
      spec: TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()),
      relatedFieldIds: [this.id()],
    });
  }

  onTableDeleted(
    deletedTable: Table,
    context: TableDeletionContext
  ): Result<TableDeletionReaction | undefined, DomainError> {
    if (!deletedTable.id().equals(this.foreignTableId())) {
      return ok(undefined);
    }

    const nextFieldResult = SingleLineTextField.create({
      id: this.id(),
      name: this.name(),
    });
    if (nextFieldResult.isErr()) {
      return err(nextFieldResult.error);
    }

    const nextField = nextFieldResult.value;
    const setDescriptionResult = nextField.setDescription(this.description());
    if (setDescriptionResult.isErr()) {
      return err(setDescriptionResult.error);
    }
    const setAiConfigResult = nextField.setAiConfig(this.aiConfig());
    if (setAiConfigResult.isErr()) {
      return err(setAiConfigResult.error);
    }
    const setNotNullResult = nextField.setNotNull(this.notNull());
    if (setNotNullResult.isErr()) {
      return err(setNotNullResult.error);
    }
    const setUniqueResult = nextField.setUnique(this.unique());
    if (setUniqueResult.isErr()) {
      return err(setUniqueResult.error);
    }
    nextField.setHasError(this.hasError());

    const updateSpec = TableUpdateFieldTypeSpec.create(this, nextField);
    return ok({
      spec: updateSpec,
      afterPersist: context.hooks.createFieldUpdateAfterPersistHook(this.id(), updateSpec),
    });
  }

  setDbConfig(params: LinkFieldDbConfig): Result<void, DomainError> {
    return this.configValue.withDbConfig(params).map((next) => {
      this.configValue = next;
      return undefined;
    });
  }

  setSymmetricFieldId(symmetricFieldId: FieldId): Result<void, DomainError> {
    return this.configValue.withSymmetricFieldId(symmetricFieldId).map((next) => {
      this.configValue = next;
      return undefined;
    });
  }

  ensureDbConfig(params: {
    baseId: BaseId;
    hostTableId: TableId;
    hostTableDbTableName?: DbTableName;
    foreignTableDbTableName?: DbTableName;
  }): Result<void, DomainError> {
    const symmetricFieldIdResult = (() => {
      if (this.isOneWay()) return ok(this.symmetricFieldId());
      if (this.symmetricFieldId()) return ok(this.symmetricFieldId());
      return FieldId.generate().andThen((symmetricFieldId) =>
        this.setSymmetricFieldId(symmetricFieldId).map(() => symmetricFieldId)
      );
    })();

    if (symmetricFieldIdResult.isErr()) return err(symmetricFieldIdResult.error);

    if (this.configValue.hasDbConfig()) return ok(undefined);

    const symmetricFieldId = symmetricFieldIdResult.value;

    return this.resolveFkHostTableName({
      baseId: params.baseId,
      hostTableId: params.hostTableId,
      hostTableDbTableName: params.hostTableDbTableName,
      foreignTableDbTableName: params.foreignTableDbTableName,
      symmetricFieldId,
    }).andThen((fkHostTableName) =>
      LinkFieldConfig.buildDbConfig({
        fkHostTableName,
        relationship: this.relationship(),
        fieldId: this.id(),
        symmetricFieldId,
        isOneWay: this.isOneWay(),
      }).andThen((dbConfig) => this.setDbConfig(dbConfig))
    );
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, DomainError> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({ message: 'ForeignTable does not match LinkField foreign table' })
      );
    }
    return ok(undefined);
  }

  private resolveFkHostTableName = (params: {
    baseId: BaseId;
    hostTableId: TableId;
    hostTableDbTableName?: DbTableName;
    foreignTableDbTableName?: DbTableName;
    symmetricFieldId?: FieldId;
  }): Result<DbTableName, DomainError> => {
    const relationship = this.relationship().toString();
    if (relationship === 'manyMany') {
      return this.buildJunctionTableName(params.baseId, params.symmetricFieldId);
    }
    if (relationship === 'manyOne' || relationship === 'oneOne') {
      if (params.hostTableDbTableName) {
        return ok(params.hostTableDbTableName);
      }
      return DbTableName.rehydrate(`${params.baseId.toString()}.${params.hostTableId.toString()}`);
    }
    if (relationship === 'oneMany') {
      if (this.isOneWay()) {
        return this.buildJunctionTableName(params.baseId, params.symmetricFieldId);
      }
      if (params.foreignTableDbTableName) {
        return ok(params.foreignTableDbTableName);
      }
      return DbTableName.rehydrate(
        `${params.baseId.toString()}.${this.foreignTableId().toString()}`
      );
    }
    return err(domainError.validation({ message: 'Unsupported LinkRelationship' }));
  };

  private buildJunctionTableName(
    baseId: BaseId,
    symmetricFieldId?: FieldId
  ): Result<DbTableName, DomainError> {
    const suffix = symmetricFieldId
      ? `${this.id().toString()}_${symmetricFieldId.toString()}`
      : this.id().toString();
    return DbTableName.rehydrate(`${baseId.toString()}.junction_${suffix}`);
  }

  private static normalizeCrossBaseConfig(
    config: LinkFieldConfig,
    hostBaseId: BaseId
  ): Result<LinkFieldConfig, DomainError> {
    const configBaseId = config.baseId();
    if (!configBaseId || !configBaseId.equals(hostBaseId)) {
      return ok(config);
    }

    const baseOptions = {
      relationship: config.relationship().toString(),
      foreignTableId: config.foreignTableId().toString(),
      lookupFieldId: config.lookupFieldId().toString(),
      isOneWay: config.isOneWay(),
      symmetricFieldId: config.symmetricFieldId()?.toString(),
      filterByViewId: config.filterByViewId() === null ? null : config.filterByViewId()?.toString(),
      visibleFieldIds:
        config.visibleFieldIds() === null
          ? null
          : config.visibleFieldIds()?.map((fieldId) => fieldId.toString()),
      filter: config.filter() ?? undefined,
    };

    if (!config.hasDbConfig()) {
      return LinkFieldConfig.create(baseOptions);
    }

    return config.fkHostTableNameString().andThen((fkHostTableName) =>
      config.selfKeyNameString().andThen((selfKeyName) =>
        config.foreignKeyNameString().andThen((foreignKeyName) =>
          LinkFieldConfig.create({
            ...baseOptions,
            fkHostTableName,
            selfKeyName,
            foreignKeyName,
          })
        )
      )
    );
  }

  private static defaultMetaForConfig(
    config: LinkFieldConfig
  ): Result<LinkFieldMeta | undefined, DomainError> {
    const relationship = config.relationship().toString();
    const shouldHaveOrderColumn = relationship === 'oneMany' ? !config.isOneWay() : true;

    if (!shouldHaveOrderColumn) return ok(undefined);
    return LinkFieldMeta.create({ hasOrderColumn: true });
  }

  private resolveSymmetricFieldName(
    hostTable: Table,
    foreignTable: ForeignTable
  ): Result<FieldName, DomainError> {
    const baseNameResult = FieldName.create(hostTable.name().toString());
    if (baseNameResult.isErr()) return err(baseNameResult.error);
    return foreignTable.generateFieldName(baseNameResult.value);
  }

  private resolveForeignTable(
    foreignTables: ReadonlyArray<Table>
  ): Result<ForeignTable, DomainError> {
    const table = foreignTables.find((candidate) => candidate.id().equals(this.foreignTableId()));
    if (!table) return err(domainError.invariant({ message: 'Foreign table not loaded' }));
    return ok(ForeignTable.from(table));
  }
}
