import { FieldType } from '@teable/core';
import type { IWorkbookData } from '@univerjs/core';
import { BooleanNumber, LocaleType } from '@univerjs/core';

export const DefaultSheetId = 'sheet1';
const DefaultWorkBookName = 'workbook1';

export const UnSupportFieldType = [FieldType.User, FieldType.Attachment];

export const DefaultWorkBookData: IWorkbookData = {
  id: DefaultWorkBookName,
  name: DefaultWorkBookName,
  appVersion: '3.0.0-alpha',
  locale: LocaleType.ZH_CN,
  styles: {},
  sheetOrder: [DefaultSheetId],
  sheets: {
    [DefaultSheetId]: {
      // type: SheetTypes.GRID,
      id: DefaultSheetId,
      cellData: {
        0: {
          0: {
            v: '',
          },
        },
      },
      name: DefaultSheetId,
      // tabColor: 'red',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line
      hidden: BooleanNumber.FALSE,
      rowCount: 10,
      columnCount: 6,
      zoomRatio: 1,
      scrollTop: 200,
      scrollLeft: 100,
      defaultColumnWidth: 93,
      defaultRowHeight: 27,
      // status: 1,
      showGridlines: 1,
      // hideRow: [],
      // hideColumn: [],
      rowHeader: {
        width: 46,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore-next-line
        hidden: BooleanNumber.FALSE,
      },
      columnHeader: {
        height: 20,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore-next-line
        hidden: BooleanNumber.FALSE,
      },
      // selections: ['A2'],
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line
      rightToLeft: BooleanNumber.FALSE,
      // pluginMeta: {},
    },
  },
};
