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
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12,application/wps-office.xlsx,application/wps-office.xls',
    exampleUrl: 'https://www.example.com/file.xlsx',
    exceedSize: 5,
  },
};
