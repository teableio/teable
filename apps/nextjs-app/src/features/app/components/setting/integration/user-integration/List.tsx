import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateUserIntegrationName } from '@teable/openapi';
import type { UserIntegrationProvider, IUserIntegrationListVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useLanDayjs } from '@teable/sdk/hooks';
import { useState } from 'react';
import { UserIntegrationProviderLogo } from '@/features/app/components/user-integration/ProviderLogo';
import { openConnectIntegration } from '../../../user-integration/utils';
import { ActionMenu } from './ActionMenu';
import { SlackItem } from './provider/SlackItem';
import { Rename } from './Rename';

export const List = (props: { list?: IUserIntegrationListVo['integrations'] }) => {
  const { list } = props;
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string>();
  const dayjs = useLanDayjs();

  const { mutate: updateUserIntegrationNameMutate } = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateUserIntegrationName(id, name),
    onSuccess: () => {
      setEditingId(undefined);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getUserIntegrations() });
    },
  });

  const handleReconnectIntegration = (provider: UserIntegrationProvider, integrationId: string) => {
    openConnectIntegration(provider, {
      integrationId,
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      {list?.map((integration) => (
        <div key={integration.id} className="flex items-center justify-between gap-4 border-t py-3">
          <div className="flex items-center gap-3">
            <UserIntegrationProviderLogo provider={integration.provider} className="size-10" />
            <SlackItem item={integration}>
              <Rename
                name={integration.name}
                setIsEditing={(editing) => setEditingId(editing ? integration.id : undefined)}
                isEditing={integration.id === editingId}
                onNameChange={(name) =>
                  updateUserIntegrationNameMutate({ id: integration.id, name })
                }
              />
            </SlackItem>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="text-xs text-muted-foreground">
              {dayjs(integration.connectedTime).fromNow()}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <ActionMenu
                integrationId={integration.id}
                name={integration.name}
                onRename={() => {
                  setEditingId(integration.id);
                }}
                onReconnect={() => handleReconnectIntegration(integration.provider, integration.id)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
