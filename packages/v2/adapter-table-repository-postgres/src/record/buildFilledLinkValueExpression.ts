import type { DomainError, LinkField, Table } from '@teable/v2-core';
import { domainError, ok } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

export const MAX_FILLED_LINK_VALUE_ITEMS = 20_000;

export const buildFilledLinkValueExpression = (params: {
  linkField: LinkField;
  linkItems: ReadonlyArray<{ id: string; title?: string }>;
  fillLinkTitleForeignTables?: ReadonlyMap<string, Table>;
}): Result<RawBuilder<unknown> | null, DomainError> => {
  const { linkField, linkItems, fillLinkTitleForeignTables } = params;

  return safeTry<RawBuilder<unknown> | null, DomainError>(function* () {
    const foreignTableIdStr = linkField.foreignTableId().toString();
    const foreignTable = fillLinkTitleForeignTables?.get(foreignTableIdStr);
    if (!foreignTable) return ok(null);

    if (linkField.isMultipleValue() && linkItems.length > MAX_FILLED_LINK_VALUE_ITEMS) {
      return err(
        domainError.validation({
          code: 'validation.field.link_title_fill_limit_exceeded',
          message: `Link title fill supports at most ${MAX_FILLED_LINK_VALUE_ITEMS} items per write`,
        })
      );
    }

    const foreignDbTableName = yield* foreignTable
      .dbTableName()
      .andThen((dbTableName) => dbTableName.value());
    const lookupField = yield* foreignTable.getField((field) =>
      field.id().equals(linkField.lookupFieldId())
    );
    const lookupDbFieldName = yield* lookupField
      .dbFieldName()
      .andThen((dbFieldName) => dbFieldName.value());

    if (linkField.isMultipleValue()) {
      const valuesSql = sql.join(
        linkItems.map((item, index) => sql`(${item.id}, ${item.title ?? null}, ${index})`),
        sql`, `
      );
      return ok(sql`(
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', v.id,
              'title', COALESCE(v.title, ${sql.ref(`ft.${lookupDbFieldName}`)}::text)
            )
            ORDER BY v.ord
          ),
          '[]'::jsonb
        )
        FROM (VALUES ${valuesSql}) AS v(id, title, ord)
        LEFT JOIN ${sql.table(foreignDbTableName)} ft ON ft.__id = v.id
      )`);
    }

    const singleItem = linkItems[0];
    if (!singleItem) {
      return ok(null);
    }

    return ok(sql`(
      SELECT jsonb_build_object(
        'id', v.id,
        'title', COALESCE(v.title, ${sql.ref(`ft.${lookupDbFieldName}`)}::text)
      )
      FROM (VALUES (${singleItem.id}, ${singleItem.title ?? null})) AS v(id, title)
      LEFT JOIN ${sql.table(foreignDbTableName)} ft ON ft.__id = v.id
    )`);
  });
};
