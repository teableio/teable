import { Injectable } from '@nestjs/common';
import { FieldType, FormulaFieldCore, FormulaExpansionVisitor } from '@teable/core';
import type { IFormulaFieldOptions, IFieldExpansionMap } from '@teable/core';

export interface IFieldForExpansion {
  id: string;
  type: string;
  dbFieldName: string;
  options: string | null;
}

export interface IFormulaExpansionContext {
  fieldMap: { [fieldId: string]: IFieldForExpansion };
  expandedExpressions: Map<string, string>; // Cache for expanded expressions
  expansionStack: Set<string>; // Track circular references
}

/**
 * Service for expanding formula expressions to avoid PostgreSQL generated column limitations
 */
@Injectable()
export class FormulaExpansionService {
  /**
   * Expand a formula expression by substituting referenced formula fields with their expressions
   *
   * This method recursively expands formula references to avoid PostgreSQL generated column limitations.
   * When a formula field references another formula field with dbGenerated=true, instead of referencing
   * the generated column name, we expand and substitute the original expression directly.
   *
   * Uses FormulaExpansionVisitor to traverse the parsed AST and replace field references, ensuring
   * consistency with the grammar definition and avoiding regex pattern duplication.
   *
   * @example
   * ```typescript
   * // Given these fields:
   * // field1: regular number field
   * // field2: formula field "{field1} + 10" (dbGenerated=true)
   * // field3: formula field "{field2} * 2" (dbGenerated=true)
   *
   * // Expanding field3's expression:
   * const result = expandFormulaExpression('{field2} * 2', context);
   * // Returns: "({field1} + 10) * 2"
   *
   * // For nested references:
   * // field4: formula field "{field3} + 5" (dbGenerated=true)
   * const nested = expandFormulaExpression('{field3} + 5', context);
   * // Returns: "(({field1} + 10) * 2) + 5"
   * ```
   *
   * @param expression The original formula expression (e.g., "{field2} * 2")
   * @param context The expansion context containing field information
   * @returns The expanded expression with formula references substituted (e.g., "({field1} + 10) * 2")
   */
  expandFormulaExpression(expression: string, context: IFormulaExpansionContext): string {
    try {
      // Get all field references in this expression
      const referencedFieldIds = FormulaFieldCore.getReferenceFieldIds(expression);

      // Build expansion map for the visitor
      const expansionMap: IFieldExpansionMap = {};

      for (const fieldId of referencedFieldIds) {
        const field = context.fieldMap[fieldId];
        if (!field) {
          throw new Error(`Referenced field not found: ${fieldId}`);
        }

        if (field.type === FieldType.Formula) {
          // Check for circular references
          if (context.expansionStack.has(fieldId)) {
            throw new Error(`Circular reference detected involving field: ${fieldId}`);
          }

          // Get the expanded expression for this formula field
          const expandedExpression = this.getExpandedExpressionForField(fieldId, context);

          // Wrap in parentheses to maintain precedence and add to expansion map
          expansionMap[fieldId] = `(${expandedExpression})`;
        } else {
          // For non-formula fields, keep as field reference (will be converted to SQL later)
          expansionMap[fieldId] = `{${fieldId}}`;
        }
      }

      // Use the visitor to perform the expansion
      const tree = FormulaFieldCore.parse(expression);
      const visitor = new FormulaExpansionVisitor(expansionMap);
      visitor.visit(tree);
      return visitor.getResult();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to expand formula expression "${expression}": ${message}`);
    }
  }

  /**
   * Get the expanded expression for a specific formula field
   * @param fieldId The ID of the formula field
   * @param context The expansion context
   * @returns The expanded expression for the field
   */
  private getExpandedExpressionForField(
    fieldId: string,
    context: IFormulaExpansionContext
  ): string {
    // Check cache first
    if (context.expandedExpressions.has(fieldId)) {
      return context.expandedExpressions.get(fieldId)!;
    }

    const field = context.fieldMap[fieldId];
    if (!field || field.type !== FieldType.Formula) {
      throw new Error(`Field ${fieldId} is not a formula field`);
    }

    // Parse the field's options to get the original expression
    let originalExpression: string;
    try {
      const options = JSON.parse(field.options || '{}') as IFormulaFieldOptions;
      originalExpression = options.expression;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse options for field ${fieldId}: ${message}`);
    }

    if (!originalExpression) {
      throw new Error(`No expression found for formula field ${fieldId}`);
    }

    // Add to expansion stack to detect circular references
    context.expansionStack.add(fieldId);

    try {
      // Recursively expand the expression
      const expandedExpression = this.expandFormulaExpression(originalExpression, context);

      // Cache the result
      context.expandedExpressions.set(fieldId, expandedExpression);

      return expandedExpression;
    } finally {
      // Remove from expansion stack
      context.expansionStack.delete(fieldId);
    }
  }

  /**
   * Create an expansion context from field data
   * @param fields Array of field data
   * @returns The expansion context
   */
  createExpansionContext(fields: IFieldForExpansion[]): IFormulaExpansionContext {
    const fieldMap: { [fieldId: string]: IFieldForExpansion } = {};

    for (const field of fields) {
      fieldMap[field.id] = field;
    }

    return {
      fieldMap,
      expandedExpressions: new Map(),
      expansionStack: new Set(),
    };
  }

  /**
   * Check if a formula field should use expansion instead of generated column reference
   * @param field The field to check
   * @param context The expansion context
   * @returns True if the field references other formula fields with dbGenerated=true
   */
  shouldExpandFormula(field: IFieldForExpansion, context: IFormulaExpansionContext): boolean {
    if (field.type !== FieldType.Formula || !field.options) {
      return false;
    }

    try {
      const options = JSON.parse(field.options) as IFormulaFieldOptions;
      if (!options.dbGenerated) {
        return false; // Not a generated column, no need to expand
      }

      // Get referenced field IDs
      const referencedFieldIds = FormulaFieldCore.getReferenceFieldIds(options.expression);

      // Check if any referenced field is a formula field with dbGenerated=true
      return referencedFieldIds.some((refFieldId) => {
        const refField = context.fieldMap[refFieldId];
        if (!refField || refField.type !== FieldType.Formula || !refField.options) {
          return false;
        }

        try {
          const refOptions = JSON.parse(refField.options) as IFormulaFieldOptions;
          return refOptions.dbGenerated === true;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }
}
