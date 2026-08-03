import { isEmpty } from 'lodash';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const filterByKeys = <T extends Record<any, any>>(
  fields: T[],
  keys?: Partial<Record<keyof T, T[keyof T][]>>
): T[] => {
  if (isEmpty(keys)) {
    return fields;
  }

  return fields.filter((field) => {
    return Object.entries(keys).every(([key, values]) => {
      return values?.includes(field[key]);
    });
  });
};
