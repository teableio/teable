import type { IAttachmentFieldGenerateImageAIConfig } from '@teable/core';
import { IMAGE_RESOLUTIONS, ImageQuality } from '@teable/core';
import { ChevronDown, ChevronRight, HelpCircle, Settings } from '@teable/icons';
import { DEFAULT_ASPECT_RATIO_CANDIDATES, getOpenAIGptImage2SizeMeta } from '@teable/openapi';
import type { IAspectRatio, IImageSize, IOpenAIGptImage2SizeTier } from '@teable/openapi';
import { Selector } from '@teable/ui-lib/base';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

type IGenerateImageConfigPatch = Partial<Omit<IAttachmentFieldGenerateImageAIConfig, 'type'>>;
type TRatioLabel = (typeof sizeRatioLabels)[number]['label'];
type TSizeTier = IOpenAIGptImage2SizeTier;
type TRatioSelectorId = TRatioLabel | typeof AUTO_SELECTOR_ID;

const GPT_IMAGE_2_MODEL_ID = 'gpt-image-2';
const AUTO_SELECTOR_ID = '__auto__';

const sizeRatioLabels = [
  { label: '1:1', width: 1, height: 1 },
  { label: '3:2', width: 3, height: 2 },
  { label: '2:3', width: 2, height: 3 },
  { label: '4:3', width: 4, height: 3 },
  { label: '3:4', width: 3, height: 4 },
  { label: '16:9', width: 16, height: 9 },
  { label: '9:16', width: 9, height: 16 },
] as const;

const sizeTierOrder: TSizeTier[] = ['standard', '2K', '4K'];

