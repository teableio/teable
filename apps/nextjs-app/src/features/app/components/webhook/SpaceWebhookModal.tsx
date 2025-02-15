import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import type { ICreateWebhookRo } from '@teable/openapi';
import { ContentType, createWebhook, createWebhookRoSchema } from '@teable/openapi';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import { FormEventsField } from '@/features/app/components/webhook/FormEventsField';
import { webhookConfig } from '@/features/i18n/webhook.config';
import { defaultEvents } from '@/features/tempfile';

const defaultValues: Partial<ICreateWebhookRo> = {
  contentType: ContentType.Json,
  events: defaultEvents,
  isEnabled: true,
};

interface ISpaceWebhookModal {
  spaceId: string;
}

export const SpaceWebhookModal: React.FC<ISpaceWebhookModal> = (props) => {
  const { spaceId } = props;
  const { t } = useTranslation(webhookConfig.i18nNamespaces);
  const form = useForm<ICreateWebhookRo>({
    resolver: zodResolver(createWebhookRoSchema),
    defaultValues: {
      ...defaultValues,
      spaceId,
    },
    mode: 'onBlur',
  });

  const { mutate: createWebhookMutate } = useMutation({
    mutationFn: createWebhook,
    onSuccess: () => {
      // todo close modal
    },
  });

  // const { mutate: updateAccessTokenMutate, isLoading: updateAccessTokenLoading } = useMutation({
  //   mutationFn: (updateRo: UpdateAccessTokenRo) => updateWebhook(accessTokenId, updateRo),
  //   onSuccess: async (data) => {
  //     // onSubmit?.(data.data);
  //   },
  // });

  const onSubmit = (data: ICreateWebhookRo) => {
    createWebhookMutate(data);
  };

  return (
    <div className={'flex min-h-0 flex-col'}>
      <div className="pb-2 text-sm text-muted-foreground">{t('webhook:form.webhookDesc')}</div>
      <Separator className="my-2 mb-4" />
      <Form {...form}>
        <div className="overflow-y-auto">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('webhook:form.notificationUrl')}</FormLabel>
                  <FormControl>
                    <Input className="w-96" placeholder="https://teable.cn" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('webhook:form.contentType')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-96">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="application/json">application/json</SelectItem>
                      <SelectItem value="application/x-www-form-urlencoded">
                        application/x-www-form-urlencoded
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="secret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('webhook:form.secret')}</FormLabel>
                  <FormControl>
                    <Input className="w-96" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormEventsField />
            <FormField
              control={form.control}
              name="isEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="cursor-pointer">{t('webhook:form.active')}</FormLabel>
                    <FormDescription>{t('webhook:form.activeDesc')}</FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <Button type="submit">{t('webhook:form.addWebhook')}</Button>
          </form>
        </div>
      </Form>
    </div>
  );
};
