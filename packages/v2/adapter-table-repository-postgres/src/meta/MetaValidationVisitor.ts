import type {
  AttachmentField,
  AutoNumberField,
  ButtonField,
  CheckboxField,
  ConditionalLookupField,
  ConditionalRollupField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  DomainError,
  FormulaField,
  IFieldVisitor,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  LookupField,
  MultipleSelectField,
  NumberField,
  RatingField,
  RollupField,
  SingleLineTextField,
  SingleSelectField,
  UserField,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IMetaValidationContext } from './MetaValidationContext';
import type { MetaValidationIssue } from './MetaValidationResult';
import {
  referenceError,
  schemaError,
  referenceSuccess,
  schemaSuccess,
} from './MetaValidationResult';

/**
 * Field visitor that collects meta validation issues.
 *
 * Validates field configurations and cross-table references:
 * - Link fields: foreignTableId, lookupFieldId, symmetricFieldId consistency
 * - Lookup fields: linkFieldId, foreignTableId, lookupFieldId
 * - Rollup fields: linkFieldId, foreignTableId, lookupFieldId
 * - Formula fields: dependency field references
 * - Select fields: choice ID uniqueness
 *
 * @example
 * ```typescript
 * const visitor = new MetaValidationVisitor(ctx);
 * const issues = field.accept(visitor);
 * if (issues.isOk()) {
 *   for (const issue of issues.value) {
 *     console.log(issue.message);
 *   }
 * }
 * ```
 */
export class MetaValidationVisitor implements IFieldVisitor<MetaValidationIssue[]> {
  constructor(private readonly ctx: IMetaValidationContext) {}

  /**
   * Helper to create field info for issues.
   */
  private fieldInfo(field: {
    id(): { toString(): string };
    name(): { toString(): string };
    type(): { toString(): string };
  }): { fieldId: string; fieldName: string; fieldType: string } {
    return {
      fieldId: field.id().toString(),
      fieldName: field.name().toString(),
      fieldType: field.type().toString(),
    };
  }

