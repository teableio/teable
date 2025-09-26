import type { ISingleLineTextFieldOptions, ISingleLineTextShowAs } from '@teable/core';
import { Input } from '@teable/ui-lib/shadcn';
import { DefaultValue } from '../DefaultValue';
import { SingleTextLineShowAs } from '../show-as/SingleLineTextShowAs';

export const SingleLineTextOptions = (props: {
  options: Partial<ISingleLineTextFieldOptions> | undefined;
  onChange?: (options: Partial<ISingleLineTextFieldOptions>) => void;
  isLookup?: boolean;
}) => {
  const { isLookup, options, onChange } = props;

  const onShowAsChange = (showAs?: ISingleLineTextShowAs) => {
    onChange?.({
      showAs,
    });
  };

  const onDefaultValueChange = (defaultValue: string | undefined) => {
    onChange?.({
      defaultValue,
    });
  };

  return (
    <div className="form-control space-y-4 border-t pt-4">
      {!isLookup && (
        <DefaultValue onReset={() => onDefaultValueChange(undefined)}>
          <Input
            type="text"
            value={options?.defaultValue || ''}
            onChange={(e) => onDefaultValueChange(e.target.value)}
          />
        </DefaultValue>
      )}
      <SingleTextLineShowAs showAs={options?.showAs as never} onChange={onShowAsChange} />
    </div>
  );
};
