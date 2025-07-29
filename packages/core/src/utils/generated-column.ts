/**
 * Utility functions for generated column naming
 */

/**
 * Generate the database column name for a generated column
 * @param dbFieldName The original database field name
 * @returns The generated column name with the standard suffix
 */
export function getGeneratedColumnName(dbFieldName: string): string {
  return `${dbFieldName}___generated`;
}

/**
 * Check if a column name is a generated column name
 * @param columnName The column name to check
 * @returns True if the column name follows the generated column naming pattern
 */
export function isGeneratedColumnName(columnName: string): boolean {
  return columnName.endsWith('___generated');
}

/**
 * Extract the original field name from a generated column name
 * @param generatedColumnName The generated column name
 * @returns The original field name without the generated suffix
 */
export function getOriginalFieldNameFromGenerated(generatedColumnName: string): string {
  if (!isGeneratedColumnName(generatedColumnName)) {
    return generatedColumnName;
  }
  return generatedColumnName.replace(/___generated$/, '');
}
