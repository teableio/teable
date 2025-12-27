import type { Result } from 'neverthrow';

import type { Table } from '../../domain/table/Table';
import type { ViewColumnMetaValue } from '../../domain/table/views/ViewColumnMeta';

export type ISingleLineTextFieldOptionsDTO = {
  showAs?: { type: string };
  defaultValue?: string;
};

export type ILongTextFieldOptionsDTO = {
  defaultValue?: string;
};

export type INumberFormattingDTO = {
  type: 'decimal' | 'percent' | 'currency';
  precision: number;
  symbol?: string;
};

export type INumberShowAsDTO =
  | { type: 'bar' | 'ring'; color: string; showValue: boolean; maxValue: number }
  | { type: 'bar' | 'line'; color: string };

export type INumberFieldOptionsDTO = {
  formatting?: INumberFormattingDTO;
  showAs?: INumberShowAsDTO;
  defaultValue?: number;
};

export type IRatingFieldOptionsDTO = {
  icon?: string;
  color?: string;
  max?: number;
};

export type ISelectFieldChoiceDTO = {
  id: string;
  name: string;
  color: string;
};

export type ISelectFieldOptionsDTO = {
  choices: ReadonlyArray<ISelectFieldChoiceDTO>;
  defaultValue?: string | ReadonlyArray<string>;
  preventAutoNewOptions?: boolean;
};

export type ICheckboxFieldOptionsDTO = {
  defaultValue?: boolean;
};

export type IDateFieldOptionsDTO = {
  formatting?: { date: string; time: string; timeZone: string };
  defaultValue?: 'now';
};

export type IUserFieldOptionsDTO = {
  isMultiple?: boolean;
  shouldNotify?: boolean;
  defaultValue?: string | ReadonlyArray<string>;
};

export type IButtonWorkflowDTO = {
  id?: string;
  name?: string;
  isActive?: boolean;
};

export type IButtonFieldOptionsDTO = {
  label?: string;
  color?: string;
  maxCount?: number;
  resetCount?: boolean;
  workflow?: IButtonWorkflowDTO | null;
};

export type IFormulaFieldFormattingDTO =
  | INumberFormattingDTO
  | {
      date: string;
      time: string;
      timeZone: string;
    };

export type IFormulaFieldShowAsDTO =
  | INumberShowAsDTO
  | {
      type: string;
    };

export type IFormulaFieldOptionsDTO = {
  expression: string;
  timeZone?: string;
  formatting?: IFormulaFieldFormattingDTO;
  showAs?: IFormulaFieldShowAsDTO;
};

export type IFormulaFieldMetaDTO = {
  persistedAsGeneratedColumn?: boolean;
};

export type IRollupFieldOptionsDTO = {
  expression: string;
  timeZone?: string;
  formatting?: IFormulaFieldFormattingDTO;
  showAs?: IFormulaFieldShowAsDTO;
};

export type IRollupFieldConfigDTO = {
  linkFieldId: string;
  foreignTableId: string;
  lookupFieldId: string;
};

export type ILinkFieldOptionsDTO = {
  baseId?: string;
  relationship: 'oneOne' | 'manyMany' | 'oneMany' | 'manyOne';
  foreignTableId: string;
  lookupFieldId: string;
  isOneWay?: boolean;
  fkHostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
  symmetricFieldId?: string;
  filterByViewId?: string | null;
  visibleFieldIds?: ReadonlyArray<string> | null;
};

export type ILinkFieldMetaDTO = {
  hasOrderColumn?: boolean;
};

export type ITableFieldBaseDTO = {
  id: string;
  name: string;
  dbFieldName?: string;
  isComputed?: boolean;
};

export type ITableFieldPersistenceDTO =
  | (ITableFieldBaseDTO & {
      type: 'singleLineText';
      options?: ISingleLineTextFieldOptionsDTO;
    })
  | (ITableFieldBaseDTO & { type: 'longText'; options?: ILongTextFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'number'; options?: INumberFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'rating'; options?: IRatingFieldOptionsDTO })
  | (ITableFieldBaseDTO & {
      type: 'formula';
      options: IFormulaFieldOptionsDTO;
      meta?: IFormulaFieldMetaDTO;
      cellValueType?: string;
      isMultipleCellValue?: boolean;
    })
  | (ITableFieldBaseDTO & {
      type: 'rollup';
      options: IRollupFieldOptionsDTO;
      config?: IRollupFieldConfigDTO;
      cellValueType?: string;
      isMultipleCellValue?: boolean;
    })
  | (ITableFieldBaseDTO & { type: 'singleSelect'; options: ISelectFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'multipleSelect'; options: ISelectFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'checkbox'; options?: ICheckboxFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'attachment'; options?: Record<string, never> })
  | (ITableFieldBaseDTO & { type: 'date'; options?: IDateFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'user'; options?: IUserFieldOptionsDTO })
  | (ITableFieldBaseDTO & { type: 'button'; options?: IButtonFieldOptionsDTO })
  | (ITableFieldBaseDTO & {
      type: 'link';
      options: ILinkFieldOptionsDTO;
      meta?: ILinkFieldMetaDTO;
    });

export type ITableViewPersistenceDTOBase = {
  id: string;
  name: string;
  columnMeta: ViewColumnMetaValue;
};

export type ITableViewPersistenceDTO =
  | (ITableViewPersistenceDTOBase & { type: 'grid' })
  | (ITableViewPersistenceDTOBase & { type: 'calendar' })
  | (ITableViewPersistenceDTOBase & { type: 'kanban' })
  | (ITableViewPersistenceDTOBase & { type: 'form' })
  | (ITableViewPersistenceDTOBase & { type: 'gallery' })
  | (ITableViewPersistenceDTOBase & { type: 'plugin' });

export type ITablePersistenceDTO = {
  id: string;
  baseId: string;
  name: string;
  dbTableName?: string;
  primaryFieldId: string;
  fields: ReadonlyArray<ITableFieldPersistenceDTO>;
  views: ReadonlyArray<ITableViewPersistenceDTO>;
};

export interface ITableMapper {
  toDTO(table: Table): Result<ITablePersistenceDTO, string>;
  toDomain(dto: ITablePersistenceDTO): Result<Table, string>;
}
