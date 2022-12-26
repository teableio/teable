import type { IField } from '../field';
import type { IRecord } from '../record/interface';
import type { IView } from '../view/interface';

export interface ITable {
  id: string;
  name: string;
  description: string;
  fieldMap: {
    [fieldId: string]: IField;
  };
  viewList: string[];
  viewMap: {
    [viewId: string]: IView;
  };
  recordMap: {
    [recordId: string]: IRecord;
  };
}
