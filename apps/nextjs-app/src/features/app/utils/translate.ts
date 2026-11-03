export type ITranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Type firewall for i18next's `t`. Passing the real TFunction straight into an
 * ITranslate parameter makes tsc resolve its enormous overload set against the
 * plain signature, which either rejects a namespaced `t` or blows the instantiation
 * depth. Routing through `unknown` skips that resolution entirely.
 */
export const asTranslate = (t: unknown): ITranslate => t as ITranslate;
