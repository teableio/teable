import { Injectable } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { createFieldInstanceByRaw, type IFieldInstance } from '../model/factory';

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

    return (result || []).map((row) => ({
      id: row.id,
      tableId: row.table_id,
      level: row.level,
    }));
  }

  /**
   * Build field map for formula conversion context
   * Returns a Map of field instances for formula conversion
   */
  async buildFieldMapForTable(tableId: string): Promise<Map<string, IFieldInstance>> {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
    });

    const fieldMap = new Map<string, IFieldInstance>();

    for (const fieldRaw of fieldRaws) {
      const fieldInstance = createFieldInstanceByRaw(fieldRaw);
      fieldMap.set(fieldInstance.id, fieldInstance);
    }

    return fieldMap;
  }
}
