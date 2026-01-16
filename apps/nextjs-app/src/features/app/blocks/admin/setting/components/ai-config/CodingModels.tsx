import { AlertTriangle, Check, Loader2, Image, File, Settings } from '@teable/icons';
import {
  chatModelAbilityType,
  type IAIIntegrationConfig,
  type IChatModelAbility,
  type IAbilityDetail,
} from '@teable/openapi';
import type { ISettingVo } from '@teable/openapi/src/admin/setting/get';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Cpu, Code, Zap } from 'lucide-react';
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
  onTestChatModelAbility,
  onEnableAI,
  needGroup,
}: {
  value: IAIIntegrationConfig['chatModel'];
  onChange: (value: IAIIntegrationConfig['chatModel']) => void;
  models?: IModelOption[];
  formValues?: NonNullable<ISettingVo['aiConfig']>;
  onEnableAI?: () => void;
  onTestChatModelAbility?: (
    chatModel: IAIIntegrationConfig['chatModel']
  ) => Promise<IChatModelAbility | undefined>;
  needGroup?: boolean;
}) => {
  const { t } = useTranslation('common');
  const [showTestModal, setShowTestModal] = useState(false);
  const [showEnableAIModal, setShowEnableAIModal] = useState(false);
  const [pendingModel, setPendingModel] = useState<string>('');
  const [isTestingModel, setIsTestingModel] = useState(false);

  const abilityIconMap = useMemo(() => {
    return {
      image: <Image className="size-4" />,
      pdf: <File className="size-4" />,
      toolCall: <Settings className="size-4" />,
    };
  }, []);

  const handleLgModelChange = async (model: string) => {
    // Show test modal when lg model is selected
    if (model && model !== value?.lg) {
      setPendingModel(model);
      setShowTestModal(true);
    } else {
      onChange({ ...value, lg: model, ability: {} });
    }
  };

  const handleTestConfirm = async () => {
    if (!pendingModel || !onTestChatModelAbility || !formValues) {
      // If no test function provided, just update the model
      onChange({ ...value, lg: pendingModel, ability: {} });
      setShowTestModal(false);
      setPendingModel('');
      return;
    }

    setIsTestingModel(true);

    try {
      // Use pendingModel instead of value.lg for testing the newly selected model
      const testResult = await onTestChatModelAbility({ ...value, lg: pendingModel });

      // Update model with test results
      onChange({
        ...value,
        lg: pendingModel,
        ability: testResult || {},
      });

      // Check if image or pdf capabilities are missing and show warning toast [[memory:6422115]]
      if (
        testResult &&
        !isAbilitySupported(testResult.image) &&
        !isAbilitySupported(testResult.pdf)
      ) {
        toast.warning(t('admin.setting.ai.chatModelTest.missingCapabilitiesWarning'));
      }

      // After test completion, check if AI is enabled and show enable modal if needed
      if (!formValues.enable) {
        setShowTestModal(false);
        setShowEnableAIModal(true);
        return;
      }
    } catch (error) {
      console.error('Model test failed:', error);
      // Still update the model even if test fails
      onChange({ ...value, lg: pendingModel, ability: {} });

      // Even if test failed, still check if AI needs to be enabled
      if (!formValues.enable) {
        setShowTestModal(false);
        setShowEnableAIModal(true);
        return;
      }
    } finally {
      setIsTestingModel(false);
    }

    setShowTestModal(false);
    setPendingModel('');
  };

  const handleTestCancel = () => {
    setShowTestModal(false);
    setPendingModel('');
  };

  const handleEnableAIConfirm = () => {
    // Enable AI after test completion
    onEnableAI?.();

    // Close the enable AI modal and clear pending state
    setShowEnableAIModal(false);
    setPendingModel('');
  };

  const handleEnableAICancel = () => {
    // Don't enable AI, just close modal and clear pending state
    setShowEnableAIModal(false);
    setPendingModel('');
  };

  const icons = useMemo(() => {
    return {
      sm: <Zap className="size-4 text-emerald-500" />,
      md: <Code className="size-4 text-blue-500" />,
      lg: <Cpu className="size-4 text-purple-500" />,
    };
  }, []);

  const [testChatModelAbilityLoading, setTestChatModelAbilityLoading] = useState(false);

  const testChatModelAbility = async (data: IAIIntegrationConfig['chatModel']) => {
    if (testChatModelAbilityLoading) {
      return;
    }
    if (!data?.lg) {
      toast.error(t(`admin.setting.ai.chatModelTest.notConfigLgModel`));
      return;
    }
    setTestChatModelAbilityLoading(true);
    try {
      const res = await onTestChatModelAbility?.(data);
      setTestChatModelAbilityLoading(false);
      return res;
    } catch (error) {
      setTestChatModelAbilityLoading(false);
      throw error;
    }
  };

  // Check if model has missing critical abilities
  const hasMissingAbilities = useMemo(() => {
    if (!value?.lg || !value?.ability) return false;
    const ability = value.ability;
    // Model should support at least image OR pdf, AND toolCall
    const hasVision = isAbilitySupported(ability.image) || isAbilitySupported(ability.pdf);
    const hasToolCall = isAbilitySupported(ability.toolCall);
    return !hasVision || !hasToolCall;
  }, [value?.lg, value?.ability]);

  const getMissingAbilitiesMessage = useMemo(() => {
    if (!value?.ability) return null;
    const missing: string[] = [];
    if (!isAbilitySupported(value.ability.image) && !isAbilitySupported(value.ability.pdf)) {
      missing.push(t('admin.setting.ai.chatModelAbility.missingVision'));
    }
    if (!isAbilitySupported(value.ability.toolCall)) {
      missing.push(t('admin.setting.ai.chatModelAbility.missingToolCall'));
    }
    return missing;
  }, [value?.ability, t]);

  // Abilities to test and display
  const testableAbilities = chatModelAbilityType.options;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Advanced chat model (lg) - with ability test inline */}
      <div className="relative flex flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2 truncate text-sm">
          {icons.lg}
          <span>{t('admin.setting.ai.chatModels.lg')}</span>
          <div className="h-4 text-red-500">*</div>
        </div>
        <div className="text-left text-xs text-muted-foreground">
          {t('admin.setting.ai.chatModels.lgDescription')}
        </div>

        <AIModelSelect
          value={value?.lg ?? ''}
          onValueChange={handleLgModelChange}
          options={models}
          className="flex-1"
          needGroup={needGroup}
        />

        {/* Model Ability Section - directly under lg model */}
        {value?.lg && (
          <div className="mt-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t('admin.setting.ai.chatModelAbility.lgModelAbility')}
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={testChatModelAbilityLoading}
                onClick={async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (testChatModelAbilityLoading) return;
                  const res = await testChatModelAbility(value);
                  onChange({ ...value, ability: res || {} });
                }}
              >
                {testChatModelAbilityLoading ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : null}
                {t('admin.setting.ai.chatModelTest.text')}
              </Button>
            </div>

            {/* Ability badges */}
            <div className="mt-3 flex flex-wrap gap-2">
              <TooltipProvider>
                {testableAbilities.map((type) => {
                  const abilityValue = value?.ability?.[type];
                  const supported = isAbilitySupported(abilityValue);
                  const supportDetails = getAbilitySupportDetails(abilityValue);

                  const badge = (
                    <div
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                        supported
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
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

      {/* Medium and Small chat models */}
      {(['md', 'sm'] as const).map((key) => (
        <div key={key} className="relative flex flex-col gap-2">
          <div className="flex shrink-0 items-center gap-2 truncate text-sm">
            {icons[key]}
            <span>{t(`admin.setting.ai.chatModels.${key}`)}</span>
          </div>
          <div className="text-left text-xs text-muted-foreground">
            {t(`admin.setting.ai.chatModels.${key}Description`)}
          </div>

          <AIModelSelect
            value={value?.[key] ?? ''}
            onValueChange={(model) => onChange({ ...value, [key]: model })}
            options={models}
            className="flex-1"
            needGroup={needGroup}
          />
        </div>
      ))}

      <ConfirmDialog
        open={showTestModal}
        onOpenChange={setShowTestModal}
        title={t('admin.setting.ai.chatModelTest.confirmTitle')}
        description={t('admin.setting.ai.chatModelTest.confirmDescription')}
        confirmText={t('admin.setting.ai.chatModelTest.confirm')}
        cancelText={t('admin.setting.ai.chatModelTest.cancel')}
        confirmLoading={isTestingModel}
        onConfirm={handleTestConfirm}
        onCancel={handleTestCancel}
      />

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
