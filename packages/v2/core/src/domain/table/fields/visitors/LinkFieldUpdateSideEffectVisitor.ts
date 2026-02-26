import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { ForeignTable } from '../../ForeignTable';
import { RemoveSymmetricLinkFieldSpec } from '../../specs/field-updates/RemoveSymmetricLinkFieldSpec';
import { UpdateLinkConfigSpec } from '../../specs/field-updates/UpdateLinkConfigSpec';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableAddFieldSpec } from '../../specs/TableAddFieldSpec';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';

/**
 * Represents a side effect for updating a link field that affects a foreign table.
 */
export type LinkFieldUpdateSideEffect = {
  /** The foreign table that needs to be updated */
  foreignTable: Table;
  /** The spec to apply to the foreign table */
  mutateSpec: ISpecification<Table, ITableSpecVisitor>;
  /** Type of side effect for logging/debugging */
  type: 'createSymmetricField' | 'deleteSymmetricField' | 'updateSymmetricFieldConfig';
};

export type LinkFieldUpdateSideEffects = ReadonlyArray<LinkFieldUpdateSideEffect>;

export type LinkFieldUpdateSideEffectContext = {
  /** The table containing the link field being updated */
  table: Table;
  /** Foreign tables that may be affected */
  foreignTables: ReadonlyArray<Table>;
};

export type LinkFieldUpdateInput = {
  /** The current link field before update */
  currentField: LinkField;
  /** The previous config before update */
  previousConfig: LinkFieldConfig;
  /** The new config after update */
  nextConfig: LinkFieldConfig;
};

/**
 * Visitor that collects side effects for link field updates.
 *
 * This handles:
 * - oneWay → twoWay: Creates symmetric field in foreign table
 * - twoWay → oneWay: Deletes symmetric field from foreign table
 */
export class LinkFieldUpdateSideEffectVisitor {
  private constructor(
    private readonly table: Table,
    private readonly foreignTablesById: ReadonlyMap<string, Table>
  ) {}

  static create(context: LinkFieldUpdateSideEffectContext): LinkFieldUpdateSideEffectVisitor {
    const foreignTablesById = new Map<string, Table>();
    for (const table of context.foreignTables) {
      foreignTablesById.set(table.id().toString(), table);
    }
    return new LinkFieldUpdateSideEffectVisitor(context.table, foreignTablesById);
  }

  /**
   * Collect side effects for a link field update.
   */
  collect(input: LinkFieldUpdateInput): Result<LinkFieldUpdateSideEffects, DomainError> {
    const { currentField, previousConfig, nextConfig } = input;

    const previousIsOneWay = previousConfig.isOneWay();
    const nextIsOneWay = nextConfig.isOneWay();
    const foreignTableChanged = !previousConfig
      .foreignTableId()
      .equals(nextConfig.foreignTableId());

    const effects: LinkFieldUpdateSideEffect[] = [];

    // Handle oneWay ↔ twoWay changes
    if (previousIsOneWay !== nextIsOneWay) {
      if (previousIsOneWay && !nextIsOneWay) {
        // oneWay → twoWay: Create symmetric field
        const result = this.buildCreateSymmetricFieldSideEffect(currentField, nextConfig);
        if (result.isErr()) return err(result.error);
        effects.push(...result.value);
      } else {
        // twoWay → oneWay: Delete symmetric field
        const result = this.buildDeleteSymmetricFieldSideEffect(previousConfig);
        if (result.isErr()) return err(result.error);
        effects.push(...result.value);
      }
    }

    if (!previousIsOneWay && !nextIsOneWay && foreignTableChanged) {
      const deleteResult = this.buildDeleteSymmetricFieldSideEffect(previousConfig);
      if (deleteResult.isErr()) return err(deleteResult.error);
      effects.push(...deleteResult.value);

      const createResult = this.buildCreateSymmetricFieldSideEffect(currentField, nextConfig);
      if (createResult.isErr()) return err(createResult.error);
      effects.push(...createResult.value);
    }

    // Handle twoWay relationship type changes (e.g., manyMany twoWay → oneMany twoWay)
    // The symmetric field's config must be updated with reversed relationship + new dbConfig
    if (
      !previousIsOneWay &&
      !nextIsOneWay &&
      !foreignTableChanged &&
      !previousConfig.relationship().equals(nextConfig.relationship())
    ) {
      const result = this.buildUpdateSymmetricFieldConfigSideEffect(previousConfig, nextConfig);
      if (result.isErr()) return err(result.error);
      effects.push(...result.value);
    }

    return ok(effects);
  }

  /**
   * Checks if the update requires symmetric field changes.
   */
  static requiresSymmetricFieldChange(
    previousConfig: LinkFieldConfig,
    nextConfig: LinkFieldConfig
  ): boolean {
    const foreignTableChanged = !previousConfig
      .foreignTableId()
      .equals(nextConfig.foreignTableId());

    if (!previousConfig.isOneWay() && !nextConfig.isOneWay() && foreignTableChanged) {
      return true;
    }

    // oneWay flag changing always requires symmetric field change
    if (previousConfig.isOneWay() !== nextConfig.isOneWay()) return true;
    // twoWay relationship type change also requires symmetric field config update
    if (
      !previousConfig.isOneWay() &&
      !nextConfig.isOneWay() &&
      !previousConfig.relationship().equals(nextConfig.relationship())
    ) {
      return true;
    }
    return false;
  }

