import { AlertTriangle, Check, Image, File, Settings } from '@teable/icons';
import { chatModelAbilityType } from '@teable/openapi';
import type {
  IAIIntegrationConfig,
  IChatModelAbility,
  IAbilityDetail,
  ISettingVo,
} from '@teable/openapi';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { Cpu } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { AIModelSelect, type IModelOption } from './AiModelSelect';

// Helper to check if ability is supported (handles both boolean and detailed format)
const isAbilitySupported = (ability: boolean | IAbilityDetail | undefined): boolean => {
  if (typeof ability === 'boolean') return ability;
  if (ability && typeof ability === 'object') {
    return ability.url === true || ability.base64 === true;
  }
  return false;
};

// Helper to get support details for display
const getAbilitySupportDetails = (ability: boolean | IAbilityDetail | undefined): string | null => {
  if (typeof ability === 'boolean') return null;
  if (ability && typeof ability === 'object') {
    const supports: string[] = [];
    if (ability.url) supports.push('URL');
    if (ability.base64) supports.push('Base64');
    return supports.length > 0 ? supports.join(', ') : null;
  }
  return null;
};

export const CodingModels = ({
  value,
  onChange,
  formValues,
  models,
  onEnableAI,
  needGroup,
}: {
  value: IAIIntegrationConfig['chatModel'];
  onChange: (value: IAIIntegrationConfig['chatModel']) => void;
  models?: IModelOption[];
  formValues?: NonNullable<ISettingVo['aiConfig']>;
  onEnableAI?: () => void;
  // Kept for backward compatibility, but not used since testing happens in provider config
  onTestChatModelAbility?: (
    chatModel: IAIIntegrationConfig['chatModel']
  ) => Promise<IChatModelAbility | undefined>;
  needGroup?: boolean;
}) => {
  const { t } = useTranslation('common');
  const [showEnableAIModal, setShowEnableAIModal] = useState(false);

  const abilityIconMap = useMemo(() => {
    return {
      image: <Image className="size-4" />,
      pdf: <File className="size-4" />,
      toolCall: <Settings className="size-4" />,
    };
  }, []);

  // Get ability from the selected model's capabilities or from value.ability
  // Priority: value.ability (from selection) > model capabilities (from provider config)
  const selectedModelAbility = useMemo(() => {
    // First check value.ability (set when model is selected)
    if (value?.ability && Object.keys(value.ability).length > 0) {
      return value.ability as IChatModelAbility;
    }
    // Fallback to model's capabilities from provider config
    if (!value?.lg || !models) return undefined;
    const selectedModel = models.find((m) => m.modelKey === value.lg);
    return selectedModel?.capabilities as IChatModelAbility | undefined;
  }, [value?.lg, value?.ability, models]);

  const handleModelChange = (model: string) => {
    // Get ability from the model's capabilities (already tested)
    const selectedModel = models?.find((m) => m.modelKey === model);
    const ability = (selectedModel?.capabilities as IChatModelAbility) || {};

    // Set all sizes to the same model (simplified selection)
    onChange({ ...value, lg: model, md: model, sm: model, ability });

    // Check if AI needs to be enabled
    if (model && formValues && !formValues.enable) {
      setShowEnableAIModal(true);
    }
  };

  const handleEnableAIConfirm = () => {
    // Enable AI after model selection
    onEnableAI?.();
    setShowEnableAIModal(false);
  };

  const handleEnableAICancel = () => {
    // Don't enable AI, just close modal
    setShowEnableAIModal(false);
  };

  // Icon for chat model selection
  const chatModelIcon = useMemo(() => <Cpu className="size-4 text-purple-500" />, []);

  // Check if model has been tested
  const isModelTested = useMemo(() => {
    return selectedModelAbility && Object.keys(selectedModelAbility).length > 0;
  }, [selectedModelAbility]);

  // Check if model has missing critical abilities
  const hasMissingAbilities = useMemo(() => {
    if (!value?.lg) return false;
    // If model is not tested, show warning
    if (!isModelTested) return true;
    // Model should support toolCall (critical for AI features)
    const hasToolCall = isAbilitySupported(selectedModelAbility?.toolCall);
    return !hasToolCall;
  }, [value?.lg, isModelTested, selectedModelAbility]);

  const getMissingAbilitiesMessage = useMemo(() => {
    if (!value?.lg) return null;
    const missing: string[] = [];

    // If model is not tested, show "not tested" warning
    if (!isModelTested) {
      missing.push(t('admin.setting.ai.chatModelAbility.notTested'));
      return missing;
    }

    // Check for missing abilities
    if (
      !isAbilitySupported(selectedModelAbility?.image) &&
      !isAbilitySupported(selectedModelAbility?.pdf)
    ) {
      missing.push(t('admin.setting.ai.chatModelAbility.missingVision'));
    }
    if (!isAbilitySupported(selectedModelAbility?.toolCall)) {
      missing.push(t('admin.setting.ai.chatModelAbility.missingToolCall'));
    }
    return missing.length > 0 ? missing : null;
  }, [value?.lg, isModelTested, selectedModelAbility, t]);

  // Abilities to test and display
  const testableAbilities = chatModelAbilityType.options;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Chat model selection - simplified to one model */}
      <div className="relative flex flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2 truncate text-sm">
          {chatModelIcon}
          <span>{t('admin.setting.ai.chatModel')}</span>
          <div className="h-4 text-red-500">*</div>
        </div>
        <div className="text-left text-xs text-muted-foreground">
          {t('admin.setting.ai.chatModelDescription')}
        </div>

        <AIModelSelect
          value={value?.lg ?? ''}
          onValueChange={handleModelChange}
          options={models}
          className="flex-1"
          needGroup={needGroup}
        />

        {/* Model Ability Section - directly under model select */}
        {value?.lg && (
          <div className="mt-2 rounded-md border bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t('admin.setting.ai.chatModelAbility.lgModelAbility')}
              </span>
            </div>

            {/* Ability badges - from pre-tested results in provider config */}
            <div className="mt-2 flex flex-wrap gap-2">
              <TooltipProvider>
                {testableAbilities.map((type) => {
                  const abilityValue = selectedModelAbility?.[type];
                  const supported = isAbilitySupported(abilityValue);
                  const supportDetails = getAbilitySupportDetails(abilityValue);

                  const badge = (
                    <div
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
                        supported
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {supported ? (
                        <Check className="size-3" />
                      ) : (
                        abilityIconMap[type as keyof typeof abilityIconMap]
                      )}
                      <span>{t(`admin.setting.ai.chatModelAbility.${type}`)}</span>
                      {supportDetails && (
                        <span className="ml-0.5 opacity-70">({supportDetails})</span>
                      )}
                    </div>
                  );

                  // Show tooltip with details for image/pdf
                  if (supportDetails) {
                    return (
                      <Tooltip key={type}>
                        <TooltipTrigger asChild>{badge}</TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {t('admin.setting.ai.chatModelAbility.supportedFormats')}:{' '}
                            {supportDetails}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return <div key={type}>{badge}</div>;
                })}
              </TooltipProvider>
            </div>

            {/* Warning for missing abilities */}
            {hasMissingAbilities && getMissingAbilitiesMessage && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50/50 p-2.5 dark:bg-amber-900/20">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="text-xs text-amber-700 dark:text-amber-400">
                  <p className="font-medium">
                    {t('admin.setting.ai.chatModelTest.modelNotSuitable')}
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {getMissingAbilitiesMessage.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showEnableAIModal}
        onOpenChange={setShowEnableAIModal}
        title={t('admin.setting.ai.chatModelTest.enableAITitle')}
        description={t('admin.setting.ai.chatModelTest.enableAIDescription')}
        confirmText={t('admin.setting.ai.chatModelTest.enableAI')}
        cancelText={t('admin.setting.ai.chatModelTest.skipTest')}
        onConfirm={handleEnableAIConfirm}
        onCancel={handleEnableAICancel}
      />
    </div>
  );
};
