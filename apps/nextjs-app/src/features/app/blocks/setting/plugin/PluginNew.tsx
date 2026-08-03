import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import type { ICreatePluginRo } from '@teable/openapi';
import { createPlugin, createPluginRoSchema } from '@teable/openapi';
import {
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';
import { FormPageLayout } from '../components/FormPageLayout';
import { RequireCom } from '../components/RequireCom';
import { JsonEditor } from './component/JsonEditor';
import { LogoEditor } from './component/LogoEditor';
import { PositionSelector } from './component/PositionSelector';
import { MarkDownEditor } from './MarkDownEditor';

export const PluginNew = (props: { onCreated?: (secret: string) => void }) => {
  const { onCreated } = props;
  const router = useRouter();
  const form = useForm<ICreatePluginRo>({
    resolver: zodResolver(createPluginRoSchema),
  });
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);

  const { mutate } = useMutation({
    mutationFn: createPlugin,
    onSuccess: (res) => {
      router.push({
        pathname: router.pathname,
        query: { form: 'edit', id: res.data.id },
      });
      onCreated?.(res.data.secret);
    },
  });
  const onSubmit = async (data: ICreatePluginRo) => {
    mutate(data);
  };

  return (
    <FormPageLayout
      onSubmit={form.handleSubmit(onSubmit)}
      onCancel={() => router.push({ pathname: router.pathname })}
    >
      <Form {...form}>
        <form className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('plugin:form.name.label')}
                  <RequireCom />
                </FormLabel>
                <FormDescription>{t('plugin:form.name.description')}</FormDescription>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.description.label')}</FormLabel>
                <FormDescription>{t('plugin:form.description.description')}</FormDescription>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="detailDesc"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.detailDesc.label')}</FormLabel>
                <FormDescription>{t('plugin:form.detailDesc.description')}</FormDescription>
                <FormControl>
                  <MarkDownEditor value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('plugin:form.logo.label')}
                  <RequireCom />
                </FormLabel>
                <FormDescription>{t('plugin:form.logo.description')}</FormDescription>
                <FormControl>
                  <LogoEditor value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="helpUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.helpUrl.label')}</FormLabel>
                <FormDescription>{t('plugin:form.helpUrl.description')}</FormDescription>
                <FormControl>
                  <Input {...field} onChange={(e) => field.onChange(e.target.value || undefined)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="positions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('plugin:form.positions.label')}
                  <RequireCom />
                </FormLabel>
                <FormDescription>{t('plugin:form.positions.description')}</FormDescription>
                <FormControl>
                  <PositionSelector value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="config"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.config.label')}</FormLabel>
                <FormDescription>{t('plugin:form.config.description')}</FormDescription>
                <FormControl>
                  <JsonEditor value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="i18n"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.i18n.label')}</FormLabel>
                <FormDescription>{t('plugin:form.i18n.description')}</FormDescription>
                <FormControl>
                  <JsonEditor value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.url.label')}</FormLabel>
                <FormDescription>{t('plugin:form.url.description')}</FormDescription>
                <FormControl>
                  <Input value={field.value ?? ''} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="autoCreateMember"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('plugin:form.autoCreateMember.label')}</FormLabel>
                <FormDescription>{t('plugin:form.autoCreateMember.description')}</FormDescription>
                <FormControl>
                  <Checkbox
                    checked={field.value ?? false}
                    onCheckedChange={(checked) => field.onChange(checked ?? false)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </FormPageLayout>
  );
};
