import type { IUserCellValue, ISelectFieldChoice } from '@teable/core';

export interface IStackData {
  id: string;
  data: IUserCellValue | ISelectFieldChoice;
  count: number;
}
