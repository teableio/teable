import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createDashboard, z } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { Error } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Input,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';

interface ICreateDashboardDialogProps {
  children?: React.ReactNode;
  onSuccessCallback?: (dashboardId: string) => void;
}

export interface ICreateDashboardDialogRef {
  open: () => void;
  close: () => void;
}

export const CreateDashboardDialog = forwardRef<
  ICreateDashboardDialogRef,
  ICreateDashboardDialogProps
>(
  (
    props: { children?: React.ReactNode; onSuccessCallback?: (dashboardId: string) => void },
    ref
  ) => {
    const { onSuccessCallback } = props;
    const baseId = useBaseId()!;
    const router = useRouter();
    const [error, setError] = useState<string>();
    const [name, setName] = useState('');
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();
    const { t } = useTranslation(dashboardConfig.i18nNamespaces);

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
    }));

    const { mutate: createDashboardMutate } = useMutation({
      mutationFn: (name: string) => createDashboard(baseId, { name }),
      onSuccess: (res) => {
        setOpen(false);
        setName('');
        queryClient.invalidateQueries(ReactQueryKeys.getDashboardList(baseId));
        router.push(`/base/${baseId}/dashboard?dashboardId=${res.data.id}`);
        if (onSuccessCallback) {
          onSuccessCallback?.(res.data.id);
        }
      },
    });
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{props.children}</DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>{t('dashboard:createDashboard.title')}</DialogHeader>
          <div>
            <Input
              placeholder={t('dashboard:createDashboard.placeholder')}
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
              onClick={() => {
                const valid = z
                  .string()
                  .min(1)
                  .safeParse(name || undefined);
                if (!valid.success) {
                  setError(valid.error.errors?.[0].message);
                  return;
                }
                createDashboardMutate(name);
              }}
            >
              {t('common:actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

CreateDashboardDialog.displayName = 'CreateDashboardDialog';
