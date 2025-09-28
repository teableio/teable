import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import type { IMailTransportConfig, ITestMailTransportConfigRo } from '@teable/openapi';
import { mailTransportConfigSchema, testMailTransportConfig, z } from '@teable/openapi';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  Switch,
  Form,
  Input,
  Button,
  FormDescription,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { SendIcon } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export const MailConfigForm = (props: {
  value?: IMailTransportConfig;
  onChange: (value?: IMailTransportConfig) => void;
}) => {
  const { t } = useTranslation('common');
  const { onChange } = props;
  const defaultValues = useMemo(
    () =>
      props.value ?? {
        senderName: '',
        sender: '',
        host: '',
        port: 0,
        secure: false,
        auth: {
          user: '',
          pass: '',
        },
      },
    [props.value]
  );

  const form = useForm<IMailTransportConfig>({
    resolver: zodResolver(mailTransportConfigSchema),
    defaultValues: defaultValues,
  });
  const { reset } = form;

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const [testEmail, setTestEmail] = useState<string | null>(null);

  const { mutateAsync: testEmailConfig } = useMutation({
    mutationFn: (ro: ITestMailTransportConfigRo) => testMailTransportConfig(ro),
    onSuccess: () => {
      toast.success(t('email.testEmailSend'));
    },
  });

  const testEmailSend = async () => {
    if (!testEmail) {
      return;
    }

    const transporter = form.getValues();
    const checkTransporter = mailTransportConfigSchema.safeParse(transporter);
    if (!checkTransporter.success) {
      toast.error(t('email.testEmailError'));
      return;
    }

    const checkTestEmail = z.string().email().safeParse(testEmail);
    if (!checkTestEmail.success) {
      toast.error(t('email.configError'));
      return;
    }
    await testEmailConfig({
      to: testEmail,
      transportConfig: transporter,
    });
  };

  const onSubmit = () => {
    onChange(form.getValues());
  };

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="host"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <div>
              <FormLabel className="text-sm font-medium">{t('email.host')}</FormLabel>
              <FormDescription className="text-sm text-muted-foreground">
                {t('email.hostDescription')}
              </FormDescription>
            </div>

            <FormControl>
              <Input
                value={field.value}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="port"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium">{t('email.port')}</FormLabel>
            <FormControl>
              <Input
                type="number"
                value={field.value || undefined}
                onChange={(e) => {
                  field.onChange(Number(e.target.value));
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="secure"
        render={({ field }) => (
          <FormItem className="flex items-center justify-between space-y-2">
            <FormLabel className="text-sm font-medium">{t('email.secure')}</FormLabel>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="auth.user"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium">{t('email.username')}</FormLabel>
            <FormControl>
              <Input
                value={field.value}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="auth.pass"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium">{t('email.password')}</FormLabel>
            <FormControl>
              <Input
                type="password"
                value={field.value}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="sender"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium">{t('email.sender')}</FormLabel>
            <FormControl>
              <Input
                value={field.value}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="senderName"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-sm font-medium">{t('email.senderName')}</FormLabel>
            <FormControl>
              <Input
                value={field.value}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  onSubmit();
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <div className="mt-2 flex items-center gap-2">
        <Input
          className="flex-1"
          type="email"
          value={testEmail ?? ''}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder={t('email.testEmailPlaceholder')}
        />
        <Button variant="outline" onClick={testEmailSend} disabled={!testEmail}>
          <SendIcon className="size-4" />
          {t('email.send')}
        </Button>
      </div>
    </Form>
  );
};
