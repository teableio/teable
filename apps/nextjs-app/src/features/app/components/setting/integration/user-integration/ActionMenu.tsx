import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from '@teable/icons';
import { deleteUserIntegration } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { Link2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const ActionMenu = (props: {
  name: string;
  integrationId: string;
  onRename?: () => void;
  onReconnect?: () => void;
}) => {
  const { name, integrationId, onRename, onReconnect } = props;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { mutate: deleteIntegrationMutate, isPending: deleteLoading } = useMutation({
    mutationFn: deleteUserIntegration,
    onSuccess: () => {
      setDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getUserIntegrations() });
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="size-8 p-0">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="gap-2" onClick={() => onRename?.()}>
            <Pencil className="size-4" />
            {t('actions.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={() => onReconnect?.()}>
            <Link2 className="size-4" />
            {t('settings.integration.userIntegration.actions.reconnect')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-destructive focus:text-destructive"
            onClick={() => setDeleteConfirm(true)}
          >
            <Trash2 className="size-4" />
            {t('actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={t('settings.integration.userIntegration.deleteTitle')}
        description={t('settings.integration.userIntegration.deleteDesc', { name })}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={() => deleteIntegrationMutate(integrationId)}
        confirmLoading={deleteLoading}
      />
    </>
  );
};
