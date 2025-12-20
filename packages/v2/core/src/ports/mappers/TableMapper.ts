import type { Result } from 'neverthrow';

import type { Table } from '../../domain/table/Table';

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

export type ITableFieldPersistenceDTO =
  | { id: string; name: string; type: 'singleLineText'; options?: ISingleLineTextFieldOptionsDTO }
  | { id: string; name: string; type: 'longText'; options?: ILongTextFieldOptionsDTO }
  | { id: string; name: string; type: 'number'; options?: INumberFieldOptionsDTO }
  | { id: string; name: string; type: 'rating'; options?: IRatingFieldOptionsDTO }
  | { id: string; name: string; type: 'singleSelect'; options: ISelectFieldOptionsDTO }
  | { id: string; name: string; type: 'multipleSelect'; options: ISelectFieldOptionsDTO }
  | { id: string; name: string; type: 'checkbox'; options?: ICheckboxFieldOptionsDTO }
  | { id: string; name: string; type: 'attachment'; options?: Record<string, never> }
  | { id: string; name: string; type: 'date'; options?: IDateFieldOptionsDTO }
  | { id: string; name: string; type: 'user'; options?: IUserFieldOptionsDTO }
  | { id: string; name: string; type: 'button'; options?: IButtonFieldOptionsDTO };

export type ITableViewPersistenceDTO =
  | { id: string; name: string; type: 'grid' }
  | { id: string; name: string; type: 'calendar' }
  | { id: string; name: string; type: 'kanban' }
  | { id: string; name: string; type: 'form' }
  | { id: string; name: string; type: 'gallery' }
  | { id: string; name: string; type: 'plugin' };

export type ITablePersistenceDTO = {
  id: string;
  baseId: string;
  name: string;
  primaryFieldId: string;
  fields: ReadonlyArray<ITableFieldPersistenceDTO>;
  views: ReadonlyArray<ITableViewPersistenceDTO>;
};

export interface ITableMapper {
  toDTO(table: Table): Result<ITablePersistenceDTO, string>;
  toDomain(dto: ITablePersistenceDTO): Result<Table, string>;
}
