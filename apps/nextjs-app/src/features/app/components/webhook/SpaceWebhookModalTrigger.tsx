import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { webhookConfig } from '@/features/i18n/webhook.config';
import { SpaceWebhookModal } from './SpaceWebhookModal';

interface ISpaceWebhookModalTrigger {
  query: string;
  spaceId: string;
}

export const SpaceWebhookModalTrigger: React.FC<
  React.PropsWithChildren<ISpaceWebhookModalTrigger>
> = (props) => {
  const { children, spaceId } = props;
  const { t } = useTranslation(webhookConfig.i18nNamespaces);
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[90%] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('webhook:form.addWebhook')}</DialogTitle>
        </DialogHeader>
        <SpaceWebhookModal spaceId={spaceId} />
      </DialogContent>
    </Dialog>
  );
};
