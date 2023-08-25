import type {
  CellValueType,
  ILookupOptionsRo,
  INumberShowAs,
  INumberFormatting,
  INumberFieldOptions,
} from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { NumberFormatting } from '../formatting/NumberFormatting';
import { useIsMultipleCellValue } from '../hooks';
import { MultiNumberShowAs } from '../show-as/MultiNumberShowAs';
import { SingleNumberShowAs } from '../show-as/SingleNumberShowAs';

export const NumberOptions = (props: {
  options: Partial<INumberFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  lookupField?: IFieldInstance;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<INumberFieldOptions>) => void;
}) => {
  const { options, isLookup, lookupField, lookupOptions, onChange } = props;

  const isMultipleCellValue = useIsMultipleCellValue(isLookup, lookupField, lookupOptions);

  const ShowAsComponent = isMultipleCellValue ? MultiNumberShowAs : SingleNumberShowAs;

  const onFormattingChange = (formatting: INumberFormatting) => {
    onChange?.({
      formatting,
    });
  };

  const onShowAsChange = (showAs?: INumberShowAs) => {
    onChange?.({
      showAs,
    });
  };

  return (
    <div className="form-control space-y-2">
      <NumberFormatting formatting={options?.formatting} onChange={onFormattingChange} />
      <ShowAsComponent showAs={options?.showAs as never} onChange={onShowAsChange} />
    </div>
  );
};
