'use client';

import type { IGatewayModel, ISettingVo, LLMProvider } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

export interface IAISetupStep {
  id: string;
  title: string;
  description: string;
  isComplete: boolean;
  isRequired: boolean;
}

interface IAISetupWizardProps {
  children: ReactNode;
}

export function AISetupWizard({ children }: IAISetupWizardProps) {
  // Keep a stable wrapper for future layout needs.
  useMemo(() => children, [children]);
  return <div className="min-w-0">{children}</div>;
}

export type LLMApiMode = 'gateway' | 'custom';

// Hook to compute step completion status
export function useAISetupSteps({
  aiConfig,
  gatewayModels,
  llmProviders,
  llmApiMode = 'gateway',
}: {
  aiConfig?: ISettingVo['aiConfig'];
  gatewayModels: IGatewayModel[];
  llmProviders: LLMProvider[];
  llmApiMode?: LLMApiMode;
}) {
  const { t } = useTranslation('common');

  const hasGatewayKey = Boolean(aiConfig?.aiGatewayApiKey);
  const hasGatewayModels = gatewayModels.filter((m) => m.enabled).length > 0;
  const hasChatModel = Boolean(aiConfig?.chatModel?.lg);
  const hasProviders = llmProviders.length > 0;

  // Step 1 is complete if:
  // - Gateway mode: has Gateway API Key
  // - Custom mode: has at least one Provider configured
  const isStep1Complete = llmApiMode === 'gateway' ? hasGatewayKey : hasProviders;

  // Step 2 is complete if:
  // - Gateway mode: has Gateway models
  // - Custom mode: has provider models (auto-complete since providers bring models)
  const isStep2Complete = llmApiMode === 'gateway' ? hasGatewayModels : hasProviders;

  // Unified 3-step structure for both Cloud and EE
  // Only difference is pricing-related UI which is controlled separately
  const steps: IAISetupStep[] = useMemo(() => {
    return [
      {
        id: 'llmApi',
        title: t('admin.setting.ai.wizard.step.llmApi'),
        description: t('admin.setting.ai.wizard.step.llmApiDesc'),
        isComplete: isStep1Complete,
        isRequired: true,
      },
      {
        id: 'models',
        title: t('admin.setting.ai.wizard.step.modelPool'),
        description: t('admin.setting.ai.wizard.step.modelPoolDesc'),
        isComplete: isStep2Complete,
        isRequired: true,
      },
      {
        id: 'chatModel',
        title: t('admin.setting.ai.wizard.step.chatModel'),
        description: t('admin.setting.ai.wizard.step.chatModelDesc'),
        isComplete: hasChatModel,
        isRequired: true,
      },
    ];
  }, [isStep1Complete, isStep2Complete, hasChatModel, t]);

  return { steps, hasGatewayKey, hasGatewayModels, hasChatModel, isStep1Complete, isStep2Complete };
}
