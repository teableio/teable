import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ICanaryConfig, ISettingVo, IUpdateSettingRo } from '@teable/openapi';
import { SettingKey, updateSetting } from '@teable/openapi';
import {
  Button,
  Label,
  Switch,
  Textarea,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { Settings } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';

const parseSpaceIds = (input: string): string[] => {
  return input
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
};

interface ICanarySettingsProps {
  setting: ISettingVo;
}

export const CanarySettings = ({ setting }: ICanarySettingsProps) => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { enableCanaryFeature } = useEnv() as { enableCanaryFeature?: boolean };

  const { mutateAsync: mutateUpdateSetting } = useMutation({
    mutationFn: (props: IUpdateSettingRo) => updateSetting(props),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setting'] });
    },
  });

  const canaryConfig = setting.canaryConfig as ICanaryConfig | null | undefined;

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      mutateUpdateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled,
          spaceIds: canaryConfig?.spaceIds ?? [],
        },
      });
    },
    [canaryConfig?.spaceIds, mutateUpdateSetting]
  );

  const handleSpaceIdsChange = useCallback(
    (spaceIds: string[]) => {
      mutateUpdateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: canaryConfig?.enabled ?? false,
          spaceIds,
        },
      });
    },
    [canaryConfig?.enabled, mutateUpdateSetting]
  );

  // Only show if canary feature is enabled via environment variable
  if (!enableCanaryFeature) {
    return null;
  }

  const selectedCount = canaryConfig?.spaceIds?.length ?? 0;

  return (
    <div className="pb-6">
      <h2 className="mb-4 text-lg font-medium">{t('admin.canary.title')}</h2>
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="enable-canary">{t('admin.canary.enable')}</Label>
            <div className="text-xs text-muted-foreground">
              {t('admin.canary.enableDescription')}
            </div>
          </div>
          <Switch
            id="enable-canary"
            checked={Boolean(canaryConfig?.enabled)}
            onCheckedChange={handleEnabledChange}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>{t('admin.canary.spaces')}</Label>
            <div className="text-xs text-muted-foreground">
              {t('admin.canary.spacesDescription', { count: selectedCount })}
            </div>
          </div>
          <SpaceIdsEditor spaceIds={canaryConfig?.spaceIds ?? []} onSave={handleSpaceIdsChange} />
        </div>
      </div>
    </div>
  );
};

interface ISpaceIdsEditorProps {
  spaceIds: string[];
  onSave: (spaceIds: string[]) => void;
}

const SpaceIdsEditor = ({ spaceIds, onSave }: ISpaceIdsEditorProps) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  // Parse and preview space IDs in real-time
  const parsedSpaceIds = useMemo(() => parseSpaceIds(value), [value]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        // Convert array to newline-separated string
        setValue(spaceIds.join('\n'));
      }
      setOpen(isOpen);
    },
    [spaceIds]
  );

  const handleSave = useCallback(() => {
    onSave(parsedSpaceIds);
    setOpen(false);
  }, [parsedSpaceIds, onSave]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="mr-1 size-4" />
          {t('admin.canary.configure')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label>{t('admin.canary.spaceIds')}</Label>
            <div className="text-xs text-muted-foreground">
              {t('admin.canary.spaceIdsDescription')}
            </div>
          </div>
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('admin.canary.spaceIdsPlaceholder')}
            className="min-h-[100px] font-mono text-sm"
          />
          {/* Preview section */}
          <div className="space-y-1">
            <Label className="text-xs">
              {t('admin.canary.preview' as never, { count: parsedSpaceIds.length })}
            </Label>
            <div className="max-h-[120px] overflow-y-auto rounded-md border bg-muted/50 p-2">
              {parsedSpaceIds.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {parsedSpaceIds.map((id, index) => (
                    <span
                      key={`${id}-${index}`}
                      className="inline-flex items-center rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('admin.canary.noSpaceIds' as never)}
                </span>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave}>
              {t('actions.save')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
