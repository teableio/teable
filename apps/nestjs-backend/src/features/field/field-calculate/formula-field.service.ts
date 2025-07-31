import { Injectable } from '@nestjs/common';
import { FieldType, getGeneratedColumnName } from '@teable/core';
import type { IFormulaFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';

@Injectable()
export class FormulaFieldService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Get all formula fields that depend on the given field (including multi-level dependencies)
   * Uses recursive CTE to find all downstream dependencies in topological order
   */
  async getDependentFormulaFieldsInOrder(
    fieldId: string
  ): Promise<{ id: string; tableId: string; level: number }[]> {
    // Use recursive CTE to find all downstream dependencies
    const recursiveCTE = `
      WITH RECURSIVE dependent_fields AS (
        -- Base case: direct dependencies
        SELECT
          r.to_field_id as field_id,
          1 as level
        FROM reference r
        WHERE r.from_field_id = $1

        UNION ALL

        -- Recursive case: indirect dependencies
        SELECT
          r.to_field_id as field_id,
          df.level + 1 as level
        FROM reference r
        INNER JOIN dependent_fields df ON r.from_field_id = df.field_id
        WHERE df.level < 10  -- Prevent infinite recursion
      )
      SELECT DISTINCT
        f.id,
        f.table_id,
        df.level
      FROM dependent_fields df
      INNER JOIN field f ON f.id = df.field_id
      WHERE f.type = $2
        AND f.deleted_time IS NULL
      ORDER BY df.level DESC, f.id  -- Deepest dependencies first (topological order)
    `;

    const result = await this.prismaService.txClient().$queryRawUnsafe<
      // eslint-disable-next-line @typescript-eslint/naming-convention
      { id: string; table_id: string; level: number }[]
    >(recursiveCTE, fieldId, FieldType.Formula);

    return result.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      level: row.level,
    }));
  }

  /**
   * Build field map for formula conversion context
   * For formula fields with dbGenerated=true, use the generated column name
   */
  async buildFieldMapForTable(tableId: string): Promise<{
    [fieldId: string]: { columnName: string; fieldType?: string; dbGenerated?: boolean };
  }> {
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, dbFieldName: true, type: true, options: true },
    });

    const fieldMap: {
      [fieldId: string]: { columnName: string; fieldType?: string; dbGenerated?: boolean };
    } = {};

    for (const field of fields) {
      let columnName = field.dbFieldName;
      let dbGenerated = false;

      // For formula fields with dbGenerated=true, use the generated column name
      if (field.type === FieldType.Formula && field.options) {
        try {
          const options = JSON.parse(field.options as string) as IFormulaFieldOptions;
          if (options.dbGenerated) {
            columnName = getGeneratedColumnName(field.dbFieldName);
            dbGenerated = true;
          }
        } catch (error) {
          // If JSON parsing fails, use default values
          console.warn(`Failed to parse options for field ${field.id}:`, error);
        }
      }

      fieldMap[field.id] = {
        columnName,
        fieldType: field.type,
        dbGenerated,
      };
    }

    return fieldMap;
  }
}
