import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { LinkField } from '../../fields/types/LinkField';
import type { LinkFieldConfig } from '../../fields/types/LinkFieldConfig';
import { LinkFieldMeta } from '../../fields/types/LinkFieldMeta';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a link field's configuration.
 * This handles changes to relationship type, filterByViewId, visibleFieldIds, etc.
 */
export class UpdateLinkConfigSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousConfigValue: LinkFieldConfig,
    private readonly nextConfigValue: LinkFieldConfig
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousConfig: LinkFieldConfig,
    nextConfig: LinkFieldConfig
  ): UpdateLinkConfigSpec {
    return new UpdateLinkConfigSpec(fieldId, previousConfig, nextConfig);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousConfig(): LinkFieldConfig {
    return this.previousConfigValue;
  }

  nextConfig(): LinkFieldConfig {
    return this.nextConfigValue;
  }

  /**
   * Check if this update is converting from oneWay to twoWay.
   */
  isOneWayToTwoWay(): boolean {
    return this.previousConfigValue.isOneWay() && !this.nextConfigValue.isOneWay();
  }

  /**
   * Check if this update is converting from twoWay to oneWay.
   */
  isTwoWayToOneWay(): boolean {
    return !this.previousConfigValue.isOneWay() && this.nextConfigValue.isOneWay();
  }

  /**
   * Check if the oneWay property is changing.
   */
  isOneWayChanging(): boolean {
    return this.previousConfigValue.isOneWay() !== this.nextConfigValue.isOneWay();
  }

  /**
   * Check if the relationship type is changing.
   */
  isRelationshipChanging(): boolean {
    return !this.previousConfigValue.relationship().equals(this.nextConfigValue.relationship());
  }

  /**
   * Check if the foreign table is changing.
   */
  isForeignTableChanging(): boolean {
    return !this.previousConfigValue.foreignTableId().equals(this.nextConfigValue.foreignTableId());
  }

  /**
   * Compute the correct meta for a given link config.
   * Mirrors LinkField.defaultMetaForConfig logic.
   */
  private computeMetaForConfig(
    config: LinkFieldConfig
  ): Result<LinkFieldMeta | undefined, DomainError> {
    const relationship = config.relationship().toString();
    const shouldHaveOrderColumn = relationship === 'oneMany' ? !config.isOneWay() : true;
    if (!shouldHaveOrderColumn) return ok(undefined);
    return LinkFieldMeta.create({ hasOrderColumn: true });
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof LinkField)) {
      return err(domainError.validation({ message: 'Field is not a link field' }));
    }

    const isRelChanging = this.isRelationshipChanging();
    const isOneWayChange = this.isOneWayChanging();
    // Determine if the physical storage type changes.
    // junction storage: manyMany or (oneMany && oneWay)
    // FK storage: manyOne, oneOne, or oneMany twoWay
    const usesJunction = (config: LinkFieldConfig): boolean => {
      const rel = config.relationship().toString();
      return rel === 'manyMany' || (rel === 'oneMany' && config.isOneWay());
    };
    const isStorageTypeChanging =
      usesJunction(this.previousConfigValue) !== usesJunction(this.nextConfigValue);
    // Recompute meta when the physical storage changes or junction layout changes.
    // For oneWay→oneWay without relationship change, preserve meta (same junction).
    // For oneWay→oneWay WITH relationship change, always recompute (hasOrderColumn may differ).
    const needsMetaRecompute = isRelChanging || isOneWayChange;

    // Recompute meta when relationship or oneWay changes, otherwise preserve existing
    const metaResult = needsMetaRecompute
      ? this.computeMetaForConfig(this.nextConfigValue)
      : ok(field.meta());
    if (metaResult.isErr()) return err(metaResult.error);
    const meta = metaResult.value;

    // Need new dbConfig when the storage mechanism changes:
    // - twoWay relationship type change (FK host moves or junction↔FK)
    // - Any change that switches between junction and FK storage
    // - OneWay↔TwoWay changes the junction table naming (oneWay uses a generated
    //   symmetricFieldId suffix, twoWay uses the actual symmetric field's ID)
    const needsNewDbConfig =
      (isRelChanging && !this.previousConfigValue.isOneWay() && !this.nextConfigValue.isOneWay()) ||
      isStorageTypeChanging ||
      (isOneWayChange && this.previousConfigValue.relationship().toString() !== 'manyMany');

    if (needsNewDbConfig) {
      // Preserve symmetricFieldId from the previous config if not already set
      let nextConfig = this.nextConfigValue;
      if (!nextConfig.symmetricFieldId() && this.previousConfigValue.symmetricFieldId()) {
        const withSymResult = nextConfig.withSymmetricFieldId(
          this.previousConfigValue.symmetricFieldId()!
        );
        if (withSymResult.isErr()) return err(withSymResult.error);
        nextConfig = withSymResult.value;
      }

      const configResult = nextConfig.hasDbConfig()
        ? ok(nextConfig)
        : LinkField.create({
            id: field.id(),
            name: field.name(),
            config: nextConfig,
            meta,
          }).andThen((updatedField) =>
            updatedField
              .ensureDbConfig({
                baseId: t.baseId(),
                hostTableId: t.id(),
              })
              .map(() => updatedField.config())
          );
      if (configResult.isErr()) return err(configResult.error);

      const updatedFieldResult = LinkField.create({
        id: field.id(),
        name: field.name(),
        config: configResult.value,
        meta,
      });
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

      return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
    }

    const configWithSymmetricFieldIdResult =
      this.isTwoWayToOneWay() &&
      !this.nextConfigValue.symmetricFieldId() &&
      this.previousConfigValue.symmetricFieldId()
        ? this.nextConfigValue.withSymmetricFieldId(this.previousConfigValue.symmetricFieldId()!)
        : ok(this.nextConfigValue);
    if (configWithSymmetricFieldIdResult.isErr())
      return err(configWithSymmetricFieldIdResult.error);

    // Preserve dbConfig from the previous config if it exists
    const nextConfig = configWithSymmetricFieldIdResult.value;
    const configWithDbConfigResult = this.previousConfigValue.hasDbConfig()
      ? nextConfig.hasDbConfig()
        ? ok(nextConfig)
        : nextConfig.withDbConfig({
            fkHostTableName: this.previousConfigValue.fkHostTableName(),
            selfKeyName: this.previousConfigValue.selfKeyName(),
            foreignKeyName: this.previousConfigValue.foreignKeyName(),
          })
      : ok(nextConfig);

    if (configWithDbConfigResult.isErr()) return err(configWithDbConfigResult.error);
    const finalConfig = configWithDbConfigResult.value;

    const updatedFieldResult = LinkField.create({
      id: field.id(),
      name: field.name(),
      config: finalConfig,
      meta,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateLinkConfig(this).map(() => undefined);
  }
}
