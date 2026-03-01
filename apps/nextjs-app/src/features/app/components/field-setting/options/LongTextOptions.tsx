import type { ILongTextFieldOptions, ILongTextShowAs } from '@teable/core';
import { Textarea } from '@teable/ui-lib/shadcn';
import { DefaultValue } from '../DefaultValue';
import { LongTextShowAs } from '../show-as/LongTextShowAs';

export const LongTextOptions = (props: {
  options: Partial<ILongTextFieldOptions> | undefined;
  onChange?: (options: Partial<ILongTextFieldOptions>) => void;
  isLookup?: boolean;
}) => {
  const { isLookup, options, onChange } = props;

  const onDefaultValueChange = (defaultValue: string | undefined) => {
    onChange?.({
      ...options,
      defaultValue: defaultValue ?? null,
    });
  };

  const onShowAsChange = (showAs?: ILongTextShowAs) => {
    onChange?.({
      ...options,
      showAs,
    });
  };

  return (
    <div className="form-control space-y-4 border-t pt-4">
      {!isLookup && (
        <DefaultValue onReset={() => onDefaultValueChange(undefined)}>
          <Textarea
            className="w-full"
            value={options?.defaultValue || ''}
            onChange={(e) => onDefaultValueChange(e.target.value)}
            rows={3}
          />
        </DefaultValue>
      )}
      <LongTextShowAs showAs={options?.showAs} onChange={onShowAsChange} />
    </div>
  );
};