  /**
   * Validate Link field references and symmetric field consistency.
   */
  visitLinkField(field: LinkField): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);

    // 1. Validate foreignTableId exists
    const foreignTableId = field.foreignTableId().toString();
    const foreignTable = this.ctx.getTable(foreignTableId);
    if (!foreignTable) {
      issues.push(
        referenceError({
          ...info,
          message: `Foreign table not found: ${foreignTableId}`,
          relatedTableId: foreignTableId,
        })
      );
      // Cannot continue validation without foreign table
      return ok(issues);
    }
    issues.push(
      referenceSuccess({
        ...info,
        message: `✓ Foreign table exists: ${foreignTable.name().toString()}`,
        relatedTableId: foreignTableId,
      })
    );

    // 2. Validate lookupFieldId exists in foreign table
    const lookupFieldId = field.lookupFieldId().toString();
    const lookupField = this.ctx.getField(foreignTableId, lookupFieldId);
    if (!lookupField) {
      issues.push(
        referenceError({
          ...info,
          message: `Lookup field not found in foreign table: ${lookupFieldId}`,
          relatedTableId: foreignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Lookup field exists: ${lookupField.name().toString()}`,
          relatedTableId: foreignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    }

    // 3. Validate symmetricFieldId consistency (for two-way links)
    if (!field.isOneWay()) {
      const symmetricFieldId = field.symmetricFieldId();
      if (symmetricFieldId) {
        const symFieldIdStr = symmetricFieldId.toString();
        const symmetricField = this.ctx.getField(foreignTableId, symFieldIdStr);

        if (!symmetricField) {
          issues.push(
            referenceError({
              ...info,
              message: `Symmetric field not found in foreign table: ${symFieldIdStr}`,
              relatedTableId: foreignTableId,
              relatedFieldId: symFieldIdStr,
            })
          );
        } else {
          // Validate symmetric field is a link field
          if (symmetricField.type().toString() !== 'link') {
            issues.push(
              referenceError({
                ...info,
                message: `Symmetric field is not a link field (found: ${symmetricField.type().toString()})`,
                relatedTableId: foreignTableId,
                relatedFieldId: symFieldIdStr,
              })
            );
          } else {
            issues.push(
              referenceSuccess({
                ...info,
                message: `✓ Symmetric field exists: ${symmetricField.name().toString()}`,
                relatedTableId: foreignTableId,
                relatedFieldId: symFieldIdStr,
              })
            );

            // Validate symmetric link points back to current table
            const symLinkField = symmetricField as LinkField;
            const symForeignTableId = symLinkField.foreignTableId().toString();
            const currentTableId = this.ctx.table.id().toString();

            if (symForeignTableId !== currentTableId) {
              issues.push(
                referenceError({
                  ...info,
                  message: `Symmetric field's foreignTableId (${symForeignTableId}) does not point back to current table (${currentTableId})`,
                  relatedTableId: foreignTableId,
                  relatedFieldId: symFieldIdStr,
                })
              );
            } else {
              issues.push(
                referenceSuccess({
                  ...info,
                  message: `✓ Symmetric field points back to current table`,
                  relatedTableId: foreignTableId,
                  relatedFieldId: symFieldIdStr,
                })
              );
            }

            // Validate symmetric field's symmetricFieldId points back to this field
            const symSymmetricFieldId = symLinkField.symmetricFieldId();
            if (symSymmetricFieldId) {
              const symSymFieldIdStr = symSymmetricFieldId.toString();
              if (symSymFieldIdStr !== info.fieldId) {
                issues.push(
                  referenceError({
                    ...info,
                    message: `Symmetric field's symmetricFieldId (${symSymFieldIdStr}) does not point back to this field (${info.fieldId})`,
                    relatedTableId: foreignTableId,
                    relatedFieldId: symFieldIdStr,
                  })
                );
              } else {
                issues.push(
                  referenceSuccess({
                    ...info,
                    message: `✓ Bidirectional symmetry is consistent`,
                    relatedTableId: foreignTableId,
                    relatedFieldId: symFieldIdStr,
                  })
                );
              }
            }
          }
        }
      } else {
        // Two-way link should have symmetricFieldId
        issues.push(
          schemaError({
            ...info,
            message: 'Two-way link field is missing symmetricFieldId',
            path: 'config.symmetricFieldId',
          })
        );
      }
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ One-way link (no symmetric field required)`,
        })
      );
    }

    return ok(issues);
  }

  /**
   * Validate Lookup field references.
   */
  visitLookupField(field: LookupField): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);
    const currentTableId = this.ctx.table.id().toString();

    // 1. Validate linkFieldId exists in current table
    const linkFieldId = field.linkFieldId().toString();
    const linkField = this.ctx.getField(currentTableId, linkFieldId);

    if (!linkField) {
      issues.push(
        referenceError({
          ...info,
          message: `Link field not found: ${linkFieldId}`,
          relatedFieldId: linkFieldId,
        })
      );
      return ok(issues);
    }

    // 2. Validate linkField is a link type
    if (linkField.type().toString() !== 'link') {
      issues.push(
        referenceError({
          ...info,
          message: `Referenced field is not a link field (found: ${linkField.type().toString()})`,
          relatedFieldId: linkFieldId,
        })
      );
      return ok(issues);
    }
    issues.push(
      referenceSuccess({
        ...info,
        message: `✓ Link field exists: ${linkField.name().toString()}`,
        relatedFieldId: linkFieldId,
      })
    );

    const linkFieldTyped = linkField as LinkField;

    // 3. Validate foreignTableId matches linkField's foreignTableId
    const lookupForeignTableId = field.foreignTableId().toString();
    const linkForeignTableId = linkFieldTyped.foreignTableId().toString();

    if (lookupForeignTableId !== linkForeignTableId) {
      issues.push(
        referenceError({
          ...info,
          message: `Foreign table ID mismatch: lookup has ${lookupForeignTableId}, link field has ${linkForeignTableId}`,
          relatedTableId: lookupForeignTableId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Foreign table ID matches link field`,
          relatedTableId: lookupForeignTableId,
        })
      );
    }

    // 4. Validate lookupFieldId exists in foreign table
    const lookupFieldId = field.lookupFieldId().toString();
    const lookupSourceField = this.ctx.getField(lookupForeignTableId, lookupFieldId);
    if (!lookupSourceField) {
      issues.push(
        referenceError({
          ...info,
          message: `Lookup source field not found in foreign table: ${lookupFieldId}`,
          relatedTableId: lookupForeignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Lookup source field exists: ${lookupSourceField.name().toString()}`,
          relatedTableId: lookupForeignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    }

    return ok(issues);
  }

  /**
   * Validate Rollup field references (similar to Lookup).
   */
  visitRollupField(field: RollupField): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);
    const currentTableId = this.ctx.table.id().toString();

    // 1. Validate linkFieldId exists in current table
    const linkFieldId = field.linkFieldId().toString();
    const linkField = this.ctx.getField(currentTableId, linkFieldId);

    if (!linkField) {
      issues.push(
        referenceError({
          ...info,
          message: `Link field not found: ${linkFieldId}`,
          relatedFieldId: linkFieldId,
        })
      );
      return ok(issues);
    }

    // 2. Validate linkField is a link type
    if (linkField.type().toString() !== 'link') {
      issues.push(
        referenceError({
          ...info,
          message: `Referenced field is not a link field (found: ${linkField.type().toString()})`,
          relatedFieldId: linkFieldId,
        })
      );
      return ok(issues);
    }
    issues.push(
      referenceSuccess({
        ...info,
        message: `✓ Link field exists: ${linkField.name().toString()}`,
        relatedFieldId: linkFieldId,
      })
    );

    const linkFieldTyped = linkField as LinkField;

    // 3. Validate foreignTableId matches linkField's foreignTableId
    const rollupForeignTableId = field.foreignTableId().toString();
    const linkForeignTableId = linkFieldTyped.foreignTableId().toString();

    if (rollupForeignTableId !== linkForeignTableId) {
      issues.push(
        referenceError({
          ...info,
          message: `Foreign table ID mismatch: rollup has ${rollupForeignTableId}, link field has ${linkForeignTableId}`,
          relatedTableId: rollupForeignTableId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Foreign table ID matches link field`,
          relatedTableId: rollupForeignTableId,
        })
      );
    }

    // 4. Validate lookupFieldId exists in foreign table
    const lookupFieldId = field.lookupFieldId().toString();
    const lookupSourceField = this.ctx.getField(rollupForeignTableId, lookupFieldId);
    if (!lookupSourceField) {
      issues.push(
        referenceError({
          ...info,
          message: `Rollup source field not found in foreign table: ${lookupFieldId}`,
          relatedTableId: rollupForeignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Rollup source field exists: ${lookupSourceField.name().toString()}`,
          relatedTableId: rollupForeignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    }

    return ok(issues);
  }

  /**
   * Validate Formula field dependency references.
   */
  visitFormulaField(field: FormulaField): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);
    const currentTableId = this.ctx.table.id().toString();

    // Validate all dependencies exist
    const dependencies = field.dependencies();
    if (dependencies.length === 0) {
      issues.push(
        schemaSuccess({
          ...info,
          message: `✓ Formula has no field dependencies`,
        })
      );
      return ok(issues);
    }

    let validCount = 0;
    for (const depFieldId of dependencies) {
      const depFieldIdStr = depFieldId.toString();
      const depField = this.ctx.getField(currentTableId, depFieldIdStr);
      if (!depField) {
        issues.push(
          referenceError({
            ...info,
            message: `Formula references non-existent field: ${depFieldIdStr}`,
            relatedFieldId: depFieldIdStr,
          })
        );
      } else {
        validCount++;
      }
    }

    if (validCount === dependencies.length) {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ All ${validCount} dependency fields exist`,
        })
      );
    } else if (validCount > 0) {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ ${validCount} of ${dependencies.length} dependency fields exist`,
        })
      );
    }

    return ok(issues);
  }

  /**
   * Validate SingleSelect field choices.
   */
  visitSingleSelectField(field: SingleSelectField): Result<MetaValidationIssue[], DomainError> {
    return this.validateSelectChoices(field);
  }

  /**
   * Validate MultipleSelect field choices.
   */
  visitMultipleSelectField(field: MultipleSelectField): Result<MetaValidationIssue[], DomainError> {
    return this.validateSelectChoices(field);
  }

  /**
   * Helper to validate select field choices for ID uniqueness.
   */
  private validateSelectChoices(field: {
    id(): { toString(): string };
    name(): { toString(): string };
    type(): { toString(): string };
    selectOptions(): ReadonlyArray<{
      id(): { toString(): string };
      name(): { toString(): string };
    }>;
  }): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);

    const options = field.selectOptions();
    const seenIds = new Set<string>();
    const duplicateIds: string[] = [];

    for (const opt of options) {
      const id = opt.id().toString();
      if (seenIds.has(id)) {
        duplicateIds.push(id);
      }
      seenIds.add(id);
    }

    if (duplicateIds.length > 0) {
      issues.push(
        schemaError({
          ...info,
          message: `Duplicate choice IDs found: ${duplicateIds.join(', ')}`,
          path: 'options.choices',
        })
      );
    } else {
      issues.push(
        schemaSuccess({
          ...info,
          message: `✓ All ${options.length} choice IDs are unique`,
          path: 'options.choices',
        })
      );
    }

    return ok(issues);
  }

  /**
   * Validate ConditionalRollup field references.
   */
  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);

    // Validate foreignTableId exists
    const foreignTableId = field.foreignTableId().toString();
    const foreignTable = this.ctx.getTable(foreignTableId);
    if (!foreignTable) {
      issues.push(
        referenceError({
          ...info,
          message: `Foreign table not found: ${foreignTableId}`,
          relatedTableId: foreignTableId,
        })
      );
      return ok(issues);
    }
    issues.push(
      referenceSuccess({
        ...info,
        message: `✓ Foreign table exists: ${foreignTable.name().toString()}`,
        relatedTableId: foreignTableId,
      })
    );

    // Validate lookupFieldId exists in foreign table
    const lookupFieldId = field.lookupFieldId().toString();
    const lookupField = this.ctx.getField(foreignTableId, lookupFieldId);
    if (!lookupField) {
      issues.push(
        referenceError({
          ...info,
          message: `Lookup field not found in foreign table: ${lookupFieldId}`,
          relatedTableId: foreignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Lookup field exists: ${lookupField.name().toString()}`,
          relatedTableId: foreignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    }

    return ok(issues);
  }

  /**
   * Validate ConditionalLookup field references.
   */
  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<MetaValidationIssue[], DomainError> {
    const issues: MetaValidationIssue[] = [];
    const info = this.fieldInfo(field);

    // Validate foreignTableId exists
    const foreignTableId = field.foreignTableId().toString();
    const foreignTable = this.ctx.getTable(foreignTableId);
    if (!foreignTable) {
      issues.push(
        referenceError({
          ...info,
          message: `Foreign table not found: ${foreignTableId}`,
          relatedTableId: foreignTableId,
        })
      );
      return ok(issues);
    }
    issues.push(
      referenceSuccess({
        ...info,
        message: `✓ Foreign table exists: ${foreignTable.name().toString()}`,
        relatedTableId: foreignTableId,
      })
    );

    // Validate lookupFieldId exists in foreign table
    const lookupFieldId = field.lookupFieldId().toString();
    const lookupField = this.ctx.getField(foreignTableId, lookupFieldId);
    if (!lookupField) {
      issues.push(
        referenceError({
          ...info,
          message: `Lookup field not found in foreign table: ${lookupFieldId}`,
          relatedTableId: foreignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    } else {
      issues.push(
        referenceSuccess({
          ...info,
          message: `✓ Lookup field exists: ${lookupField.name().toString()}`,
          relatedTableId: foreignTableId,
          relatedFieldId: lookupFieldId,
        })
      );
    }

    return ok(issues);
  }

  // Simple fields - schema is already validated at creation time
  // Return success info indicating meta is valid

  visitSingleLineTextField(field: SingleLineTextField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitLongTextField(field: LongTextField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitNumberField(field: NumberField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitRatingField(field: RatingField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitCheckboxField(field: CheckboxField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitAttachmentField(field: AttachmentField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitDateField(field: DateField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitUserField(field: UserField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitCreatedByField(field: CreatedByField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitAutoNumberField(field: AutoNumberField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }

  visitButtonField(field: ButtonField): Result<MetaValidationIssue[], DomainError> {
    return ok([
      schemaSuccess({
        ...this.fieldInfo(field),
        message: `✓ Field configuration is valid`,
      }),
    ]);
  }
}
