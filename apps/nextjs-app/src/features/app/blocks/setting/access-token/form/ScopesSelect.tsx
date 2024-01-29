import type { ActionPrefix, AllActions } from '@teable-group/core';
import { usePermissionActionsStatic } from '@teable-group/sdk/hooks';
import { Checkbox, Label } from '@teable-group/ui-lib/shadcn';
import { useState } from 'react';

interface IScopesSelectProps {
  initValue?: AllActions[];
  onChange: (value: string[]) => void;
}

export const ScopesSelect = (props: IScopesSelectProps) => {
  const { onChange, initValue } = props;
  const [value, setValue] = useState<Record<AllActions, boolean>>(() => {
    if (initValue) {
      return initValue.reduce(
        (acc, cur) => {
          acc[cur] = true;
          return acc;
        },
        {} as Record<AllActions, boolean>
      );
    }
    return {} as Record<AllActions, boolean>;
  });
  const actions = usePermissionActionsStatic();

  const onCheckBoxChange = (status: boolean, val: AllActions) => {
    const actionMap = { ...value };
    actionMap[val] = status;
    setValue(actionMap);
    const actions = Object.keys(actionMap).filter((key) => actionMap[key as AllActions]);
    onChange?.(actions);
  };

  return (
    <div className="space-y-3">
      {Object.keys(actions).map((actionType) => {
        const typeActions = actions[actionType as ActionPrefix];
        return (
          <div key={actionType} className="space-y-1">
            <Label>{actionType}</Label>
            <div className="flex gap-3">
              {typeActions.map(({ action, description }) => (
                <div className="flex items-center gap-1 text-sm" key={action}>
                  <Checkbox
                    value={action}
                    checked={value[action]}
                    onCheckedChange={(val: boolean) => {
                      onCheckBoxChange(val, action);
                    }}
                  >
                    {action}
                  </Checkbox>
                  <div>{description}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
