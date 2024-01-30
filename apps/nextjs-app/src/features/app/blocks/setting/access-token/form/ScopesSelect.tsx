import { actionPrefixMap, type ActionPrefix, type AllActions } from '@teable-group/core';
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
  const { actionPrefixStaticMap, actionStaticMap } = usePermissionActionsStatic();

  const onCheckBoxChange = (status: boolean, val: AllActions) => {
    const actionMap = { ...value };
    actionMap[val] = status;
    setValue(actionMap);
    const actions = Object.keys(actionMap).filter((key) => actionMap[key as AllActions]);
    onChange?.(actions);
  };

  return (
    <div className="space-y-3 pl-2">
      {Object.keys(actionPrefixStaticMap).map((_actionPrefix) => {
        const actionPrefix = _actionPrefix as ActionPrefix;
        const actions = actionPrefixMap[actionPrefix];
        return (
          <div key={actionPrefix} className="space-y-1">
            <Label>{actionPrefixStaticMap[actionPrefix].title}</Label>
            <div className="flex gap-3">
              {actions.map((action) => (
                <div className="flex items-center gap-1 text-sm" key={action}>
                  <Checkbox
                    id={action}
                    value={action}
                    checked={value[action]}
                    onCheckedChange={(val: boolean) => {
                      onCheckBoxChange(val, action);
                    }}
                  />
                  <Label htmlFor={action} className="text-xs font-normal">
                    {actionStaticMap[action].description}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
