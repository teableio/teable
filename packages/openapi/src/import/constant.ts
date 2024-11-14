import { SUPPORTEDTYPE } from './types';

export const importTypeMap = {
  [SUPPORTEDTYPE.CSV]: {
    accept:
      'text/csv,text/tab-separated-values,application/csv,application/vnd.ms-excel,application/octet-stream',
    exampleUrl: 'https://www.example.com/file.csv',
    exceedSize: null,
  },
  [SUPPORTEDTYPE.EXCEL]: {
    accept:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel',
    exampleUrl: 'https://www.example.com/file.xlsx',
    exceedSize: 5,
  },
};
