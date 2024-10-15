import { FieldType } from '@teable/core';
import type { IWorkbookData } from '@univerjs/core';
import { LocaleType } from '@univerjs/core';

export const DefaultSheetId = 'sheet1';
const DefaultWorkBookName = 'workbook1';

export const UnSupportFieldType = [FieldType.User, FieldType.Attachment];

export const DefaultWorkBookData: IWorkbookData = {
  id: DefaultSheetId,
  sheetOrder: [DefaultSheetId],
  name: DefaultWorkBookName,
  appVersion: '3.0.0-alpha',
  locale: LocaleType.ZH_CN,
  styles: {},
  sheets: {
    sheet1: {
      id: DefaultSheetId,
      cellData: {
        '0': {
          '0': {
            v: '',
          },
        },
      },
      name: DefaultSheetId,
      hidden: 0,
      rowCount: 10,
      columnCount: 6,
      zoomRatio: 1,
      scrollTop: 200,
      scrollLeft: 100,
      defaultColumnWidth: 93,
      defaultRowHeight: 27,
      showGridlines: 1,
      rowHeader: {
        width: 46,
        hidden: 0,
      },
      columnHeader: {
        height: 20,
        hidden: 0,
      },
      rightToLeft: 0,
      tabColor: '',
      freeze: {
        xSplit: 0,
        ySplit: 0,
        startRow: -1,
        startColumn: -1,
      },
      mergeData: [],
      rowData: {},
      columnData: {},
    },
  },
  resources: [
    {
      name: 'SHEET_RANGE_PROTECTION_PLUGIN',
      data: '{}',
    },
    {
      name: 'SHEET_WORKSHEET_PROTECTION_PLUGIN',
      data: '{}',
    },
    {
      name: 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN',
      data: '{}',
    },
    {
      name: 'SHEET_DEFINED_NAME_PLUGIN',
      data: '{}',
    },
    {
      name: 'SHEET_AuthzIoMockService_PLUGIN',
      data: '{}',
    },
  ],
};
