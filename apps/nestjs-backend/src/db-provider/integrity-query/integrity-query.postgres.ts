import type { Knex } from 'knex';
import { IntegrityQueryAbstract } from './abstract';

export class IntegrityQueryPostgres extends IntegrityQueryAbstract {
  constructor(protected readonly knex: Knex) {
    super(knex);
  }

  checkLinks({
    dbTableName,
    fkHostTableName,
    selfKeyName,
    foreignKeyName,
    linkDbFieldName,
    isMultiValue,
  }: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string {
    // Multi-value relationships (ManyMany, OneMany)
    if (isMultiValue) {
      const fkGroupedQuery = this.knex(fkHostTableName)
        .select({
          [selfKeyName]: selfKeyName,
          fk_ids: this.knex.raw(`string_agg(??, ',' ORDER BY ??)`, [
            this.knex.ref(foreignKeyName),
            this.knex.ref(foreignKeyName),
          ]),
        })
        .whereNotNull(selfKeyName)
        .groupBy(selfKeyName)
        .as('fk_grouped');

      // Always alias main table as t1 to avoid ambiguous identifiers
      return this.knex(`${dbTableName} as t1`)
        .leftJoin(fkGroupedQuery, `t1.__id`, `fk_grouped.${selfKeyName}`)
        .select({ id: 't1.__id' })
        .where(function () {
          this.whereNull(`fk_grouped.${selfKeyName}`)
            .whereRaw(`"t1"."${linkDbFieldName}" IS NOT NULL`)
            .orWhere(function () {
              // Compare aggregated FK ids with ids from JSON array in link column
              this.whereRaw(`"t1"."${linkDbFieldName}" IS NOT NULL`).andWhereRaw(
                `"fk_grouped".fk_ids != (
                  SELECT string_agg(id, ',' ORDER BY id)
                  FROM (
                      SELECT (link->>'id')::text as id
                      FROM jsonb_array_elements(("t1"."${linkDbFieldName}")::jsonb) as link
                  ) t
                )`
              );
            });
        })
        .toQuery();
    }

    // Single-value relationships where FK is in the same table as the link field (ManyOne/OneOne on main table)
    if (fkHostTableName === dbTableName) {
      return this.knex(`${dbTableName} as t1`)
        .select({ id: 't1.__id' })
        .where(function () {
          this.whereRaw(`"t1"."${foreignKeyName}" IS NULL`)
            .whereRaw(`"t1"."${linkDbFieldName}" IS NOT NULL`)
            .orWhere(function () {
              this.whereRaw(`"t1"."${linkDbFieldName}" IS NOT NULL`).andWhereRaw(
                `("t1"."${linkDbFieldName}"->>'id')::text != "t1"."${foreignKeyName}"::text`
              );
            });
        })
        .toQuery();
    }

    // Single-value relationships where FK is stored in another host table (e.g., OneOne with FK on the other side)
    return this.knex(`${dbTableName} as t1`)
      .select({ id: 't1.__id' })
      .leftJoin(`${fkHostTableName} as t2`, 't2.' + selfKeyName, 't1.__id')
      .where(function () {
        this.whereRaw(`"t2"."${foreignKeyName}" IS NULL`)
          .whereRaw(`"t1"."${linkDbFieldName}" IS NOT NULL`)
          .orWhere(function () {
            this.whereRaw(`"t1"."${linkDbFieldName}" IS NOT NULL`).andWhereRaw(
              `("t1"."${linkDbFieldName}"->>'id')::text != "t2"."${foreignKeyName}"::text`
            );
          });
      })
      .toQuery();
  }

  fixLinks({
    recordIds,
    dbTableName,
    foreignDbTableName,
    fkHostTableName,
    lookupDbFieldName,
    selfKeyName,
    foreignKeyName,
    linkDbFieldName,
    isMultiValue,
  }: {
    recordIds: string[];
    dbTableName: string;
    foreignDbTableName: string;
    fkHostTableName: string;
    lookupDbFieldName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string {
    if (isMultiValue) {
      return this.knex(dbTableName)
        .update({
          [linkDbFieldName]: this.knex
            .select(
              this.knex.raw("jsonb_agg(jsonb_build_object('id', ??, 'title', ??) ORDER BY ??)", [
                `fk.${foreignKeyName}`,
                `ft.${lookupDbFieldName}`,
                `fk.${foreignKeyName}`,
              ])
            )
            .from(`${fkHostTableName} as fk`)
            .join(`${foreignDbTableName} as ft`, `ft.__id`, `fk.${foreignKeyName}`)
            .where('fk.' + selfKeyName, `${dbTableName}.__id`),
        })
        .whereIn('__id', recordIds)
        .toQuery();
    }

    if (fkHostTableName === dbTableName) {
      // Handle self-referential single-value links
      return this.knex(dbTableName)
        .update({
          [linkDbFieldName]: this.knex.raw(
            `
            CASE
              WHEN ?? IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', ??,
                'title', (SELECT ?? FROM ?? WHERE __id = ??)
              )
            END
          `,
            [foreignKeyName, foreignKeyName, lookupDbFieldName, foreignDbTableName, foreignKeyName]
          ),
        })
        .whereIn('__id', recordIds)
        .toQuery();
    }

    // Handle cross-table single-value links
    return this.knex(dbTableName)
      .update({
        [linkDbFieldName]: this.knex
          .select(
            this.knex.raw(
              `CASE
              WHEN t2.?? IS NULL THEN NULL
              ELSE jsonb_build_object('id', t2.??, 'title', t2.??)
            END`,
              [foreignKeyName, foreignKeyName, lookupDbFieldName]
            )
          )
          .from(`${fkHostTableName} as t2`)
          .where(`t2.${foreignKeyName}`, `${dbTableName}.__id`)
          .limit(1),
      })
      .whereIn('__id', recordIds)
      .toQuery();
  }

  /**
   * Deprecated: Do NOT use in new code.
   * Link fields typically do not persist a display JSON column in Postgres;
   * their values are computed from junction tables or fk columns. This method
   * exists only for legacy tests that used to mutate a JSON display column to
   * create inconsistencies. Prefer changing junction/fk data directly.
   *
   * @deprecated Use junction/fk mutations instead of updating a JSON column.
   */
  updateJsonField({
    recordIds,
    dbTableName,
    field,
    value,
    arrayIndex,
  }: {
    recordIds: string[];
    dbTableName: string;
    field: string;
    value: string | number | boolean | null;
    arrayIndex?: number;
  }) {
    return this.knex(dbTableName)
      .whereIn('__id', recordIds)
      .update({
        [field]: this.knex.raw(`jsonb_set(
          "${field}",
          '${arrayIndex != null ? `{${arrayIndex},id}` : '{id}'}',
          '${JSON.stringify(value)}'
        )`),
      });
  }
}
