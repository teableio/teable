import type { FieldOperator } from '@/features/app/components/field-setting/type';

export interface ISetting {
  operator: FieldOperator;
  fieldId?: string;
}

export interface IHeaderMenu {
  fieldId: string;
  pos: {
    x: number;
    y: number;
  };
}

export interface IEditorCtx {
  pos: {
    x: number;
    y: number;
  };
  cell: {
    width: number;
    height: number;
  };
}
