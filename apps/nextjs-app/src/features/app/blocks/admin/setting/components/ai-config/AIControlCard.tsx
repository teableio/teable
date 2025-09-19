import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';

interface SwitchListProps {
  disableActions: string[];
  onChange: (disableActions: string[]) => void;
}

export enum AIActions {
  BuildBase = 'build-base-agent',
  BuildAutomation = 'build-automation-agent',
  BaseResource = 'base-resource-crud-agent',
  Suggestion = 'suggestion',
  BaseApp = 'build-app-agent',
  AIBasicCapability = 'ai-basic-capability',
}

const AIFeatureList = [
  AIActions.AIBasicCapability,
  AIActions.BuildBase,
  AIActions.BaseApp,
  AIActions.BuildAutomation,
  AIActions.BaseResource,
  AIActions.Suggestion,
];

const SwitchableActions = [
  AIActions.BuildBase,
  AIActions.BaseApp,
  AIActions.BuildAutomation,
  AIActions.BaseResource,
  AIActions.Suggestion,
];

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
  const { onChange, disableActions } = props;
  const { t } = useTranslation('common');

  const AIFeatureListNameMap = useMemo(() => {
    return {
      [AIActions.BuildBase]: t('admin.setting.ai.actions.buildBase.title'),
      [AIActions.BuildAutomation]: t('admin.setting.ai.actions.buildAutomation.title'),
      [AIActions.BaseResource]: t('admin.setting.ai.actions.baseResource.title'),
      [AIActions.Suggestion]: t('admin.setting.ai.actions.suggestion.title'),
      [AIActions.BaseApp]: t('admin.setting.ai.actions.buildApp.title'),
      [AIActions.AIBasicCapability]: t('admin.setting.ai.actions.aiBasicCapability.title'),
    };
  }, [t]);

  const AIFeatureListDescriptionMap = useMemo(() => {
    return {
      [AIActions.BuildBase]: t('admin.setting.ai.actions.buildBase.description'),
      [AIActions.BuildAutomation]: t('admin.setting.ai.actions.buildAutomation.description'),
      [AIActions.BaseResource]: t('admin.setting.ai.actions.baseResource.description'),
      [AIActions.Suggestion]: t('admin.setting.ai.actions.suggestion.description'),
      [AIActions.BaseApp]: t('admin.setting.ai.actions.buildApp.description'),
      [AIActions.AIBasicCapability]: t('admin.setting.ai.actions.aiBasicCapability.description'),
    };
  }, [t]);

  const AIFeatureListWithOptions = useMemo(() => {
    return AIFeatureList.map((item) => ({
      name: AIFeatureListNameMap[item],
      description: AIFeatureListDescriptionMap[item],
      disabled: !SwitchableActions.includes(item),
    }));
  }, [AIFeatureListDescriptionMap, AIFeatureListNameMap]);

  const onCheckItemHandler = useCallback(
    (actionName: AIActions, open: boolean) => {
      if (open && disableActions.find((action) => action === actionName)) {
        const index = disableActions.findIndex((action) => action === actionName);
        if (index !== -1) {
          const newDisableActions = [...disableActions];
          newDisableActions.splice(index, 1);
          onChange(newDisableActions);
        }
      }

      if (!open && !disableActions.find((action) => action === actionName)) {
        const newDisableActions = [...disableActions, actionName];
        onChange(newDisableActions);
      }
    },
    [disableActions, onChange]
  );

  return AIFeatureListWithOptions.map(({ name, description, disabled }) => (
    <div className="flex items-center justify-between" key={name}>
      <div className="flex items-center gap-x-1">
        <Label
          htmlFor={name}
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {name}
        </Label>
        <TooltipWrap description={description}>
          <CircleHelp className="size-4 cursor-pointer text-gray-400" />
        </TooltipWrap>
      </div>
      <Switch
        id={name}
        onCheckedChange={(open) => {
          onCheckItemHandler(name as AIActions, open);
        }}
        checked={!disableActions?.includes(name)}
        disabled={disabled}
      />
    </div>
  ));
};

export const AIControlCard = ({
  disableAIActions,
  onChange,
}: {
  disableAIActions: string[];
  onChange: (value: string[]) => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>{t('admin.setting.ai.aiAbilitySettings')}</CardTitle>
        <CardDescription>{t('admin.setting.ai.aiAbilitySettingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <SwitchList onChange={onChange} disableActions={disableAIActions} />
        </div>
      </CardContent>
    </Card>
  );
};
