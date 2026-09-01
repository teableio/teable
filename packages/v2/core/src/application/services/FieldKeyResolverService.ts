import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldType } from '../../domain/table/fields/FieldType';
import type { Table } from '../../domain/table/Table';

export interface FieldKeyResolutionContext {
  readonly fieldKeyType: FieldKeyType;
  readonly fieldMap: ReadonlyMap<string, string> | undefined;
  readonly availableFieldKeys: ReadonlyArray<string>;
  readonly checkboxKeys: ReadonlySet<string> | undefined;
}

/**
 * Service to resolve field keys (name/dbFieldName) to field IDs
 *
 * Architecture:
 * - Accepts fieldKeyType at the boundary layer (HTTP/Command)
 * - Resolves field keys to IDs as early as possible
 * - After resolution, only field IDs are used in domain/repository layers
 */
export class FieldKeyResolverService {
  private static buildFieldNotFoundError(
    fieldKeyType: FieldKeyType,
    fieldKey: string,
    availableFieldKeys: ReadonlyArray<string>
  ): DomainError {
    return domainError.notFound({
      code: 'field.key_not_found',
      message: `Field "${fieldKey}" does not exist in this table`,
      details: { fieldKeyType, fieldKey, availableFieldKeys },
    });
  }

  /**
   * Resolve field keys in a record's fields object to field IDs
   *
   * @param table - The table containing the fields
   * @param fields - Record fields with keys in the specified fieldKeyType format
   * @param fieldKeyType - The type of keys used in the fields object
   * @returns Fields object with all keys resolved to field IDs
   */
  static resolveFieldKeys(
    table: Table,
    fields: Record<string, unknown>,
    fieldKeyType: FieldKeyType
  ): Result<Record<string, unknown>, DomainError> {
    return this.resolveFieldKeysWithContext(
      this.createResolutionContext(table, fieldKeyType),
      fields
    );
  }

  /**
   * Precompute the table-invariant lookup maps so bulk callers resolve many
   * records without rebuilding them per record.
   */
  static createResolutionContext(
    table: Table,
    fieldKeyType: FieldKeyType
  ): FieldKeyResolutionContext {
    if (fieldKeyType === FieldKeyType.Id) {
      return { fieldKeyType, fieldMap: undefined, availableFieldKeys: [], checkboxKeys: undefined };
    }

    const checkboxKeys = new Set<string>();
    for (const field of table.getFields()) {
      if (field.type().equals(FieldType.checkbox())) {
        checkboxKeys.add(this.getFieldKey(field, fieldKeyType));
      }
    }
    const fieldMap = this.buildFieldMap(table, fieldKeyType);
    return {
      fieldKeyType,
      fieldMap,
      availableFieldKeys: Array.from(fieldMap.keys()),
      checkboxKeys: checkboxKeys.size > 0 ? checkboxKeys : undefined,
    };
  }

  static resolveFieldKeysWithContext(
    context: FieldKeyResolutionContext,
    fields: Record<string, unknown>
  ): Result<Record<string, unknown>, DomainError> {
    // If already using field IDs, no resolution needed
    if (context.fieldKeyType === FieldKeyType.Id || !context.fieldMap) {
      return ok(fields);
    }

    const resolvedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      const fieldId = context.fieldMap.get(key);

      if (!fieldId) {
        return err(
          this.buildFieldNotFoundError(context.fieldKeyType, key, context.availableFieldKeys)
        );
      }

      // Checkbox unchecked values are represented as `null` when field keys are non-id.
      resolvedFields[fieldId] = context.checkboxKeys?.has(key) && value === false ? null : value;
    }

