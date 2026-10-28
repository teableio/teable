import { InteractionMode, useInteractionModeStore } from '@teable/sdk/store';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

export const InteractionSelect = ({ className }: { className?: string }) => {
  const { t } = useTranslation('common');
  const { interactionMode: interactionType, updateInteractionMode: updateInteractionType } =
    useInteractionModeStore();

  const items = useMemo(() => {
    return [
      {
        value: InteractionMode.Mouse,
        label: t('settings.setting.mouseMode'),
      },
      {
        value: InteractionMode.Touch,
        label: t('settings.setting.touchMode'),
      },
      {
        value: InteractionMode.System,
        label: t('settings.setting.systemMode'),
      },
    ];
  }, [t]);

  return (
    <Select value={interactionType} onValueChange={updateInteractionType}>
      <SelectTrigger className={cn('w-auto min-w-32', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(({ value, label }) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
