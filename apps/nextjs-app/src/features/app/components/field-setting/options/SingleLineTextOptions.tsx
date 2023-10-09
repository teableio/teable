import type {
  CellValueType,
  ILookupOptionsRo,
  ISingleLineTextFieldOptions,
  ISingleLineTextShowAs,
} from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { SingleTextLineShowAs } from '../show-as/SingleLineTextShowAs';

export const SingleLineTextOptions = (props: {
  options: Partial<ISingleLineTextFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  lookupField?: IFieldInstance;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<ISingleLineTextFieldOptions>) => void;
}) => {
  const { options, onChange } = props;

  const onShowAsChange = (showAs?: ISingleLineTextShowAs) => {
    onChange?.({
      showAs,
    });
  };

  return (
    <div className="form-control space-y-2">
      <SingleTextLineShowAs showAs={options?.showAs as never} onChange={onShowAsChange} />
    </div>
  );
};