  /**
   * Build side effect for creating a symmetric field (oneWay → twoWay).
   */
  private buildCreateSymmetricFieldSideEffect(
    currentField: LinkField,
    nextConfig: LinkFieldConfig
  ): Result<LinkFieldUpdateSideEffects, DomainError> {
    const foreignTableResult = this.foreignTable(nextConfig.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    // Get the symmetricFieldId from the next config
    const symmetricFieldId = nextConfig.symmetricFieldId();
    if (!symmetricFieldId) {
      return err(
        domainError.validation({
          message: 'symmetricFieldId is required when converting to twoWay',
        })
      );
    }

    // Check if symmetric field already exists
    const existingResult = ForeignTable.from(foreignTable).fieldById(symmetricFieldId);
    if (existingResult.isOk()) {
      const existingField = existingResult.value;
      if (!(existingField instanceof LinkField)) {
        return ok([]);
      }

      return currentField
        .buildSymmetricField({
          foreignTable: ForeignTable.from(foreignTable),
          hostTable: this.table,
          symmetricFieldId,
        })
        .map((symmetricField) => {
          if (existingField.config().equals(symmetricField.config())) {
            return [];
          }
          return [
            {
              foreignTable,
              mutateSpec: UpdateLinkConfigSpec.create(
                symmetricFieldId,
                existingField.config(),
                symmetricField.config()
              ),
              type: 'updateSymmetricFieldConfig' as const,
            },
          ];
        });
    }

    // Build the symmetric field
    // We need to create a LinkField that points back to the current table
    return currentField
      .buildSymmetricField({
        foreignTable: ForeignTable.from(foreignTable),
        hostTable: this.table,
        symmetricFieldId,
      })
      .map((symmetricField) => [
        {
          foreignTable,
          mutateSpec: TableAddFieldSpec.create(symmetricField),
          type: 'createSymmetricField' as const,
        },
      ]);
  }

  /**
   * Build side effect for deleting a symmetric field (twoWay → oneWay).
   */
  private buildDeleteSymmetricFieldSideEffect(
    previousConfig: LinkFieldConfig
  ): Result<LinkFieldUpdateSideEffects, DomainError> {
    const symmetricFieldId = previousConfig.symmetricFieldId();
    if (!symmetricFieldId) {
      // No symmetric field to delete
      return ok([]);
    }

    const foreignTableResult = this.foreignTable(previousConfig.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    // Check if the symmetric field exists
    const existingResult = ForeignTable.from(foreignTable).fieldById(symmetricFieldId);
    if (existingResult.isErr()) {
      // Symmetric field doesn't exist, no need to delete
      return ok([]);
    }

    const symmetricField = existingResult.value;

    return ok([
      {
        foreignTable,
        mutateSpec: RemoveSymmetricLinkFieldSpec.create(symmetricField),
        type: 'deleteSymmetricField' as const,
      },
    ]);
  }

  /**
   * Build side effect for updating symmetric field config (twoWay relationship type change).
   * When the relationship changes (e.g., manyMany → oneMany), the symmetric field
   * must also update its relationship (reversed) and dbConfig.
   */
  private buildUpdateSymmetricFieldConfigSideEffect(
    previousConfig: LinkFieldConfig,
    nextConfig: LinkFieldConfig
  ): Result<LinkFieldUpdateSideEffects, DomainError> {
    const symmetricFieldId = previousConfig.symmetricFieldId();
    if (!symmetricFieldId) {
      return ok([]);
    }

    const foreignTableResult = this.foreignTable(previousConfig.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    // Find the symmetric field in the foreign table
    const existingResult = ForeignTable.from(foreignTable).fieldById(symmetricFieldId);
    if (existingResult.isErr()) {
      return ok([]);
    }

    const symmetricField = existingResult.value;
    if (!(symmetricField instanceof LinkField)) {
      return ok([]);
    }

    const symmetricConfig = symmetricField.config();

    // Build a new config for the symmetric field with reversed relationship
    // and swapped dbConfig from the source field's updated config
    return safeTry<LinkFieldUpdateSideEffects, DomainError>(function* () {
      const symConfigDto = yield* symmetricConfig.toDto();

      // Compute swapped dbConfig from the source field's new config (which has dbConfig populated)
      let swappedDbConfig: {
        fkHostTableName?: string;
        selfKeyName?: string;
        foreignKeyName?: string;
      } = {};
      if (nextConfig.hasDbConfig()) {
        const fkHostTableName = yield* nextConfig.fkHostTableNameString();
        const selfKeyName = yield* nextConfig.selfKeyNameString();
        const foreignKeyName = yield* nextConfig.foreignKeyNameString();
        // Swap: source's selfKey becomes sym's foreignKey, and vice versa
        swappedDbConfig = {
          fkHostTableName,
          selfKeyName: foreignKeyName,
          foreignKeyName: selfKeyName,
        };
      }

      // Create new symmetric config with reversed relationship and swapped dbConfig
      const newSymConfig = yield* LinkFieldConfig.create({
        ...symConfigDto,
        relationship: nextConfig.relationship().reverse().toString(),
        ...swappedDbConfig,
      });

      return ok([
        {
          foreignTable,
          mutateSpec: UpdateLinkConfigSpec.create(symmetricFieldId, symmetricConfig, newSymConfig),
          type: 'updateSymmetricFieldConfig' as const,
        },
      ]);
    });
  }

  private foreignTable(tableId: TableId): Result<Table, DomainError> {
    const table = this.foreignTablesById.get(tableId.toString());
    if (!table) return err(domainError.invariant({ message: 'Foreign table not loaded' }));
    return ok(table);
  }
}
