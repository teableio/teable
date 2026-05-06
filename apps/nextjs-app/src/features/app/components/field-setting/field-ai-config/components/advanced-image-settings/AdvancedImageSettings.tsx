import type { IAttachmentFieldGenerateImageAIConfig } from '@teable/core';
import { IMAGE_RESOLUTIONS, ImageQuality } from '@teable/core';
import { ChevronDown, ChevronRight, Settings } from '@teable/icons';
import { DEFAULT_ASPECT_RATIO_CANDIDATES } from '@teable/openapi';
import type { IAspectRatio, IImageSize } from '@teable/openapi';
import { Selector } from '@teable/ui-lib/base';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Slider } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

type IGenerateImageConfigPatch = Partial<Omit<IAttachmentFieldGenerateImageAIConfig, 'type'>>;

interface IAdvancedImageSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supportsSize: boolean;
  supportsQuality: boolean;
  supportsAspectRatio: boolean;
  supportsResolution: boolean;
  supportsCount: boolean;
  imageSizeValues: IImageSize[];
  aspectRatioValues: IAspectRatio[];
  currentSize: string;
  currentQuality: ImageQuality;
  currentAspectRatio?: string;
  currentResolution?: IAttachmentFieldGenerateImageAIConfig['resolution'];
  currentCount: number;
  maxCount: number;
  maxImagesPerCall?: number;
  onChange: (patch: IGenerateImageConfigPatch) => void;
}

export const AdvancedImageSettings = (props: IAdvancedImageSettingsProps) => {
  const {
    open,
    onOpenChange,
    supportsSize,
    supportsQuality,
    supportsAspectRatio,
    supportsResolution,
    supportsCount,
    imageSizeValues,
    aspectRatioValues,
    currentSize,
    currentQuality,
    currentAspectRatio,
    currentResolution,
    currentCount,
    maxCount,
    maxImagesPerCall,
    onChange,
  } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const imageSizeCandidates = useMemo(() => {
    return imageSizeValues.map((size) => ({ id: size, name: size }));
  }, [imageSizeValues]);

  const qualityCandidates = useMemo(
    () => [
      { id: ImageQuality.Low, name: t('table:field.aiConfig.imageQuality.low') },
      { id: ImageQuality.Medium, name: t('table:field.aiConfig.imageQuality.medium') },
      { id: ImageQuality.High, name: t('table:field.aiConfig.imageQuality.high') },
    ],
    [t]
  );

  const aspectRatioCandidates = useMemo(() => {
    const autoOption = { id: '', name: t('table:field.aiConfig.auto') };
    const ratios = aspectRatioValues.length ? aspectRatioValues : DEFAULT_ASPECT_RATIO_CANDIDATES;

    return [
      autoOption,
      ...ratios.map((ratio) => ({
        id: ratio,
        name: ratio,
      })),
    ];
  }, [aspectRatioValues, t]);

  const resolutionCandidates = useMemo(
    () => [
      { id: '', name: t('table:field.aiConfig.auto') },
      ...IMAGE_RESOLUTIONS.map((resolution) => ({
        id: resolution,
        name: t(`table:field.aiConfig.resolution.${resolution}`),
      })),
    ],
    [t]
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
        <Settings className="size-4" />
        <span className="flex-1 text-left">{t('table:field.aiConfig.label.advancedSettings')}</span>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-4 rounded-md border p-3">
        {supportsSize && (
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">{t('table:field.aiConfig.label.imageSize')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.imageSize')}
              selectedId={currentSize}
              onChange={(id) =>
                onChange({ size: id as IAttachmentFieldGenerateImageAIConfig['size'] })
              }
              candidates={imageSizeCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
        )}

        {supportsQuality && (
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">{t('table:field.aiConfig.label.imageQuality')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.imageQuality')}
              selectedId={currentQuality}
              onChange={(id) => onChange({ quality: id as ImageQuality })}
              candidates={qualityCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
        )}

        {supportsAspectRatio && (
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">{t('table:field.aiConfig.label.aspectRatio')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.aspectRatio')}
              selectedId={currentAspectRatio ?? ''}
              onChange={(id) =>
                onChange({
                  aspectRatio: (id ||
                    undefined) as IAttachmentFieldGenerateImageAIConfig['aspectRatio'],
                })
              }
              candidates={aspectRatioCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
        )}

        {supportsResolution && (
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">{t('table:field.aiConfig.label.resolution')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.resolution')}
              selectedId={currentResolution ?? ''}
              onChange={(id) =>
                onChange({
                  resolution: (id ||
                    undefined) as IAttachmentFieldGenerateImageAIConfig['resolution'],
                })
              }
              candidates={resolutionCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
        )}

        {supportsCount && (
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">{t('table:field.aiConfig.label.imageCount')}</span>
            <div className="flex w-full cursor-pointer justify-between gap-x-4 rounded-md border px-3 py-2">
              <Slider
                value={[currentCount]}
                min={1}
                max={maxCount}
                step={1}
                className="grow"
                onValueChange={(value) => onChange({ n: Number(value[0]) })}
              />
              <span className="min-w-[24px] text-center">{currentCount}</span>
            </div>
            {maxImagesPerCall === 1 && (
              <p className="text-xs text-muted-foreground">
                {t('table:field.aiConfig.hint.singleImageOnly')}
              </p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
