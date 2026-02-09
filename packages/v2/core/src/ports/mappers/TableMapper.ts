import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { ViewColumnMetaValue } from '../../domain/table/views/ViewColumnMeta';
import type { ViewQueryDefaultsDTO } from '../../domain/table/views/ViewQueryDefaults';

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

export type IDateTimeFormattingDTO = {
  date: string;
  time: string;
  timeZone: string;
};

export type IDateFieldOptionsDTO = {
  formatting?: IDateTimeFormattingDTO;
  defaultValue?: 'now';
};

export type ICreatedTimeFieldOptionsDTO = {
  expression?: string;
  formatting?: IDateTimeFormattingDTO;
};

export type ILastModifiedTimeFieldOptionsDTO = {
  expression?: string;
  formatting?: IDateTimeFormattingDTO;
  trackedFieldIds?: ReadonlyArray<string>;
};

export type ICreatedByFieldOptionsDTO = Record<string, never>;

export type ILastModifiedByFieldOptionsDTO = {
  trackedFieldIds?: ReadonlyArray<string>;
};

export type IAutoNumberFieldOptionsDTO = {
  expression?: string;
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

export type IGeneratedColumnMetaDTO = {
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

export type IFilterItemDTO = {
  fieldId: string;
  operator: string;
  value: unknown;
};

export type IFieldConditionDTO = {
  filter: {
    conjunction: 'and' | 'or';
    filterSet: ReadonlyArray<
      IFilterItemDTO | { conjunction: 'and' | 'or'; filterSet: ReadonlyArray<IFilterItemDTO> }
    >;
  } | null;
  sort?: {
    fieldId: string;
    order: 'asc' | 'desc';
  };
  limit?: number;
};

export type IConditionalRollupFieldConfigDTO = {
  foreignTableId: string;
  lookupFieldId: string;
  condition: IFieldConditionDTO;
};

export type IConditionalRollupFieldOptionsDTO = {
  expression: string;
  timeZone?: string;
  formatting?: IFormulaFieldFormattingDTO;
  showAs?: IFormulaFieldShowAsDTO;
};

export type IConditionalLookupOptionsDTO = {
  foreignTableId: string;
  lookupFieldId: string;
  condition: IFieldConditionDTO;
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

export type ILookupOptionsDTO = {
  linkFieldId: string;
  lookupFieldId: string;
  foreignTableId: string;
  filter?: IFieldConditionDTO['filter'];
  sort?: IFieldConditionDTO['sort'];
  limit?: number;
};

export type ITableFieldBaseDTO = {
  id: string;
  name: string;
  dbFieldName?: string;
  dbFieldType?: string;
  isComputed?: boolean;
  hasError?: boolean;
  notNull?: boolean;
  unique?: boolean;
  /**
   * Whether this field can have multiple cell values.
   * For lookup fields, this is determined by the link relationship type.
   */
  isMultipleCellValue?: boolean;
  /**
   * When true, this field is a lookup field.
   * The actual type indicates the inner field type.
   * This follows v1 persistence format for compatibility.
   */
  isLookup?: boolean;
  /**
   * When true, this lookup uses conditional filtering.
   * Only applicable when isLookup is true.
   */
  isConditionalLookup?: boolean;
  lookupOptions?: ILookupOptionsDTO;
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
  | (ITableFieldBaseDTO & {
      type: 'createdTime';
      options?: ICreatedTimeFieldOptionsDTO;
      meta?: IGeneratedColumnMetaDTO;
    })
  | (ITableFieldBaseDTO & {
      type: 'lastModifiedTime';
      options?: ILastModifiedTimeFieldOptionsDTO;
      meta?: IGeneratedColumnMetaDTO;
    })
  | (ITableFieldBaseDTO & { type: 'user'; options?: IUserFieldOptionsDTO })
  | (ITableFieldBaseDTO & {
      type: 'createdBy';
      options?: ICreatedByFieldOptionsDTO;
      meta?: IGeneratedColumnMetaDTO;
    })
  | (ITableFieldBaseDTO & {
      type: 'lastModifiedBy';
      options?: ILastModifiedByFieldOptionsDTO;
      meta?: IGeneratedColumnMetaDTO;
    })
  | (ITableFieldBaseDTO & {
      type: 'autoNumber';
      options?: IAutoNumberFieldOptionsDTO;
      meta?: IGeneratedColumnMetaDTO;
    })
  | (ITableFieldBaseDTO & { type: 'button'; options?: IButtonFieldOptionsDTO })
  | (ITableFieldBaseDTO & {
      type: 'link';
      options: ILinkFieldOptionsDTO;
      meta?: ILinkFieldMetaDTO;
    })
  | (ITableFieldBaseDTO & {
      type: 'conditionalRollup';
      options: IConditionalRollupFieldOptionsDTO;
      config: IConditionalRollupFieldConfigDTO;
      cellValueType?: string;
      isMultipleCellValue?: boolean;
    })
  | (ITableFieldBaseDTO & {
      type: 'conditionalLookup';
      options: IConditionalLookupOptionsDTO;
      innerType?: string;
      innerOptions?: unknown;
    });

export type ITableViewPersistenceDTOBase = {
  id: string;
  name: string;
  columnMeta: ViewColumnMetaValue;
  query?: ViewQueryDefaultsDTO;
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
  toDTO(table: Table): Result<ITablePersistenceDTO, DomainError>;
  toDomain(dto: ITablePersistenceDTO): Result<Table, DomainError>;
}
