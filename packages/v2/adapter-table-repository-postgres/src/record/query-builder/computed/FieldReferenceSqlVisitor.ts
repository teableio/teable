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
  Field,
  FieldType,
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
  Table,
  UserField,
} from '@teable/v2-core';
import {
  makeExpr,
  type SqlExpr,
  type SqlStorageKind,
  type SqlValueType,
} from '@teable/v2-formula-sql-pg';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { FieldOutputColumnVisitor } from '../FieldOutputColumnVisitor';
import type { ILateralContext, LinkOrderBy } from './ComputedFieldSelectExpressionVisitor';

/**
 * Configuration for FieldReferenceSqlVisitor
 */
export interface IFieldReferenceSqlVisitorConfig {
  /** The table containing the fields */
  table: Table;
  /** The alias for the main table in the query */
  tableAlias: string;
  /** Context for managing lateral joins for link-based fields */
  lateral: ILateralContext;
  /** Foreign table IDs that are missing (e.g., deleted) and should be skipped */
  missingForeignTableIds?: ReadonlySet<string>;
}

/**
 * Visitor that generates SQL expressions for field references in formulas.
 *
 * This visitor handles the transformation of field references (e.g., {fieldName})
 * into appropriate SQL expressions. For fields that store JSON (like link, user, button)
 * or user IDs (like createdBy, lastModifiedBy), it extracts the display value directly.
 *
 * Key behaviors:
 * - Link fields: Extract 'title' from JSON via lateral join
 * - User fields: Extract 'name' or 'title' from JSON
 * - CreatedBy/LastModifiedBy: Lookup user name from public.users table
 * - Button fields: Extract 'title' from JSON
 * - Attachment fields: Extract 'name' from JSON
 * - Lookup/Rollup fields: Set up lateral joins and return appropriate expressions
 */
export class FieldReferenceSqlVisitor implements IFieldVisitor<SqlExpr> {
  private readonly columnVisitor = new FieldOutputColumnVisitor();
  private readonly table: Table;
  private readonly tableAlias: string;
  private readonly lateral: ILateralContext;
  private readonly missingForeignTableIds: ReadonlySet<string>;

  constructor(config: IFieldReferenceSqlVisitorConfig) {
    this.table = config.table;
    this.tableAlias = config.tableAlias;
    this.lateral = config.lateral;
    this.missingForeignTableIds = config.missingForeignTableIds ?? new Set();
  }

  private isMissingForeignTableId(tableId: string): boolean {
    return this.missingForeignTableIds.has(tableId);
  }

  private missingForeignTableExpr(field: Field): Result<SqlExpr, DomainError> {
    return ok(makeExpr('NULL', 'unknown', false, undefined, undefined, field));
  }

  private getColAlias(field: Field): Result<string, DomainError> {
    return this.columnVisitor.getColumnAlias(field);
  }

  private quoteIdentifier(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private qualify(alias: string, column: string): string {
    return `${this.quoteIdentifier(alias)}.${this.quoteIdentifier(column)}`;
  }

  /**
   * Map a FieldType to a SqlValueType for proper type coercion in formulas.
   */
  private mapFieldTypeToValueType(fieldType: FieldType): SqlValueType {
    const typeStr = fieldType.toString();
    if (typeStr === 'number' || typeStr === 'autoNumber' || typeStr === 'rating') {
      return 'number';
    }
    if (typeStr === 'checkbox') {
      return 'boolean';
    }
    if (typeStr === 'date' || typeStr === 'createdTime' || typeStr === 'lastModifiedTime') {
      return 'datetime';
    }
    return 'string';
  }

  private isJsonFieldType(fieldType: FieldType): boolean {
    const typeStr = fieldType.toString();
    return (
      typeStr === 'user' ||
      typeStr === 'attachment' ||
      typeStr === 'button' ||
      typeStr === 'link' ||
      typeStr === 'multipleSelect'
    );
  }

  private resolveLookupStorageKind(
    fieldType: FieldType | undefined,
    isMultiValue: boolean
  ): SqlStorageKind | undefined {
    if (isMultiValue) return 'array';
    if (!fieldType) return undefined;
    return this.isJsonFieldType(fieldType) ? 'json' : undefined;
  }

  private getLinkOrderBy(field: LinkField): Result<LinkOrderBy | undefined, DomainError> {
    if (!field.relationship().isMultipleValue()) return ok(undefined);
    if (!field.hasOrderColumn()) return ok(undefined);

    const orderColumnResult = field.orderColumnName();
    if (orderColumnResult.isErr()) return err(orderColumnResult.error);
    const orderColumn = orderColumnResult.value;

    const relationship = field.relationship().toString();
    const usesJunction =
      relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay());
    if (usesJunction) {
      return field.fkHostTableNameString().andThen((junctionTable) =>
        field.selfKeyNameString().andThen((selfKey) =>
          field.foreignKeyNameString().map(
            (foreignKey): LinkOrderBy => ({
              source: 'junction',
              column: orderColumn,
              junctionTable,
              selfKey,
              foreignKey,
            })
          )
        )
      );
    }

    return ok({ source: 'foreign', column: orderColumn });
  }

