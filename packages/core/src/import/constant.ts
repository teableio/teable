import { SUPPORTEDTYPE } from './types';

export const importTypeMap = {
  [SUPPORTEDTYPE.CSV]: {
    accept: 'text/csv',
    exampleUrl: 'https://www.example.com/file.csv',
    acceptHeaders: ['text/csv', 'text/plain'],
    exceedSize: null,
  },
  [SUPPORTEDTYPE.EXCEL]: {
    accept:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
    exampleUrl: 'https://www.example.com/file.xlsx',
    acceptHeaders: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    exceedSize: 5,
  },
};
