import type { Field_reference_curlyContext, FieldReferenceCurlyContext } from './parser/Formula';

/**
 * Extracts the identifier inside a curly field reference token, trimming away the surrounding
 * braces and any incidental whitespace. Returns `undefined` when the token is missing or empty.
 */
export function extractFieldReferenceId(
  ctx: FieldReferenceCurlyContext | Field_reference_curlyContext | undefined
): string | undefined {
  if (!ctx) {
    return undefined;
  }

  const identifierToken = 'field_reference_curly' in ctx ? ctx.field_reference_curly() : ctx;
  if (!identifierToken) {
    return undefined;
  }

  const raw = identifierToken.IDENTIFIER_VARIABLE()?.text ?? '';
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized =
    trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1).trim() : trimmed;

  return normalized || undefined;
}

export function getFieldReferenceTokenText(
  ctx: FieldReferenceCurlyContext | Field_reference_curlyContext | undefined
): string | undefined {
  if (!ctx) {
    return undefined;
  }

  const identifierToken = 'field_reference_curly' in ctx ? ctx.field_reference_curly() : ctx;
  return identifierToken?.IDENTIFIER_VARIABLE()?.text ?? undefined;
}
