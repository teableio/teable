/**
 * Express 5 (path-to-regexp v8) delivers a named wildcard route param such as
 * `@Get('/read/*path')` as an array of path segments instead of the joined
 * string Express 4 produced for `:path(*)`. Normalise it back to a string so the
 * handlers keep working with plain paths.
 */
export function joinWildcardParam(value: string | string[] | undefined): string {
  if (value === undefined) {
    return '';
  }
  return Array.isArray(value) ? value.join('/') : value;
}
