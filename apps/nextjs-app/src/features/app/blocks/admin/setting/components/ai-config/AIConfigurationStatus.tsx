import { CheckCircle2, Circle, AlertCircle, ChevronRight } from '@teable/icons';
import type { ISettingVo } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

export type ConfigStatus = 'complete' | 'incomplete' | 'warning';

export interface IConfigCheckItem {
  id: string;
  label: string;
  status: ConfigStatus;
  description?: string;
  onClick?: () => void;
}

interface IAIConfigurationStatusProps {
  aiConfig: ISettingVo['aiConfig'];
  onNavigate?: (section: string) => void;
}

export const AIConfigurationStatus = ({ aiConfig, onNavigate }: IAIConfigurationStatusProps) => {
  const { t } = useTranslation('common');

  const hasGatewayKey = Boolean(aiConfig?.aiGatewayApiKey);
  const hasGatewayModels = (aiConfig?.gatewayModels?.filter((m) => m.enabled)?.length ?? 0) > 0;
  const hasLegacyProviders = (aiConfig?.llmProviders?.length ?? 0) > 0;
  const hasChatModel = Boolean(aiConfig?.chatModel?.lg);
  const isEnabled = Boolean(aiConfig?.enable);

  // Check if chat model is a gateway model
  const chatModelIsGateway = useMemo(() => {
    if (!aiConfig?.chatModel?.lg) return false;
    const [type] = aiConfig.chatModel.lg.split('@');
    return type === LLMProviderType.AI_GATEWAY;
  }, [aiConfig?.chatModel?.lg]);

  // Determine overall mode
  const mode = useMemo(() => {
    if (hasGatewayKey && hasGatewayModels && !hasLegacyProviders) return 'gateway';
    if (!hasGatewayKey && hasLegacyProviders) return 'provider';
    if (hasGatewayKey && hasLegacyProviders) return 'hybrid';
    return 'unconfigured';
  }, [hasGatewayKey, hasGatewayModels, hasLegacyProviders]);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const checkItems: IConfigCheckItem[] = useMemo(() => {
    const items: IConfigCheckItem[] = [];

    // AI Enabled
    items.push({
      id: 'ai-enabled',
      label: t('admin.setting.ai.guide.aiEnabled'),
      status: isEnabled ? 'complete' : 'incomplete',
      description: isEnabled
        ? t('admin.setting.ai.guide.aiEnabledDesc')
        : t('admin.setting.ai.guide.aiDisabledDesc'),
      onClick: () => onNavigate?.('enable'),
    });

    // Gateway Configuration (if using gateway or hybrid)
    if (hasGatewayKey || mode === 'unconfigured') {
      items.push({
        id: 'gateway-key',
        label: t('admin.setting.ai.guide.gatewayKey'),
        status: hasGatewayKey ? 'complete' : 'incomplete',
        description: hasGatewayKey
          ? t('admin.setting.ai.guide.gatewayKeyConfigured')
          : t('admin.setting.ai.guide.gatewayKeyMissing'),
        onClick: () => onNavigate?.('gateway'),
      });

      if (hasGatewayKey) {
        items.push({
          id: 'gateway-models',
          label: t('admin.setting.ai.guide.gatewayModels'),
          status: hasGatewayModels ? 'complete' : 'warning',
          description: hasGatewayModels
            ? t('admin.setting.ai.guide.gatewayModelsConfigured', {
                count: aiConfig?.gatewayModels?.filter((m) => m.enabled)?.length ?? 0,
              })
            : t('admin.setting.ai.guide.gatewayModelsEmpty'),
          onClick: () => onNavigate?.('gateway-models'),
        });
      }
    }

    // Legacy Providers (if using provider or hybrid)
    if (hasLegacyProviders || mode === 'unconfigured') {
      items.push({
        id: 'providers',
        label: t('admin.setting.ai.guide.providers'),
        status: hasLegacyProviders ? 'complete' : 'incomplete',
        description: hasLegacyProviders
          ? t('admin.setting.ai.guide.providersConfigured', {
              count: aiConfig?.llmProviders?.length ?? 0,
            })
          : t('admin.setting.ai.guide.providersEmpty'),
        onClick: () => onNavigate?.('providers'),
      });
    }

    // Chat Model
    items.push({
      id: 'chat-model',
      label: t('admin.setting.ai.guide.chatModel'),
      status: hasChatModel ? 'complete' : 'incomplete',
      description: hasChatModel
        ? chatModelIsGateway
          ? t('admin.setting.ai.guide.chatModelGateway')
          : t('admin.setting.ai.guide.chatModelProvider')
        : t('admin.setting.ai.guide.chatModelMissing'),
      onClick: () => onNavigate?.('chat-model'),
    });

    return items;
  }, [
    t,
    isEnabled,
    hasGatewayKey,
    hasGatewayModels,
    hasLegacyProviders,
    hasChatModel,
    chatModelIsGateway,
    mode,
    aiConfig?.gatewayModels,
    aiConfig?.llmProviders?.length,
    onNavigate,
  ]);

  const allComplete = checkItems.every((item) => item.status === 'complete');
  const hasWarning = checkItems.some((item) => item.status === 'warning');

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {t('admin.setting.ai.guide.configStatus')}
        </h3>
        <div
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            allComplete && !hasWarning
              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500'
              : hasWarning
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}
        >
          {allComplete && !hasWarning
            ? t('admin.setting.ai.guide.ready')
            : hasWarning
              ? t('admin.setting.ai.guide.needsAttention')
              : t('admin.setting.ai.guide.incomplete')}
        </div>
      </div>

      <div className="space-y-2">
        {checkItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className={cn(
              'flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors',
              item.onClick && 'hover:bg-muted/50 cursor-pointer'
            )}
          >
            <div className="shrink-0">
              {item.status === 'complete' ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : item.status === 'warning' ? (
                <AlertCircle className="size-4 text-amber-500" />
              ) : (
                <Circle className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{item.label}</div>
              {item.description && (
                <div className="truncate text-xs text-muted-foreground">{item.description}</div>
              )}
            </div>
            {item.onClick && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </div>
  );
};