    return ok(resolvedFields);
  }

  /**
   * Checkbox unchecked values are represented as `null`
   * when field keys are non-id.
   */
  static normalizeCheckboxFalseToNull(
    table: Table,
    fields: Record<string, unknown>,
    fieldKeyType: FieldKeyType
  ): Record<string, unknown> {
    if (fieldKeyType === FieldKeyType.Id) {
      return fields;
    }

    const checkboxKeys = new Set<string>();
    for (const field of table.getFields()) {
      if (field.type().equals(FieldType.checkbox())) {
        checkboxKeys.add(this.getFieldKey(field, fieldKeyType));
      }
    }

    if (checkboxKeys.size === 0) {
      return fields;
    }

    let changed = false;
    const normalized = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (checkboxKeys.has(key) && value === false) {
          changed = true;
          return [key, null];
        }
        return [key, value];
      })
    );

    return changed ? normalized : fields;
  }

  /**
   * Resolve a single field key to field ID
   *
   * @param table - The table containing the fields
   * @param fieldKey - The field key (id/name/dbFieldName)
   * @param fieldKeyType - The type of key being resolved
   * @returns The field ID
   */
  static resolveFieldKey(
    table: Table,
    fieldKey: string,
    fieldKeyType: FieldKeyType
  ): Result<string, DomainError> {
    // If already a field ID, return as-is
    if (fieldKeyType === FieldKeyType.Id) {
      return ok(fieldKey);
    }

    const fieldMap = this.buildFieldMap(table, fieldKeyType);
    const availableFieldKeys = Array.from(fieldMap.keys());
    const fieldId = fieldMap.get(fieldKey);

    if (!fieldId) {
      return err(this.buildFieldNotFoundError(fieldKeyType, fieldKey, availableFieldKeys));
    }

    return ok(fieldId);
  }

  /**
   * Get the field key for a single field based on fieldKeyType
   *
   * @param field - The field
   * @param fieldKeyType - The type of key to return
   * @returns The field key (id, name, or dbFieldName)
   */
  static getFieldKey(
    field: { id(): { toString(): string }; name(): { toString(): string }; dbFieldName(): any },
    fieldKeyType: FieldKeyType
  ): string {
    const fieldId = field.id().toString();

    switch (fieldKeyType) {
      case FieldKeyType.Name:
        return field.name().toString();
      case FieldKeyType.DbFieldName: {
        const dbFieldNameResult = field.dbFieldName();
        if (dbFieldNameResult.isErr && dbFieldNameResult.isErr()) {
          return field.name().toString();
        }
        const valueResult = dbFieldNameResult.value?.value?.();
        if (valueResult?.isErr && valueResult.isErr()) {
          return field.name().toString();
        }
        return valueResult?.value ?? field.name().toString();
      }
      case FieldKeyType.Id:
      default:
        return fieldId;
    }
  }

  /**
   * Build a map from field keys to field IDs
   *
   * @param table - The table containing the fields
   * @param fieldKeyType - The type of keys to map
   * @returns Map from field key to field ID
   */
  private static buildFieldMap(table: Table, fieldKeyType: FieldKeyType): Map<string, string> {
    const map = new Map<string, string>();

    for (const field of table.getFields()) {
      const fieldId = field.id().toString();
      const key = this.getFieldKey(field, fieldKeyType);
      map.set(key, fieldId);
    }

    return map;
  }

  /**
   * Transform response field keys from IDs back to the requested fieldKeyType
   * Used to format the response according to client's fieldKeyType preference
   *
   * @param table - The table containing the fields
   * @param fields - Record fields with field ID keys
   * @param fieldKeyType - The desired key type for the response
   * @returns Fields object with keys in the requested format
   */
  static transformResponseKeys(
    table: Table,
    fields: Record<string, unknown>,
    fieldKeyType: FieldKeyType
  ): Record<string, unknown> {
    // If requesting field IDs, no transformation needed
    if (fieldKeyType === FieldKeyType.Id) {
      return fields;
    }

    const transformed: Record<string, unknown> = {};
    const reverseMap = this.buildReverseFieldMap(table, fieldKeyType);

    for (const [fieldId, value] of Object.entries(fields)) {
      const key = reverseMap.get(fieldId) ?? fieldId;
      transformed[key] = value;
    }

    return transformed;
  }

  /**
   * Build a map from field IDs to field keys
   *
   * @param table - The table containing the fields
   * @param fieldKeyType - The type of keys to map to
   * @returns Map from field ID to field key
   */
  private static buildReverseFieldMap(
    table: Table,
    fieldKeyType: FieldKeyType
  ): Map<string, string> {
    const map = new Map<string, string>();

    for (const field of table.getFields()) {
      const fieldId = field.id().toString();
      const key = this.getFieldKey(field, fieldKeyType);
      map.set(fieldId, key);
    }

    return map;
  }
}
