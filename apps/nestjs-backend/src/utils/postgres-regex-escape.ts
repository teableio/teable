/**
 * PostgreSQL regex escape utility
 *
 * PostgreSQL uses POSIX regular expressions, special characters that need to be escaped include:
 * . ^ $ * + ? { } [ ] \ | ( )
 */

/**
 * Escape special characters in PostgreSQL regular expressions
 * @param input String to be escaped
 * @returns Escaped string
 */
export function escapePostgresRegex(input: string): string {
  if (typeof input !== 'string') {
    return String(input);
  }

  // Special characters that need to be escaped in PostgreSQL POSIX regular expressions
  // Reference: https://www.postgresql.org/docs/current/functions-matching.html
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape regular expressions in PostgreSQL JSONB path expressions
 * Used for like_regex operator
 * @param input String to be escaped
 * @returns Escaped string
 */
export function escapeJsonbRegex(input: string): string {
  if (typeof input !== 'string') {
    return String(input);
  }

  // For like_regex in JSONB path expressions, escape regex special characters
  // Avoid double-escaping by handling all characters in one pass
  return input.replace(/[.*+?^${}()|[\]\\"]/g, (match) => {
    if (match === '\\') {
      // Backslashes need to be double-escaped for JSONB path expressions
      return '\\\\\\\\';
    }
    if (match === '"') {
      // Double quotes must be escaped to stay within jsonpath string literals
      return '\\"';
    }
    // Other regex special characters need to be escaped with double backslashes
    return '\\\\' + match;
  });
}

/**
 * Escape a value so it is safe inside a JSONB path *string literal* (the part
 * between the double quotes in `$[*] ? (@ == "...")`).
 *
 * This is the single-level escaping used when the whole jsonpath is passed to
 * Postgres as a *bound parameter* (the driver handles the surrounding SQL
 * string literal). Only backslash and the closing double quote need escaping;
 * everything else — including single quotes — is inert because it never touches
 * the SQL string.
 */
export function escapeJsonPathStringLiteral(input: string): string {
  return String(input).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Escape a value for use as a `like_regex` pattern inside a JSONB path string
 * literal, for the bound-parameter case: first neutralize regex metacharacters
 * (so the value matches literally), then escape for the jsonpath string.
 */
export function escapeJsonPathRegexLiteral(input: string): string {
  return escapeJsonPathStringLiteral(escapePostgresRegex(String(input)));
}
