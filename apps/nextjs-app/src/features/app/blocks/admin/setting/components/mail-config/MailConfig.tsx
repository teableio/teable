import { useMutation } from '@tanstack/react-query';
import type {
  IMailTransportConfig,
  SettingKey,
  ISetSettingMailTransportConfigRo,
} from '@teable/openapi';
import { mailTransportConfigSchema, setSettingMailTransportConfig } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { PencilIcon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MailConfigForm } from './MailConfigForm';

export const MailConfigDialog = (props: {
  name: SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG | SettingKey.AUTOMATION_MAIL_TRANSPORT_CONFIG;
  emailConfig?: IMailTransportConfig;
}) => {
  const { t } = useTranslation('common');

  const [open, setOpen] = useState(false);
  const [emailConfig, setEmailConfig] = useState<IMailTransportConfig | undefined>(
    props.emailConfig
  );

  useEffect(() => {
    setEmailConfig(props.emailConfig);
  }, [props.emailConfig]);

  const { mutateAsync: updateEmailConfig } = useMutation({
    mutationFn: (ro: ISetSettingMailTransportConfigRo) => setSettingMailTransportConfig(ro),
  });

  const cancel = () => {
    setOpen(false);
  };

  const save = async () => {
    if (emailConfig && mailTransportConfigSchema.safeParse(emailConfig).success) {
      await updateEmailConfig({
        name: props.name,
        transportConfig: emailConfig,
      });
      setOpen(false);
    } else {
      toast.error(t('email.configError'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          {props.emailConfig ? <PencilIcon className="size-4" /> : <PlusIcon className="size-4" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="px-1">
          <DialogTitle>{t('email.config')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-1">
          <MailConfigForm value={emailConfig} onChange={setEmailConfig} />
        </div>
        <DialogFooter className="flex justify-end px-1">
          <Button variant="secondary" onClick={cancel}>
            {t('actions.cancel')}
          </Button>
          <Button variant="default" onClick={save}>
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
