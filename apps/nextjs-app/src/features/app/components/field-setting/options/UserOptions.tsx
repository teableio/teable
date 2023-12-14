import type { CellValueType, IUserFieldOptions } from '@teable-group/core';
import { Label, Switch } from '@teable-group/ui-lib';

export const UserOptions = (props: {
  options: Partial<IUserFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  onChange?: (options: Partial<IUserFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, onChange } = props;
  const { isMultiple, shouldNotify } = options;

  const onIsMultipleChange = (checked: boolean) => {
    onChange?.({
      isMultiple: checked,
    });
  };

  const onShouldNotifyChange = (checked: boolean) => {
    onChange?.({
      shouldNotify: checked,
    });
  };

  return (
    <div className="form-control space-y-2">
      {!isLookup && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="field-options-is-multiple"
              checked={Boolean(isMultiple)}
              onCheckedChange={onIsMultipleChange}
            />
            <Label htmlFor="field-options-is-multiple" className="font-normal">
              Allow adding multiple users
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="field-options-should-notify"
              checked={Boolean(shouldNotify)}
              onCheckedChange={onShouldNotifyChange}
            />
            <Label htmlFor="field-options-should-notify" className="font-normal">
              Notify members once they're selected
            </Label>
          </div>
        </div>
      )}
    </div>
  );
};
