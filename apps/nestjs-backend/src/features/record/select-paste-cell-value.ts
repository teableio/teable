/**
 * Select-to-select paste values.
 *
 * Structured copies arrive as arrays and must stay arrays, including choice
 * names that contain commas. Text-only clipboard HTML arrives as one string;
 * that string still has to be CSV-parsed downstream.
 */
export const selectPasteCellValue = (cellValue: unknown, targetIsMultiple: boolean): unknown => {
  if (Array.isArray(cellValue)) {
    const values = cellValue.flat();
    return targetIsMultiple ? values : values[0];
  }
  return cellValue;
};