interface IAdvancedImageSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageModelId?: string;
  supportsSize: boolean;
  supportsAutoSize?: boolean;
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
    imageModelId,
    supportsSize,
    supportsAutoSize,
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
  const isGptImage2RatioResolutionMode = imageModelId === GPT_IMAGE_2_MODEL_ID && supportsSize;
  const autoCandidate = { id: AUTO_SELECTOR_ID, name: t('table:field.aiConfig.auto') };
  const currentSizeMeta = getOpenAIGptImage2SizeMeta(currentSize);
  const currentRatioId: TRatioSelectorId = currentSizeMeta?.ratio ?? AUTO_SELECTOR_ID;
  const currentTierId = currentSizeMeta?.tier ?? '';
  const currentOutputSize = currentSizeMeta?.ratio && currentSize ? currentSize : undefined;

  const imageSizeCandidates = useMemo(() => {
    const candidates = imageSizeValues.map((size) => ({ id: size, name: size }));

    return supportsAutoSize ? [autoCandidate, ...candidates] : candidates;
  }, [autoCandidate, imageSizeValues, supportsAutoSize]);

  const ratioCandidates = useMemo(() => {
    const availableRatios = sizeRatioLabels
      .map(({ label }) => label)
      .filter((ratio) =>
        imageSizeValues.some((size) => getOpenAIGptImage2SizeMeta(size)?.ratio === ratio)
      );

    const candidates = availableRatios.map((ratio) => ({
      id: ratio,
      name: ratio,
    }));

    return supportsAutoSize ? [autoCandidate, ...candidates] : candidates;
  }, [autoCandidate, imageSizeValues, supportsAutoSize]);

  const getAvailableTiers = (ratio: TRatioLabel) =>
    sizeTierOrder.filter((tier) =>
      imageSizeValues.some((size) => {
        const meta = getOpenAIGptImage2SizeMeta(size);
        return meta?.ratio === ratio && meta.tier === tier;
      })
    );

  const selectSizeFor = (ratio: TRatioLabel, tier: TSizeTier, preferredSize?: string) => {
    if (preferredSize) {
      const preferredMeta = getOpenAIGptImage2SizeMeta(preferredSize);
      if (preferredMeta?.ratio === ratio && preferredMeta.tier === tier) {
        return preferredSize as IImageSize;
      }
    }

    return imageSizeValues.find((size) => {
      const meta = getOpenAIGptImage2SizeMeta(size);
      return meta?.ratio === ratio && meta.tier === tier;
    });
  };

  const currentResolutionCandidates = useMemo(() => {
    if (currentRatioId === AUTO_SELECTOR_ID) {
      return [];
    }

    return getAvailableTiers(currentRatioId).map((tier) => ({
      id: tier,
      name:
        tier === 'standard'
          ? t('table:field.aiConfig.resolution.1K')
          : t(`table:field.aiConfig.resolution.${tier}`),
    }));
  }, [currentRatioId, t]);

  const selectedResolutionId = currentTierId || currentResolutionCandidates[0]?.id || '';

  const qualityCandidates = useMemo(
    () => [
      { id: ImageQuality.Low, name: t('table:field.aiConfig.imageQuality.low') },
      { id: ImageQuality.Medium, name: t('table:field.aiConfig.imageQuality.medium') },
      { id: ImageQuality.High, name: t('table:field.aiConfig.imageQuality.high') },
    ],
    [t]
  );

  const aspectRatioCandidates = useMemo(() => {
    const ratios = aspectRatioValues.length ? aspectRatioValues : DEFAULT_ASPECT_RATIO_CANDIDATES;

    return [
      autoCandidate,
      ...ratios.map((ratio) => ({
        id: ratio,
        name: ratio,
      })),
    ];
  }, [aspectRatioValues, autoCandidate]);

  const resolutionCandidates = useMemo(
    () => [
      autoCandidate,
      ...IMAGE_RESOLUTIONS.map((resolution) => ({
        id: resolution,
        name: t(`table:field.aiConfig.resolution.${resolution}`),
      })),
    ],
    [autoCandidate, t]
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
        <Settings className="size-4" />
        <span className="flex-1 text-left">{t('table:field.aiConfig.label.advancedSettings')}</span>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-4 rounded-md border p-3">
        {isGptImage2RatioResolutionMode ? (
          <>
            <div className="flex flex-col gap-y-2">
              <span className="text-sm">{t('table:field.aiConfig.label.aspectRatio')}</span>
              <Selector
                className="w-full"
                placeholder={t('table:field.aiConfig.placeholder.aspectRatio')}
                selectedId={currentRatioId}
                onChange={(id) => {
                  if (id === AUTO_SELECTOR_ID) {
                    onChange({ size: undefined });
                    return;
                  }

                  const nextRatio = id as TRatioLabel;
                  const availableTiers = getAvailableTiers(nextRatio);
                  const nextTier =
                    (currentSizeMeta?.tier &&
                      availableTiers.find((tier) => tier === currentSizeMeta.tier)) ||
                    availableTiers.find((tier) => tier === 'standard') ||
                    availableTiers[0];

                  if (!nextTier) return;

                  onChange({
                    size: selectSizeFor(
                      nextRatio,
                      nextTier,
                      currentSize
                    ) as IAttachmentFieldGenerateImageAIConfig['size'],
                  });
                }}
                candidates={ratioCandidates}
                searchTip={t('sdk:common.search.placeholder')}
                emptyTip={t('sdk:common.search.empty')}
              />
            </div>

            {currentRatioId !== AUTO_SELECTOR_ID ? (
              <div className="flex flex-col gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{t('table:field.aiConfig.label.resolution')}</span>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t('table:field.aiConfig.tip.gptImageResolution')}
                          className="inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground"
                        >
                          <HelpCircle className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>{t('table:field.aiConfig.tip.gptImageResolution')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Selector
                  className="w-full"
                  placeholder={t('table:field.aiConfig.placeholder.resolution')}
                  selectedId={selectedResolutionId}
                  onChange={(id) => {
                    const nextSize = selectSizeFor(currentRatioId, id as TSizeTier, currentSize);

                    if (!nextSize) return;

                    onChange({
                      size: nextSize as IAttachmentFieldGenerateImageAIConfig['size'],
                    });
                  }}
                  candidates={currentResolutionCandidates}
                  searchTip={t('sdk:common.search.placeholder')}
                  emptyTip={t('sdk:common.search.empty')}
                />
                {currentOutputSize ? (
                  <p className="text-xs text-muted-foreground">{currentOutputSize}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : supportsSize ? (
          <div className="flex flex-col gap-y-2">
            <span className="text-sm">{t('table:field.aiConfig.label.imageSize')}</span>
            <Selector
              className="w-full"
              placeholder={t('table:field.aiConfig.placeholder.imageSize')}
              selectedId={currentSize || AUTO_SELECTOR_ID}
              onChange={(id) =>
                onChange({
                  size: (id === AUTO_SELECTOR_ID
                    ? undefined
                    : id) as IAttachmentFieldGenerateImageAIConfig['size'],
                })
              }
              candidates={imageSizeCandidates}
              searchTip={t('sdk:common.search.placeholder')}
              emptyTip={t('sdk:common.search.empty')}
            />
          </div>
        ) : null}

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
              selectedId={currentAspectRatio || AUTO_SELECTOR_ID}
              onChange={(id) =>
                onChange({
                  aspectRatio: (id === AUTO_SELECTOR_ID
                    ? undefined
                    : id) as IAttachmentFieldGenerateImageAIConfig['aspectRatio'],
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
              selectedId={currentResolution || AUTO_SELECTOR_ID}
              onChange={(id) =>
                onChange({
                  resolution: (id === AUTO_SELECTOR_ID
                    ? undefined
                    : id) as IAttachmentFieldGenerateImageAIConfig['resolution'],
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
