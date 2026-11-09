import type { AccessTokenPreset } from '@teable/core';
import {
  AccessTokenScopeLevel,
  accessTokenPresetLevels,
  accessTokenPresets,
  presetScopeGroups,
} from '@teable/core';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IScopePresetsProps {
  value: AccessTokenPreset | null;
  onChange: (preset: AccessTokenPreset) => void;
}

const levelClassName: Record<AccessTokenScopeLevel, string> = {
  [AccessTokenScopeLevel.None]: 'text-muted-foreground/60',
  [AccessTokenScopeLevel.Read]: 'text-foreground',
  [AccessTokenScopeLevel.Write]: 'font-medium text-blue-600 dark:text-blue-400',
};

export const ScopePresets = ({ value, onChange }: IScopePresetsProps) => {
  const { t } = useTranslation('token');

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {accessTokenPresets.map((preset) => {
        const levels = accessTokenPresetLevels[preset];
        return (
          <button
            key={preset}
            type="button"
            className={cn(
              'flex flex-col rounded-lg border p-3 text-start transition-colors hover:border-foreground/30',
              value === preset && 'border-blue-600 ring-2 ring-blue-600/20 hover:border-blue-600'
            )}
            onClick={() => onChange(preset)}
          >
            <div className="text-sm font-semibold">
              {t(`permission.presets.${preset}.name`)}
              {preset === 'builder' && (
                <span className="ms-1.5 text-xs font-normal text-blue-600 dark:text-blue-400">
                  {t('permission.presets.builder.tag')}
                </span>
              )}
            </div>
            <div className="mb-2.5 mt-0.5 text-xs text-muted-foreground">
              {t(`permission.presets.${preset}.description`)}
            </div>
            <div className="mt-auto space-y-0.5 border-t pt-2 text-xs">
              {presetScopeGroups.map((group) => (
                <div key={group} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t(`permission.groups.${group}.name`)}
                  </span>
                  <span className={levelClassName[levels[group]]}>
                    {t(`permission.levelLabels.${levels[group]}`)}
                  </span>
                </div>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
};
