import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPluginPanel, z } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Error, Spin } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Input,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { usePluginPanelStorage } from '../hooks/usePluginPanelStorage';

interface ICreatePluginPanelDialogProps {
  tableId: string;
  children: React.ReactNode;
  onClose?: () => void;
}

export interface ICreatePluginPanelDialogRef {
  open: () => void;
  close: () => void;
}

export const CreatePluginPanelDialog = forwardRef<
  ICreatePluginPanelDialogRef,
  ICreatePluginPanelDialogProps
>((props, ref) => {
  const { tableId, children, onClose } = props;
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const queryClient = useQueryClient();
  const { touchActivePanel } = usePluginPanelStorage(tableId);
  const { mutate: createPluginPanelMutate, isLoading } = useMutation({
    mutationFn: (name: string) => createPluginPanel(tableId, { name }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getPluginPanelList(tableId),
      });
      setOpen(false);
      onClose?.();
      touchActivePanel(data.id);
    },
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
    },
    close: () => {
      setOpen(false);
    },
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>{t('table:pluginPanel.createPluginPanel.title')}</DialogHeader>
        <div>
          <Input
            placeholder={t('table:pluginPanel.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setError(undefined);
              setName(e.target.value);
            }}
          />
          <Error error={error} />
        </div>
        <DialogFooter>
          <Button
            size={'sm'}
            disabled={isLoading}
            onClick={() => {
              const valid = z
                .string()
                .min(1)
                .safeParse(name || undefined);
              if (!valid.success) {
                setError(valid.error.errors?.[0].message);
                return;
              }
              createPluginPanelMutate(name);
            }}
          >
            {isLoading && <Spin className="size-4" />}
            {t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

CreatePluginPanelDialog.displayName = 'CreatePluginPanelDialog';
