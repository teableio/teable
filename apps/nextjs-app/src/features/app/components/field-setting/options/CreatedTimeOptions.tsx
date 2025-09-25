import type {
  IDatetimeFormatting,
  ICreatedTimeFieldOptionsRo,
  ILastModifiedTimeFieldOptionsRo,
} from '@teable/core';
import { DatetimeFormatting } from '../formatting/DatetimeFormatting';

export const CreatedTimeOptions = (props: {
  options: Partial<ICreatedTimeFieldOptionsRo | ILastModifiedTimeFieldOptionsRo> | undefined;
  onChange?: (
    options: Partial<ICreatedTimeFieldOptionsRo | ILastModifiedTimeFieldOptionsRo>
  ) => void;
}) => {
  const { options = {}, onChange } = props;

  const onFormattingChange = (formatting: IDatetimeFormatting) => {
    onChange?.({
      formatting,
    });
  };

  return (
    <div className="form-control w-full space-y-4">
      <DatetimeFormatting onChange={onFormattingChange} formatting={options.formatting} />
    </div>
  );
};
