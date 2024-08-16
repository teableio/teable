import type { IRole } from '@teable/core';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { BaseCollaboratorContent } from './BaseCollaboratorContent';

export const BaseCollaboratorModalTrigger = (props: {
  base: {
    id: string;
    name: string;
    role: IRole;
  };
  children: React.ReactNode;
}) => {
  const { children, base } = props;
  const { t } = useTranslation('common');
  const { name } = base;

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[90%] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('invite.base.title', { baseName: name })}</DialogTitle>
        </DialogHeader>
        <BaseCollaboratorContent baseId={base.id} role={base.role} />
      </DialogContent>
    </Dialog>
  );
};
