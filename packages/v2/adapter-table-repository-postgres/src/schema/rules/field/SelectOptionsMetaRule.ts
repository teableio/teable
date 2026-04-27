import type { DomainError, MultipleSelectField, SingleSelectField } from '@teable/v2-core';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  compressSql,
  quoteIdentifier,
  quoteLiteral,
  quoteTableIdentifier,
} from '../helpers/StatementBuilders';

type SelectField = SingleSelectField | MultipleSelectField;
type SelectChoiceDto = {
  id: string;
  name: string;
  color: string;
};

const normalizeSelectChoice = (value: unknown): SelectChoiceDto | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Partial<SelectChoiceDto>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.color !== 'string'
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    color: candidate.color,
  };
};

export class SelectOptionsMetaRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  constructor(
    private readonly field: SelectField,
    dependsOnRuleId?: string
  ) {
    this.id = `select_options:${field.id().toString()}`;
    this.description = `Select options metadata for "${field.name().toString()}"`;
    this.dependencies = dependsOnRuleId ? [dependsOnRuleId] : [];
  }

  private expectedChoices(): ReadonlyArray<SelectChoiceDto> {
    const choices: SelectChoiceDto[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (const option of this.field.selectOptions()) {
      const dto = option.toDto();
      if (seenIds.has(dto.id) || seenNames.has(dto.name)) {
        continue;
      }
      seenIds.add(dto.id);
      seenNames.add(dto.name);
      choices.push(dto);
    }

    return choices;
  }

  private parseOptions(raw: unknown): Record<string, unknown> | undefined {
    if (raw == null) {
      return {};
    }

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return this.parseOptions(parsed);
      } catch {
        return undefined;
      }
    }

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return undefined;
    }

    return raw as Record<string, unknown>;
  }

  private normalizeChoices(value: unknown): ReadonlyArray<SelectChoiceDto> | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const normalized: SelectChoiceDto[] = [];
    for (const item of value) {
      const choice = normalizeSelectChoice(item);
      if (!choice) {
        return undefined;
      }
      normalized.push(choice);
    }

    return normalized;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const fieldId = this.field.id().toString();
    const result = await ctx.db
      .selectFrom('field')
      .select('options')
      .where('id', '=', fieldId)
      .executeTakeFirst();

    if (!result) {
      return ok({
        valid: false,
        missing: [`field record with id "${fieldId}" not found in field table`],
      });
    }

    const currentOptions = this.parseOptions(result.options);
    if (!currentOptions) {
      return ok({
        valid: false,
        missing: [`field "${fieldId}" has invalid JSON in options column`],
      });
    }

    const currentChoices = this.normalizeChoices(currentOptions.choices);
    if (!currentChoices) {
      return ok({
        valid: false,
        missing: ['options.choices is missing or invalid'],
      });
    }

    if (JSON.stringify(currentChoices) !== JSON.stringify(this.expectedChoices())) {
      return ok({
        valid: false,
        missing: ['options.choices does not match the field definition'],
      });
    }

    return ok({ valid: true });
  }

  getRepairHint(
    _ctx: SchemaRuleContext,
    _validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    return ok({
      available: true,
      mode: 'auto',
      reason: {
        fallback: `Automatic repair will reconcile select option metadata for "${this.field.name().toString()}".`,
      },
      description: {
        fallback:
          'This repair rewrites field.options.choices to match the field definition, migrates cells that point at removed duplicate choice IDs or names to the retained choice, and preserves unrelated option keys. Labels, colors, and option order can change immediately in the UI. Cells that point at choices with no retained ID or name match may still display empty or unknown values until those stored values are corrected separately.',
      },
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const rule = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const fieldId = rule.field.id().toString();
      const columnName = yield* resolveColumnName(ctx.field);
      const patch = JSON.stringify({ choices: rule.expectedChoices() });
      const updateOptions = ctx.db
        .updateTable('field')
        .set({
          options: sql`(coalesce(options::jsonb, '{}'::jsonb) || ${patch}::jsonb)::text`,
        })
        .where('id', '=', fieldId);

      return ok([rule.repairStoredChoiceValues(ctx, columnName), updateOptions]);
    });
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldId = this.field.id().toString();
    const updateOptions = ctx.db
      .updateTable('field')
      .set({
        options: sql`(coalesce(options::jsonb, '{}'::jsonb) - 'choices')::text`,
      })
      .where('id', '=', fieldId);

    return ok([updateOptions]);
  }

  private buildChoiceTokenMapSql(): string {
    return compressSql(`
      current_choices AS (
        SELECT
          choice->>'id' AS old_id,
          choice->>'name' AS old_name
        FROM field f
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(f.options::jsonb->'choices', '[]'::jsonb)
        ) AS choice
        WHERE f.id = ${quoteLiteral(this.field.id().toString())}
      ),
      canonical_choices AS (
        SELECT
          choice->>'id' AS id,
          choice->>'name' AS name
        FROM jsonb_array_elements(${quoteLiteral(JSON.stringify(this.expectedChoices()))}::jsonb) AS choice
      ),
      choice_token_map AS (
        SELECT DISTINCT ON (token)
          token,
          canonical_name
        FROM (
          SELECT
            CASE
              WHEN c.old_id IS NOT NULL AND c.old_id <> canonical.id THEN c.old_id
            END AS token,
            canonical.name AS canonical_name
          FROM current_choices c
          CROSS JOIN LATERAL (
            SELECT e.id, e.name
            FROM canonical_choices e
            WHERE e.id = c.old_id OR e.name = c.old_name
            ORDER BY CASE WHEN e.id = c.old_id THEN 0 ELSE 1 END
            LIMIT 1
          ) canonical
          UNION ALL
          SELECT
            CASE
              WHEN c.old_name IS NOT NULL AND c.old_name <> canonical.name THEN c.old_name
            END AS token,
            canonical.name AS canonical_name
          FROM current_choices c
          CROSS JOIN LATERAL (
            SELECT e.id, e.name
            FROM canonical_choices e
            WHERE e.id = c.old_id OR e.name = c.old_name
            ORDER BY CASE WHEN e.id = c.old_id THEN 0 ELSE 1 END
            LIMIT 1
          ) canonical
        ) mapped
        WHERE token IS NOT NULL AND token <> ''
        ORDER BY token
      )
    `);
  }

  private repairStoredChoiceValues(
    ctx: SchemaRuleContext,
    columnName: string
  ): TableSchemaStatementBuilder {
    const tableName = quoteTableIdentifier({ schema: ctx.schema, tableName: ctx.tableName });
    const column = quoteIdentifier(columnName);

    if (this.field.type().toString() === 'multipleSelect') {
      return sql.raw(
        compressSql(`
          WITH ${this.buildChoiceTokenMapSql()}
          UPDATE ${tableName} AS t
          SET ${column} = COALESCE(
            (
              SELECT jsonb_agg(d.mapped_value ORDER BY d.ord)
              FROM (
                SELECT mapped_value, MIN(ord) AS ord
                FROM (
                  SELECT
                    COALESCE(m.canonical_name, elem.value #>> '{}') AS mapped_value,
                    elem.ord
                  FROM jsonb_array_elements(t.${column}) WITH ORDINALITY AS elem(value, ord)
                  LEFT JOIN choice_token_map m
                    ON jsonb_typeof(elem.value) = 'string'
                    AND elem.value #>> '{}' = m.token
                ) expanded
                GROUP BY mapped_value
              ) d
            ),
            '[]'::jsonb
          )
          WHERE t.${column} IS NOT NULL
            AND jsonb_typeof(t.${column}) = 'array'
            AND EXISTS (SELECT 1 FROM choice_token_map)
        `)
      );
    }

    return sql.raw(
      compressSql(`
        WITH ${this.buildChoiceTokenMapSql()}
        UPDATE ${tableName} AS t
        SET ${column} = m.canonical_name
        FROM choice_token_map m
        WHERE t.${column} = m.token
      `)
    );
  }
}
