import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../../fields/DbFieldName';
import type { FieldId } from '../../fields/FieldId';
import { LinkField } from '../../fields/types/LinkField';
import type { LinkFieldConfig } from '../../fields/types/LinkFieldConfig';
import type { LinkRelationship } from '../../fields/types/LinkRelationship';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a link field's relationship type.
 * This handles changes that require schema modifications:
 * - oneWay ↔ twoWay (creates/deletes symmetric field)
 * - manyMany ↔ oneMany (changes storage between junction table and FK column)
 *
 * Note: This spec is used in addition to UpdateLinkConfigSpec when
 * the relationship type or isOneWay changes.
 */
export class UpdateLinkRelationshipSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private computedNextConfigValue?: LinkFieldConfig;

  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly dbFieldNameValue: DbFieldName,
    private readonly previousConfigValue: LinkFieldConfig,
    private readonly nextConfigValue: LinkFieldConfig
  ) {
    super();
  }

  static create(params: {
    fieldId: FieldId;
    dbFieldName: DbFieldName;
    previousConfig: LinkFieldConfig;
    nextConfig: LinkFieldConfig;
  }): UpdateLinkRelationshipSpec {
    return new UpdateLinkRelationshipSpec(
      params.fieldId,
      params.dbFieldName,
      params.previousConfig,
      params.nextConfig
    );
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  dbFieldName(): DbFieldName {
    return this.dbFieldNameValue;
  }

  previousConfig(): LinkFieldConfig {
    return this.previousConfigValue;
  }

  nextConfig(): LinkFieldConfig {
    return this.nextConfigValue;
  }

  computedNextConfig(): LinkFieldConfig | undefined {
    return this.computedNextConfigValue;
  }

  previousRelationship(): LinkRelationship {
    return this.previousConfigValue.relationship();
  }

  nextRelationship(): LinkRelationship {
    return this.nextConfigValue.relationship();
  }

  previousIsOneWay(): boolean {
    return this.previousConfigValue.isOneWay();
  }

  nextIsOneWay(): boolean {
    return this.nextConfigValue.isOneWay();
  }

  /**
   * Whether the relationship type is changing (e.g., manyMany → oneMany)
   */
  isRelationshipTypeChanging(): boolean {
    return !this.previousConfigValue.relationship().equals(this.nextConfigValue.relationship());
  }

  /**
   * Whether the one-way flag is changing (e.g., oneWay → twoWay)
   */
  isOneWayChanging(): boolean {
    return this.previousConfigValue.isOneWay() !== this.nextConfigValue.isOneWay();
  }

  /**
   * Whether this change requires creating a symmetric field in the foreign table
   */
  requiresSymmetricFieldCreation(): boolean {
    return this.previousConfigValue.isOneWay() && !this.nextConfigValue.isOneWay();
  }

  /**
   * Whether this change requires deleting the symmetric field from the foreign table
   */
  requiresSymmetricFieldDeletion(): boolean {
    return !this.previousConfigValue.isOneWay() && this.nextConfigValue.isOneWay();
  }

  /**
   * Determine if a config uses junction table storage.
   * manyMany always uses junction table.
   * oneMany uses junction table only when oneWay.
   */
  private usesJunctionTable(config: LinkFieldConfig): boolean {
    const rel = config.relationship().toString();
    if (rel === 'manyMany') return true;
    if (rel === 'oneMany' && config.isOneWay()) return true;
    return false;
  }

  /**
   * Whether this change converts from junction table storage to FK column storage
   */
  isJunctionToFkConversion(): boolean {
    return (
      this.usesJunctionTable(this.previousConfigValue) &&
      !this.usesJunctionTable(this.nextConfigValue)
    );
  }

  /**
   * Whether this change converts from FK column storage to junction table storage
   */
  isFkToJunctionConversion(): boolean {
    return (
      !this.usesJunctionTable(this.previousConfigValue) &&
      this.usesJunctionTable(this.nextConfigValue)
    );
  }

  mutate(t: Table): Result<Table, DomainError> {
    // Read the already-updated field from the table (runs after UpdateLinkConfigSpec.mutate())
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isOk() && fieldResult.value instanceof LinkField) {
      this.computedNextConfigValue = fieldResult.value.config();
    }
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateLinkRelationship(this).map(() => undefined);
  }
}
