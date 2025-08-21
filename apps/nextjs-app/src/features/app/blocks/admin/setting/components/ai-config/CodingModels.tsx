import { Loader2 } from '@teable/icons';
import {
  chatModelAbilityType,
  type IAIIntegrationConfig,
  type IChatModelAbility,
} from '@teable/openapi';
import type { ISettingVo } from '@teable/openapi/src/admin/setting/get';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
  Tooltip as ShadTooltip,
  Button,
  cn,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Cpu, Code, Zap } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { AIModelSelect, type IModelOption } from './AiModelSelect';

export const CodingModels = ({
  value,
  onChange,
  formValues,
  models,
  onTestChatModelAbility,
  onEnableAI,
}: {
  value: IAIIntegrationConfig['chatModel'];
  onChange: (value: IAIIntegrationConfig['chatModel']) => void;
  models?: IModelOption[];
  formValues?: NonNullable<ISettingVo['aiConfig']>;
  onEnableAI?: () => void;
  onTestChatModelAbility?: (
    chatModel: IAIIntegrationConfig['chatModel']
  ) => Promise<IChatModelAbility | undefined>;
}) => {
  const { t } = useTranslation('common');
  const [showTestModal, setShowTestModal] = useState(false);
  const [showEnableAIModal, setShowEnableAIModal] = useState(false);
  const [pendingModel, setPendingModel] = useState<string>('');
  const [isTestingModel, setIsTestingModel] = useState(false);

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
      const testResult = await onTestChatModelAbility(value);

      // Update model with test results
      onChange({
        ...value,
        lg: pendingModel,
        ability: testResult || {},
      });

      // Check if image or pdf capabilities are missing and show warning toast [[memory:6422115]]
      if (testResult && !testResult.image && !testResult.pdf) {
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
    const res = await onTestChatModelAbility?.(data);
    setTestChatModelAbilityLoading(false);
    return res;
  };

  return (
    <div className="flex flex-1 flex-col gap-2">
      {(['lg', 'md', 'sm'] as const).map((key) => (
        <div key={key} className="relative flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 truncate text-sm">
            {icons[key]}
            <Tooltip content={t(`admin.setting.ai.chatModels.${key}Description`)}>
              <span>{t(`admin.setting.ai.chatModels.${key}`)}</span>
            </Tooltip>
            {key === 'lg' && <div className="h-4 text-red-500">*</div>}
          </div>

          <AIModelSelect
            key={key}
            value={value?.[key] ?? ''}
            onValueChange={(model) => {
              if (key === 'lg') {
                handleLgModelChange(model);
              } else {
                onChange({ ...value, [key]: model });
              }
            }}
            options={models}
            className="flex-1"
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
      <div className="flex items-center gap-2">
        <div className="flex w-32 shrink-0 items-center gap-2 truncate text-sm">
          <span>{t('admin.setting.ai.chatModelAbility.lgModelAbility')}</span>
        </div>
        <div className="flex flex-1 items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {Object.values(chatModelAbilityType.Values).map((type) => (
              <div
                key={type}
                className="flex items-center gap-1 rounded-md border px-1 py-0.5 text-xs"
              >
                <span>{value?.ability?.[type] ? '✅' : '❌'}</span>
                <span>{t(`admin.setting.ai.chatModelAbility.${type}`)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              className="relative ml-2"
              variant="outline"
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const res = await testChatModelAbility(value);
                onChange({ ...value, ability: res || {} });
              }}
            >
              {testChatModelAbilityLoading && <Loader2 className="absolute size-4 animate-spin" />}
              <span
                className={cn({
                  'opacity-40': testChatModelAbilityLoading,
                })}
              >
                {t(`admin.setting.ai.chatModelTest.text`)}
              </span>
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!value?.ability?.webSearch}
              onClick={() => {
                onChange({
                  ...value,
                  ability: {
                    ...value?.ability,
                    webSearch: false,
                  },
                });
              }}
            >
              {t('admin.setting.ai.chatModelAbility.disabledWebSearch')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Tooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  return (
    <TooltipProvider>
      <ShadTooltip>
        <TooltipTrigger asChild>
          <div>{children}</div>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>{content}</TooltipContent>
        </TooltipPortal>
      </ShadTooltip>
    </TooltipProvider>
  );
};
