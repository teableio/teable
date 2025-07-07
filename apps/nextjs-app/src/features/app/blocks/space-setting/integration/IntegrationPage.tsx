import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MagicAi, Plus } from '@teable/icons';
import type { IAIIntegrationConfig, ICreateIntegrationRo, LLMProvider } from '@teable/openapi';
import {
  createIntegration,
  deleteIntegration,
  getIntegrationList,
  IntegrationType,
  testIntegrationLLM,
  updateIntegration,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { SpaceSettingContainer } from '@/features/app/components/SpaceSettingContainer';
import { spaceConfig } from '@/features/i18n/space.config';
import { NewLLMProviderForm } from '../../admin/setting/components/ai-config/LlmProviderForm';
import { AIConfig, IntegrationCard } from './components';

export const IntegrationPage = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const spaceId = router.query.spaceId as string;

  const { data: integrationList } = useQuery({
    queryKey: ReactQueryKeys.getIntegrationList(spaceId),
    queryFn: ({ queryKey }) => getIntegrationList(queryKey[1]).then((res) => res.data),
  });

  const { mutateAsync: createIntegrationMutator } = useMutation({
    mutationFn: (createIntegrationRo: ICreateIntegrationRo) =>
      createIntegration(spaceId, createIntegrationRo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getIntegrationList(spaceId) });
    },
  });

  const { mutateAsync: updateIntegrationMutator } = useMutation({
    mutationFn: ({
      id,
      enable,
      config,
    }: {
      id: string;
      enable?: boolean;
      config?: IAIIntegrationConfig;
    }) => updateIntegration(spaceId, id, { enable, config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getIntegrationList(spaceId) });
    },
  });

  const { mutateAsync: deleteIntegrationMutator } = useMutation({
    mutationFn: (integrationId: string) => deleteIntegration(spaceId, integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getIntegrationList(spaceId) });
    },
  });

  const definedIntegrationList = useMemo(() => {
    return [
      {
        type: IntegrationType.AI,
        name: t('space:integration.ai'),
        Icon: MagicAi,
      },
    ];
  }, [t]);

  const onCreateIntegration = (config: LLMProvider) => {
    const aiConfig: ICreateIntegrationRo = {
      type: IntegrationType.AI,
      config: {
        llmProviders: [config],
      },
    };

    if (!integrationList?.find(({ type }) => type === IntegrationType.AI)) {
      aiConfig.enable = true;
    }

    createIntegrationMutator(aiConfig);
  };

  const onConfigUpdate = (id: string, config: IAIIntegrationConfig) => {
    updateIntegrationMutator({
      id,
      config,
    });
  };

  const onEnableUpdate = (id: string, enable: boolean) => {
    updateIntegrationMutator({
      id,
      enable,
    });
  };

  const onTest = async (data: Required<LLMProvider>) => testIntegrationLLM(spaceId, data);

  return (
    <SpaceSettingContainer
      title={t('space:integration.title')}
      description={t('space:integration.description')}
    >
      <div className="w-full @container/integration">
        <div className="flex items-center justify-end py-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button>
                <Plus className="size-4" />
                {t('space:integration.addIntegration')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 overflow-hidden p-0">
              <div className="flex max-h-56 flex-col overflow-y-auto">
                {definedIntegrationList.map((integration) => {
                  const { type, name, Icon } = integration;

                  if (type === IntegrationType.AI) {
                    return (
                      <NewLLMProviderForm onAdd={onCreateIntegration} key={type} onTest={onTest}>
                        <Button
                          variant="ghost"
                          className="flex cursor-pointer items-center gap-2 p-2 hover:bg-gray-100"
                        >
                          <Icon className="size-4 text-amber-500" />
                          {name}
                        </Button>
                      </NewLLMProviderForm>
                    );
                  }
                  return (
                    <Button
                      key={type}
                      variant="ghost"
                      className="flex cursor-pointer items-center gap-2 p-2 hover:bg-gray-100"
                    >
                      <Icon className="size-4" />
                      {name}
                    </Button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="grid w-full grid-cols-1 gap-4 @3xl/integration:grid-cols-2 @7xl/integration:grid-cols-3">
          {integrationList?.map((integration) => {
            const { id, enable, config } = integration;
            return (
              <IntegrationCard
                key={id}
                title={definedIntegrationList.find((i) => i.type === integration.type)?.name}
                enable={enable}
                config={config}
                onCheckedChange={(checked) => onEnableUpdate(id, checked)}
                onDelete={() => deleteIntegrationMutator(id)}
              >
                <AIConfig config={config} onChange={(value) => onConfigUpdate(id, value)} />
              </IntegrationCard>
            );
          })}
        </div>
      </div>
    </SpaceSettingContainer>
  );
};
