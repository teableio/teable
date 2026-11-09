import { FieldType, domainError, type DomainError, type Field } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

export type FieldOrderByCollation = 'zh-pinyin';
export type PinyinOrderByKind = 'text' | 'link';

const unsupportedPinyinCollation = (field: Field, reason?: string): DomainError =>
  domainError.validation({
    code: 'sort.unsupported_collation',
    message: `Sort field ${field.id().toString()} does not support zh-pinyin collation${reason ? `: ${reason}` : ''}`,
    details: {
      fieldId: field.id().toString(),
      fieldType: field.type().toString(),
      collation: 'zh-pinyin',
      ...(reason ? { reason } : {}),
    },
  });

/**
 * Resolve the deliberately narrow field support contract for explicit pinyin sorting.
 * Keeping this check shared prevents stored/computed builders from silently falling
 * back to their default ordering for a field they cannot collate correctly.
 */
export const resolvePinyinOrderByKind = (
  field: Field,
  collation: FieldOrderByCollation | undefined
): Result<PinyinOrderByKind | undefined, DomainError> => {
  if (collation === undefined) return ok(undefined);

  const type = field.type();
  if (type.equals(FieldType.singleLineText()) || type.equals(FieldType.longText())) {
    return field.computed().toBoolean()
      ? err(unsupportedPinyinCollation(field, 'computed text fields are not supported'))
      : ok('text');
  }
  if (!type.equals(FieldType.link())) {
    return err(unsupportedPinyinCollation(field));
  }

  return field.isMultipleCellValue().andThen((multiplicity) =>
    multiplicity.isMultiple()
      ? err(unsupportedPinyinCollation(field, 'multiple-value links are not supported'))
      : ok('link' as const)
  );
};

/** PostgreSQL fails explicitly if the database has no ICU `zh-x-icu` collation. */
export const applyPinyinCollation = (
  expression: RawBuilder<unknown>
): RawBuilder<unknown> => sql`(${expression}) COLLATE ${sql.id('zh-x-icu')}`;
