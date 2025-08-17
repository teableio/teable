import { actionPrefixMap } from '@teable/core';
import type { Action, ActionPrefix } from '@teable/core';
import { usePermissionActionsStatic } from '@teable/sdk/hooks';
import { Checkbox, Label, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';

interface IScopesSelectProps {
  initValue?: Action[];
  onChange?: (value: string[]) => void;
  actionsPrefixes?: ActionPrefix[];
}

export const ScopesSelect = (props: IScopesSelectProps) => {
  const { onChange, initValue, actionsPrefixes } = props;
  const { t } = useTranslation('token');
  const [value, setValue] = useState<Record<Action, boolean>>(() => {
    if (initValue) {
      return initValue.reduce(
        (acc, cur) => {
          acc[cur] = true;
          return acc;
        },
        {} as Record<Action, boolean>
      );
    }
    return {} as Record<Action, boolean>;
  });
  const { actionPrefixStaticMap, actionStaticMap, actionPrefixDisplayOrder } =
    usePermissionActionsStatic();

  const onCheckBoxChange = (status: boolean, val: Action) => {
    const actionMap = { ...value };
    actionMap[val] = status;
    setValue(actionMap);
    const actions = Object.keys(actionMap).filter((key) => actionMap[key as Action]);
    onChange?.(actions);
  };

  const handleSelectAll = (prefix: ActionPrefix, shouldSelect: boolean) => {
    const actionMap = { ...value };
    actionPrefixMap[prefix].forEach((action) => {
      actionMap[action] = shouldSelect;
    });
    setValue(actionMap);
    const actions = Object.keys(actionMap).filter((key) => actionMap[key as Action]);
    onChange?.(actions);
  };

  const actionsPrefix = useMemo(() => {
    const availableKeys = Object.keys(actionPrefixStaticMap) as ActionPrefix[];

    const orderedKeys = actionPrefixDisplayOrder.filter((prefix) => availableKeys.includes(prefix));

    if (actionsPrefixes) {
      return orderedKeys.filter((prefix) => actionsPrefixes.includes(prefix));
    }

    return orderedKeys;
  }, [actionPrefixStaticMap, actionPrefixDisplayOrder, actionsPrefixes]);

  return (
    <div className="space-y-3 pl-2">
      {actionsPrefix.map((actionPrefix) => {
        const actions = actionPrefixMap[actionPrefix];
        const isAllSelected = actions.every((action) => value[action]);
        return (
          <div key={actionPrefix} className="group space-y-1">
            <div className="flex items-center">
              <Label>{actionPrefixStaticMap[actionPrefix].title}</Label>
              <Button
                variant="link"
                className="invisible h-6 px-2 text-xs text-muted-foreground group-hover:visible"
                onClick={() => handleSelectAll(actionPrefix, !isAllSelected)}
              >
                {isAllSelected ? t('edit.cancelSelectAll') : t('edit.selectAll')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
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
