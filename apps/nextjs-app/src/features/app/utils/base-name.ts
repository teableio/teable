import type { TFunction } from 'next-i18next';

/**
 * A base whose `name` is null has never been named by anyone. The column is nullable so the
 * AI may pick a name from the first conversation; until then every surface shows this
 * localized placeholder instead of an empty string.
 */
export const getBaseDisplayName = (
  name: string | null | undefined,
  t: TFunction | ((key: 'common:untitledBase') => string)
): string => name?.trim() || t('common:untitledBase');
