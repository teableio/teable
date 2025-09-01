import { LinkFieldCore, Relationship } from '@teable/core';
import type { ILinkCellValue, ILinkFieldMeta } from '@teable/core';
import type { FieldBase } from '../field-base';

export class LinkFieldDto extends LinkFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return true;
  }

  setMetadata(meta: ILinkFieldMeta) {
    this.meta = meta;
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }

  updateCellTitle(
    value: ILinkCellValue | ILinkCellValue[],
    title: string | null | (string | null)[]
  ) {
    if (this.isMultipleCellValue) {
      const values = value as ILinkCellValue[];
      const titles = title as string[];
      return values.map((v, i) => ({
        id: v.id,
        title: titles[i] || undefined,
      }));
    }
    return {
      id: (value as ILinkCellValue).id,
      title: (title as string | null) || undefined,
    };
  }

  override convertStringToCellValue(value: string): string[] | null {
    const cellValue = value.split(/[,\n\r]\s*/);
    if (cellValue.length) {
      return cellValue;
    }
    return null;
  }

  /**
   * Get the order column name for this link field based on its relationship type
   * @returns The order column name to use in database queries and operations
   */
  getOrderColumnName(): string {
    const relationship = this.options.relationship;

    switch (relationship) {
      case Relationship.ManyMany:
        // ManyMany relationships use a simple __order column in the junction table
        return '__order';

      case Relationship.OneMany:
        // OneMany relationships use the selfKeyName (foreign key in target table) + _order
        // Note: one-way OneMany does not have an order column; callers must check getHasOrderColumn()
        return `${this.options.selfKeyName}_order`;

      case Relationship.ManyOne:
      case Relationship.OneOne:
        // ManyOne and OneOne relationships use the foreignKeyName (foreign key in current table) + _order
        return `${this.options.foreignKeyName}_order`;

      default:
        throw new Error(`Unsupported relationship type: ${relationship}`);
    }
  }

  // Use base class getHasOrderColumn() which prefers meta when provided
}
