import { PluginPosition } from '@teable/openapi';
import { Checkbox } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';

export const PositionSelector = (props: {
  value?: PluginPosition[];
  onChange: (value?: PluginPosition[]) => void;
}) => {
  const { value = [], onChange } = props;
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const positionStatic = useMemo(() => {
    return {
      [PluginPosition.Dashboard]: t('common:noun.dashboard'),
      [PluginPosition.View]: t('common:noun.view'),
      [PluginPosition.ContextMenu]: t('common:noun.pluginContextMenu'),
      [PluginPosition.Panel]: t('common:noun.pluginPanel'),
    };
  }, [t]);
  return (
    <div>
      {Object.values(PluginPosition).map((position) => (
        <div key={position} className="flex items-center gap-2">
          <Checkbox
            id={`position-${position}`}
            checked={value.includes(position)}
            onCheckedChange={() => {
              const newValue = value.includes(position)
                ? value.filter((v) => v !== position)
                : [...value, position];
              onChange(newValue);
            }}
          />

          <label htmlFor={`position-${position}`} className="text-sm font-normal">
            {positionStatic[position]}
          </label>
        </div>
      ))}
    </div>
  );
};
