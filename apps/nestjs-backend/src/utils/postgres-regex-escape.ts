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

  // For like_regex in JSONB path expressions, double escaping is required
  // First escape regex special characters, then escape backslashes in JSON strings
  return input
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special characters
    .replace(/\\/g, '\\\\'); // Escape backslashes for JSON strings
}
