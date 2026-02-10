import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../../base/BaseId';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { DbTableName } from '../../DbTableName';
import { ForeignTable } from '../../ForeignTable';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { ViewId } from '../../views/ViewId';
import type { DbFieldName } from '../DbFieldName';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type {
  ForeignTableRelatedField,
  ForeignTableValidationContext,
} from '../ForeignTableRelatedField';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import {
  LinkFieldConfig,
  type LinkFieldConfigValue,
  type LinkFieldDbConfig,
} from './LinkFieldConfig';
import { LinkFieldMeta, type LinkFieldMetaValue } from './LinkFieldMeta';
import type { LinkRelationship } from './LinkRelationship';

export class LinkField extends Field implements ForeignTableRelatedField {
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
    meta?: LinkFieldMeta;
  }): Result<LinkField, DomainError> {
    const metaResult = params.meta
      ? ok(params.meta)
      : LinkField.defaultMetaForConfig(params.config);

    return metaResult.andThen((meta) =>
      LinkField.create({
        id: params.id,
        name: params.name,
        config: params.config,
        meta,
      }).andThen((field) =>
        field
          .ensureDbConfig({ baseId: params.baseId, hostTableId: params.hostTableId })
          .map(() => field)
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

    const baseId = this.isCrossBase() ? hostTable.baseId().toString() : undefined;
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
            this.resolveSymmetricFieldName(hostTable, foreignTable).andThen((symmetricName) =>
              LinkFieldConfig.create({
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
              )
            )
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

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLinkField(this);
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

  ensureDbConfig(params: { baseId: BaseId; hostTableId: TableId }): Result<void, DomainError> {
    if (this.configValue.hasDbConfig()) return ok(undefined);

    const symmetricFieldIdResult = (() => {
      if (this.isOneWay()) return ok(this.symmetricFieldId());
      if (this.symmetricFieldId()) return ok(this.symmetricFieldId());
      return FieldId.generate().andThen((symmetricFieldId) =>
        this.setSymmetricFieldId(symmetricFieldId).map(() => symmetricFieldId)
      );
    })();

    if (symmetricFieldIdResult.isErr()) return err(symmetricFieldIdResult.error);
    const symmetricFieldId = symmetricFieldIdResult.value;

    return this.resolveFkHostTableName({
      baseId: params.baseId,
      hostTableId: params.hostTableId,
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
    symmetricFieldId?: FieldId;
  }): Result<DbTableName, DomainError> => {
    const relationship = this.relationship().toString();
    if (relationship === 'manyMany') {
      return this.buildJunctionTableName(params.baseId, params.symmetricFieldId);
    }
    if (relationship === 'manyOne' || relationship === 'oneOne') {
      return DbTableName.rehydrate(`${params.baseId.toString()}.${params.hostTableId.toString()}`);
    }
    if (relationship === 'oneMany') {
      if (this.isOneWay()) {
        return this.buildJunctionTableName(params.baseId, params.symmetricFieldId);
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
