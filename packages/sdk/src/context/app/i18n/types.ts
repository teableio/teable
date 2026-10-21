import type { defaultLocale } from './const';

type SdkI18nNamespaces = typeof defaultLocale;

type NestedKeys<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? NestedKeys<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`;
    }[keyof T & string]
  : never;

type ValueOf<T> = T[keyof T];
type NestedValues<T> = T extends object
  ? ValueOf<{
      [K in keyof T]: T[K] extends object ? NestedValues<T[K]> : T[K];
    }>
  : never;

type TKey = NestedKeys<SdkI18nNamespaces>;

type TValue = NestedValues<SdkI18nNamespaces>;

type PluralBaseKey<K> = K extends `${infer Base}_other` ? Base : never;

type TPluralKey = PluralBaseKey<TKey>;

type ILocale = SdkI18nNamespaces;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

type ILocalePartial = DeepPartial<ILocale>;

type ILocaleFunction = (key: TKey, options?: Record<string, unknown>) => TValue;

type ILocalePluralFunction = (
  key: TPluralKey,
  count: number,
  options?: Record<string, unknown>
) => string;

export type {
  ILocale,
  ILocalePartial,
  TKey,
  TPluralKey,
  TValue,
  ILocaleFunction,
  ILocalePluralFunction,
};
