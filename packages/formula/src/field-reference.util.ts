import { CharStreams, Token } from 'antlr4ts';

import type { Field_reference_curlyContext, FieldReferenceCurlyContext } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';

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

/** Read dependencies without entering the recursive parser; strings and comments stay opaque. */
export function* iterateFormulaSourceReferences(expression: string): Generator<string> {
  const lexer = new FormulaLexer(CharStreams.fromString(expression));
  lexer.removeErrorListeners();
  for (let token = lexer.nextToken(); token.type !== Token.EOF; token = lexer.nextToken()) {
    if (token.type === FormulaLexer.IDENTIFIER_VARIABLE) {
      const id = (token.text ?? '').slice(1, -1).trim();
      if (id) yield id;
    }
  }
}
