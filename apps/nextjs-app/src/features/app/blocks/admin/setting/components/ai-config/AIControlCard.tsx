import {
  Card,
  CardContent,
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { CircleHelp, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface SwitchListProps {
  disableActions: string[];
  instanceDisableActions?: string[];
  sandboxConfigured?: boolean;
  disabled?: boolean;
  onChange: (value: { disableActions: string[] }) => Promise<unknown> | void;
}

export enum AIActions {
  AIField = 'ai-field',
  AIChat = 'ai-chat',
}

const AIFeatureList = [AIActions.AIField, AIActions.AIChat];

const SwitchableActions = [AIActions.AIField, AIActions.AIChat];

const TooltipWrap = ({
  children,
  description,
}: {
  children: React.ReactNode;
  description: string;
}) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>{description}</TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};

const SwitchList = (props: SwitchListProps) => {
  const {
    onChange,
    disableActions,
    instanceDisableActions = [],
    sandboxConfigured,
    disabled: disabledAll,
  } = props;
  const { t } = useTranslation('common');

  const AIFeatureListNameMap = useMemo(() => {
    return {
      [AIActions.AIField]: t('admin.setting.ai.actions.aiField.title'),
      [AIActions.AIChat]: t('admin.setting.ai.actions.aiChat.title'),
    };
  }, [t]);

  const AIFeatureListDescriptionMap = useMemo(() => {
    return {
      [AIActions.AIField]: t('admin.setting.ai.actions.aiField.description'),
      [AIActions.AIChat]: t('admin.setting.ai.actions.aiChat.description'),
    };
  }, [t]);

  const AIFeatureListWithOptions = useMemo(() => {
    return AIFeatureList.map((item) => ({
      name: AIFeatureListNameMap[item],
      key: item,
      description: AIFeatureListDescriptionMap[item],
      disabled: !SwitchableActions.includes(item) || instanceDisableActions.includes(item),
    }));
  }, [AIFeatureListDescriptionMap, AIFeatureListNameMap, instanceDisableActions]);

  const onCheckItemHandler = useCallback(
    (actionName: AIActions, open: boolean) => {
      if (open && disableActions.find((action) => action === actionName)) {
        const index = disableActions.findIndex((action) => action === actionName);
        if (index !== -1) {
          const newDisableActions = [...disableActions];
          newDisableActions.splice(index, 1);
          onChange({ disableActions: newDisableActions });
        }
      }

      if (!open && !disableActions.find((action) => action === actionName)) {
        const newDisableActions = [...disableActions, actionName];
        onChange({ disableActions: newDisableActions });
      }
    },
    [disableActions, onChange]
  );

  return (
    <>
      {AIFeatureListWithOptions.map(({ name, description, disabled, key }) => (
        <div className="flex items-center justify-between" key={key}>
          <div className="flex items-center gap-x-1">
            <Label
              htmlFor={key}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {name}
            </Label>
            <TooltipWrap description={description}>
              <CircleHelp className="size-4 cursor-pointer text-muted-foreground" />
            </TooltipWrap>
            {key === AIActions.AIChat && sandboxConfigured === false && (
              <TooltipWrap description={t('admin.setting.ai.actions.aiChat.sandboxWarning')}>
                <TriangleAlert className="size-4 cursor-pointer text-yellow-500" />
              </TooltipWrap>
            )}
          </div>
          <Switch
            id={key}
            onCheckedChange={(open) => {
              onCheckItemHandler(key, open);
            }}
            checked={!disableActions?.includes(key) && !instanceDisableActions.includes(key)}
            disabled={disabledAll || disabled}
          />
        </div>
      ))}
    </>
  );
};

export const AIControlCard = ({
  disableActions,
  instanceDisableActions,
  sandboxConfigured,
  disabled,
  onChange,
}: {
  disableActions: string[];
  instanceDisableActions?: string[];
  sandboxConfigured?: boolean;
  disabled?: boolean;
  onChange: (value: { disableActions: string[] }) => Promise<unknown> | void;
}) => {
  const { t } = useTranslation('common');
  const [localDisableActions, setLocalDisableActions] = useState(disableActions);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalDisableActions(disableActions);
  }, [disableActions]);

  const handleChange = async (value: { disableActions: string[] }) => {
    const previousDisableActions = localDisableActions;
    setLocalDisableActions(value.disableActions);
    try {
      setIsSaving(true);
      await onChange(value);
    } catch (error) {
      setLocalDisableActions(previousDisableActions);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-5 shadow-none">
      <CardContent className="flex flex-col gap-4 p-0">
        <p className="font-medium">{t('admin.setting.ai.actions.title')}</p>
        <div className="flex flex-col gap-3">
          <SwitchList
            onChange={handleChange}
            disableActions={localDisableActions}
            instanceDisableActions={instanceDisableActions}
            sandboxConfigured={sandboxConfigured}
            disabled={disabled || isSaving}
          />
        </div>
      </CardContent>
    </Card>
  );
};
