import type { ISingleLineTextFieldOptions, ISingleLineTextShowAs } from '@teable-group/core';
import { SingleTextLineShowAs } from '../show-as/SingleLineTextShowAs';

export const SingleLineTextOptions = (props: {
  options: Partial<ISingleLineTextFieldOptions> | undefined;
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
