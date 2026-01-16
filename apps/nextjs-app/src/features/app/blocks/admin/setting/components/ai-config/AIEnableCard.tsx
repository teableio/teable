'use client';

import { Check, AlertCircle } from '@teable/icons';
import { Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IAIEnableCardProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  // Configuration status
  hasGatewayKey: boolean;
  hasModels: boolean;
  hasChatModel: boolean;
  isCloud: boolean;
}

interface IConfigItem {
  key: string;
  label: string;
  isComplete: boolean;
}

export function AIEnableCard({
  enabled,
  onEnabledChange,
  hasGatewayKey,
  hasModels,
  hasChatModel,
  isCloud,
}: IAIEnableCardProps) {
  const { t } = useTranslation('common');

  // Build config checklist based on cloud/non-cloud
  const configItems: IConfigItem[] = isCloud
    ? [
        {
          key: 'llmApi',
          label: t('admin.setting.ai.wizard.step.llmApi'),
          isComplete: hasGatewayKey,
        },
        {
          key: 'models',
          label: t('admin.setting.ai.wizard.step.modelPool'),
          isComplete: hasModels,
        },
        {
          key: 'chatModel',
          label: t('admin.setting.ai.wizard.step.chatModel'),
          isComplete: hasChatModel,
        },
      ]
    : [
        {
          key: 'models',
          label: t('admin.setting.ai.wizard.step.providers'),
          isComplete: hasModels,
        },
        {
          key: 'chatModel',
          label: t('admin.setting.ai.wizard.step.chatModel'),
          isComplete: hasChatModel,
        },
      ];

  const allComplete = configItems.every((item) => item.isComplete);
  const incompleteItems = configItems.filter((item) => !item.isComplete);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold text-foreground">
              {t('admin.setting.ai.enableCard.title')}
            </div>
            {enabled && allComplete && <Check className="size-5 text-green-500" />}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {!enabled
              ? t('admin.setting.ai.enableCard.disabled')
              : allComplete
                ? t('admin.setting.ai.enableCard.ready')
                : t('admin.setting.ai.enableCard.needsConfig')}
          </div>
        </div>

        <Switch checked={enabled} onCheckedChange={onEnabledChange} className="mt-1" />
      </div>

      {enabled && !allComplete && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="size-4 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <span>{t('admin.setting.ai.enableCard.missingConfig')}</span>{' '}
            <span>{incompleteItems.map((item) => item.label).join('、')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
