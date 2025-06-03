/**
 * sort should always use a more precise format for date, ignoring the date formatting preset
 * @returns string
 */
export const getPostgresDateTimeFormatString = () => {
  return 'YYYY-MM-DD HH24:MI:SS.US';
};

export const getSqliteDateTimeFormatString = () => {
  return '%Y-%m-%d-%H-%M-%S-%f';
};
