import { useMutation } from '@tanstack/react-query';
import { Database, LayoutTemplate } from '@teable/icons';
import { createBase } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { getTemplateCenterLink } from '@/lib/off-site-link';

export const CreateBaseModalTrigger = ({
  spaceId,
  children,
}: {
  spaceId: string;
  children: ReactNode;
}) => {
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();
  const { mutate: createBaseMutator, isLoading: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });
  const templateCenterLink = getTemplateCenterLink();

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('space:baseModal.howToCreate')}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-around pt-4">
          <Button
            className="flex h-auto grow flex-col items-center gap-4 border-r"
            variant="ghost"
            onClick={() => createBaseMutator({ spaceId })}
            disabled={createBaseLoading}
          >
            <Database className="size-8" />
            {t('space:baseModal.fromScratch')}
          </Button>
          <Button
            asChild
            className="flex h-auto grow flex-col items-center gap-4"
            variant="ghost"
            disabled={!templateCenterLink}
          >
            <a href={templateCenterLink}>
              <LayoutTemplate className="size-8" />
              {t('space:baseModal.fromTemplate')}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};