import { Loader2, Image, File } from '@teable/icons';
import {
  chatModelAbilityType,
  type IAIIntegrationConfig,
  type IChatModelAbility,
} from '@teable/openapi';
import type { ISettingVo } from '@teable/openapi/src/admin/setting/get';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Cpu, Code, Zap, Globe } from 'lucide-react';
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

  const iconMap = useMemo(() => {
    return {
      image: <Image className="size-4" />,
      pdf: <File className="size-4" />,
      webSearch: <Globe className="size-4" />,
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
    try {
      const res = await onTestChatModelAbility?.(data);
      setTestChatModelAbilityLoading(false);
      return res;
    } catch (error) {
      setTestChatModelAbilityLoading(false);
      throw error;
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {(['lg', 'md', 'sm'] as const).map((key) => (
        <div key={key} className="relative flex flex-col gap-2">
          <div className="flex shrink-0 items-center gap-2 truncate text-sm">
            {icons[key]}
            <span>{t(`admin.setting.ai.chatModels.${key}`)}</span>
            {key === 'lg' && <div className="h-4 text-red-500">*</div>}
          </div>
          <div className="text-left text-xs text-zinc-500">
            {t(`admin.setting.ai.chatModels.${key}Description`)}
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
        <div className="flex flex-1 flex-col items-center justify-between gap-4 pt-2">
          <div className="flex w-full shrink-0 items-center justify-between gap-2 truncate text-sm">
            <span>{t('admin.setting.ai.chatModelAbility.lgModelAbility')}</span>

            <div className="flex items-center gap-2">
              <Button
                size="xs"
                className="relative ml-2 min-w-32"
                variant="outline"
                onClick={async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (testChatModelAbilityLoading) {
                    return;
                  }
                  const res = await testChatModelAbility(value);
                  onChange({ ...value, ability: res || {} });
                }}
              >
                {testChatModelAbilityLoading && (
                  <Loader2 className="absolute size-4 animate-spin" />
                )}
                <span
                  className={cn({
                    'opacity-40': testChatModelAbilityLoading,
                  })}
                >
                  {t(`admin.setting.ai.chatModelTest.text`)}
                </span>
              </Button>
            </div>
          </div>

          <div className="flex w-full items-center gap-2">
            {Object.values(chatModelAbilityType.Values)
              .filter((type) => type !== 'webSearch')
              .map((type) => (
                <Button
                  key={type}
                  variant="outline"
                  size="sm"
                  className="flex w-full items-center gap-1 rounded-md border px-1 py-0.5 text-xs"
                  disabled={!value?.ability?.[type]}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  {iconMap[type]}
                  <span>{t(`admin.setting.ai.chatModelAbility.${type}`)}</span>
                </Button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