  /**
   * Default handling for simple scalar fields.
   * Returns a direct column reference without any transformation.
   */
  private scalarColumn(field: Field): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).map((colAlias) =>
      makeExpr(
        this.qualify(this.tableAlias, colAlias),
        'unknown',
        false,
        undefined,
        undefined,
        field,
        'scalar'
      )
    );
  }

  // ============================================================
  // Simple scalar fields - direct column reference
  // ============================================================

  visitSingleLineTextField(field: SingleLineTextField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitLongTextField(field: LongTextField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitNumberField(field: NumberField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitCheckboxField(field: CheckboxField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitDateField(field: DateField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitSingleSelectField(field: SingleSelectField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitAutoNumberField(field: AutoNumberField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitRatingField(field: RatingField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  visitFormulaField(field: FormulaField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  // ============================================================
  // JSON fields with display value extraction
  // ============================================================

  /**
   * User field stores JSON with {id, title/name} or array of such objects for multiple users.
   * Return raw column reference - let formula functions handle the JSON as needed.
   * This preserves truthy behavior for IF() while formula display uses visitFormulaField's
   * storageKind='json' handling for extraction.
   */
  visitUserField(field: UserField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  /**
   * Button field stores JSON with {title, ...}.
   * Return raw column reference - let formula functions handle the JSON as needed.
   */
  visitButtonField(field: ButtonField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  /**
   * Attachment field stores JSON array with [{name, ...}, ...].
   * Return raw column reference - let formula functions handle the JSON as needed.
   */
  visitAttachmentField(field: AttachmentField): Result<SqlExpr, DomainError> {
    return this.scalarColumn(field);
  }

  // ============================================================
  // User ID fields with name lookup
  // ============================================================

  /**
   * CreatedBy field stores user ID (string).
   * Look up user name from public.users table for formula references.
   * Falls back to user ID if user not found.
   */
  visitCreatedByField(_field: CreatedByField): Result<SqlExpr, DomainError> {
    const colRef = this.qualify(this.tableAlias, '__created_by');
    const userNameSubquery = `COALESCE((SELECT u.name FROM public.users u WHERE u.id = ${colRef}), ${colRef})`;
    return ok(makeExpr(userNameSubquery, 'string', false));
  }

  /**
   * LastModifiedBy field stores user ID (string).
   * Look up user name from public.users table for formula references.
   * Falls back to user ID if user not found.
   */
  visitLastModifiedByField(_field: LastModifiedByField): Result<SqlExpr, DomainError> {
    const colRef = this.qualify(this.tableAlias, '__last_modified_by');
    const userNameSubquery = `COALESCE((SELECT u.name FROM public.users u WHERE u.id = ${colRef}), ${colRef})`;
    return ok(makeExpr(userNameSubquery, 'string', false));
  }

  // ============================================================
  // Link-based fields - require lateral joins
  // ============================================================

  /**
   * Link field requires lateral join to fetch linked record data.
   * Returns the raw lateral join result (JSON object or array).
   * The JSON extraction happens in visitFormulaField via storageKind='json'.
   */
  visitLinkField(field: LinkField): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      if (this.isMissingForeignTableId(field.foreignTableId().toString())) {
        return this.missingForeignTableExpr(field);
      }
      const isMultiValue = field.relationship().isMultipleValue();
      const orderByResult = this.getLinkOrderBy(field);
      if (orderByResult.isErr()) return err(orderByResult.error);
      const lateralAlias = this.lateral.addColumn(
        field.id(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'link',
          lookupFieldId: field.lookupFieldId(),
          isMultiValue,
          orderBy: orderByResult.value,
        }
      );
      // Return the raw lateral reference - JSON extraction handled by visitFormulaField
      return ok(
        makeExpr(
          this.qualify(lateralAlias, colAlias),
          'unknown',
          false,
          undefined,
          undefined,
          field,
          'json'
        )
      );
    });
  }

  /**
   * Lookup field requires lateral join to fetch data from foreign table.
   * Returns array of values from the looked-up field.
   */
  visitLookupField(field: LookupField): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      if (this.isMissingForeignTableId(field.foreignTableId().toString())) {
        return this.missingForeignTableExpr(field);
      }
      const condition = field.lookupOptions().condition();
      const linkFieldResult = field.linkField(this.table);
      if (linkFieldResult.isErr()) return err(linkFieldResult.error);
      const linkField = linkFieldResult.value;
      const orderByResult = this.getLinkOrderBy(linkField);
      if (orderByResult.isErr()) return err(orderByResult.error);
      const multiplicityResult = field
        .isMultipleCellValue()
        .map((multiplicity) => multiplicity.isMultiple());
      if (multiplicityResult.isErr()) return err(multiplicityResult.error);
      const isMultiValue = multiplicityResult.value;
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'lookup',
          foreignFieldId: field.lookupFieldId(),
          condition,
          orderBy: orderByResult.value,
          isMultiValue,
        }
      );
      // lookup returns a JSON array when multi-value, otherwise scalar/JSON value
      const innerFieldResult = field.innerField();
      const valueType = innerFieldResult.isOk()
        ? this.mapFieldTypeToValueType(innerFieldResult.value.type())
        : 'unknown';
      const storageKind = this.resolveLookupStorageKind(
        innerFieldResult.isOk() ? innerFieldResult.value.type() : undefined,
        isMultiValue
      );
      return ok(
        makeExpr(
          this.qualify(lateralAlias, colAlias),
          valueType,
          isMultiValue,
          undefined,
          undefined,
          field,
          storageKind
        )
      );
    });
  }

  /**
   * Rollup field requires lateral join to aggregate data from foreign table.
   */
  visitRollupField(field: RollupField): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      if (this.isMissingForeignTableId(field.foreignTableId().toString())) {
        return this.missingForeignTableExpr(field);
      }
      const expression = field.expression().toString();
      const linkFieldResult = field
        .linkField(this.table)
        .andThen((linkField) => this.getLinkOrderBy(linkField));
      if (linkFieldResult.isErr()) return err(linkFieldResult.error);
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'rollup',
          foreignFieldId: field.lookupFieldId(),
          expression,
          orderBy: linkFieldResult.value,
        }
      );
      return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
    });
  }

  /**
   * ConditionalLookup uses condition-based filtering instead of link relationships.
   */
  visitConditionalLookupField(field: ConditionalLookupField): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      const options = field.conditionalLookupOptions();
      if (this.isMissingForeignTableId(options.foreignTableId().toString())) {
        return this.missingForeignTableExpr(field);
      }
      const multiplicityResult = field
        .isMultipleCellValue()
        .map((multiplicity) => multiplicity.isMultiple());
      if (multiplicityResult.isErr()) return err(multiplicityResult.error);
      const isMultiValue = multiplicityResult.value;
      const lateralAlias = this.lateral.addConditionalColumn(
        field.id(),
        options.foreignTableId().toString(),
        colAlias,
        {
          type: 'conditionalLookup',
          foreignFieldId: options.lookupFieldId(),
          condition: options.condition(),
          isMultiValue,
        }
      );
      // conditionalLookup returns a JSON array when multi-value, otherwise scalar/JSON value
      const innerFieldResult = field.innerField();
      const valueType = innerFieldResult.isOk()
        ? this.mapFieldTypeToValueType(innerFieldResult.value.type())
        : 'unknown';
      const storageKind = this.resolveLookupStorageKind(
        innerFieldResult.isOk() ? innerFieldResult.value.type() : undefined,
        isMultiValue
      );
      return ok(
        makeExpr(
          this.qualify(lateralAlias, colAlias),
          valueType,
          isMultiValue,
          undefined,
          undefined,
          field,
          storageKind
        )
      );
    });
  }

  /**
   * ConditionalRollup uses condition-based filtering instead of link relationships.
   */
  visitConditionalRollupField(field: ConditionalRollupField): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      const config = field.config();
      if (this.isMissingForeignTableId(config.foreignTableId().toString())) {
        return this.missingForeignTableExpr(field);
      }
      const expression = field.expression().toString();
      const lateralAlias = this.lateral.addConditionalColumn(
        field.id(),
        config.foreignTableId().toString(),
        colAlias,
        {
          type: 'conditionalRollup',
          foreignFieldId: config.lookupFieldId(),
          expression,
          condition: config.condition(),
        }
      );
      return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
    });
  }
}
