import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from '@teable/icons';
import type { IUpdatePluginRo } from '@teable/openapi';
import {
  getPlugin,
  pluginRegenerateSecret,
  PluginStatus,
  submitPlugin,
  updatePlugin,
  updatePluginRoSchema,
} from '@teable/openapi';
import { UserAvatar } from '@teable/sdk/components';
import { Spin } from '@teable/ui-lib';
import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { Send } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMount } from 'react-use';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';
import { FormPageLayout } from '../components/FormPageLayout';
import { RequireCom } from '../components/RequireCom';
import { JsonEditor } from './component/JsonEditor';
import { LogoEditor } from './component/LogoEditor';
import { NewSecret } from './component/NewSecret';
import { PositionSelector } from './component/PositionSelector';
import { StatusBadge } from './component/StatusBadge';
import { MarkDownEditor } from './MarkDownEditor';

export const PluginEdit = (props: { secret?: string }) => {
  const router = useRouter();
  const pluginId = router.query.id as string;
  const queryClient = useQueryClient();
  const [newSecret, setNewSecret] = useState<string | undefined>(props.secret);
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const secretRef = useRef<HTMLDivElement>(null);

  useMount(() => {
    secretRef.current?.scrollIntoView({ block: 'center', inline: 'start' });
  });

  const { data: initFormValue } = useQuery({
    queryKey: ['plugin', pluginId],
    queryFn: () => getPlugin(pluginId).then((res) => res.data),
    enabled: !!pluginId,
  });

  const form = useForm<IUpdatePluginRo>({
    resolver: zodResolver(updatePluginRoSchema),
    mode: 'onChange',
    values: initFormValue,
  });

  const { mutate } = useMutation({
    mutationFn: (ro: IUpdatePluginRo) => updatePlugin(pluginId, ro),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugin', pluginId] });
      router.push({ pathname: router.pathname });
    },
  });

  const { mutate: regenerateSecret } = useMutation({
    mutationFn: pluginRegenerateSecret,
    onSuccess: (res) => {
      setNewSecret(res.data.secret);
      queryClient.invalidateQueries({ queryKey: ['plugin', pluginId] });
    },
  });

  const { mutate: submitApproved, isLoading: submitApprovedLoading } = useMutation({
    mutationFn: submitPlugin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugin', pluginId] });
    },
  });

  const onSubmit = async (data: IUpdatePluginRo) => {
    mutate(data);
  };

  const pluginUser = initFormValue?.pluginUser;

  return (
    <FormPageLayout
      onSubmit={form.handleSubmit(onSubmit)}
      onCancel={() => router.push({ pathname: router.pathname })}
    >
      {initFormValue?.status && (
        <div className="absolute right-10 flex items-center gap-2 bg-background">
          <StatusBadge status={initFormValue.status} />
          {initFormValue.status === PluginStatus.Developing && (
            <Button
              className="h-[22px]"
              size={'xs'}
              variant={'outline'}
              disabled={submitApprovedLoading}
              onClick={() => {
                submitApproved(pluginId);
              }}
            >
              {submitApprovedLoading ? <Spin /> : <Send className="text-green-500" size={12} />}
              {t('plugin:button.submitApproved')}
            </Button>
          )}
        </div>
      )}
      <div className="space-y-2">
        <NewSecret secret={newSecret} ref={secretRef} />
        <div>
          {pluginUser && (
            <div className="space-y-2">
              <Label>{t('plugin:pluginUser.name')}</Label>
              <div className="text-xs text-muted-foreground">
                {t('plugin:pluginUser.description')}
              </div>
              <div className="flex items-center gap-2">
                <UserAvatar avatar={pluginUser.avatar} name={pluginUser.name} />
                <div className="text-sm font-normal">{pluginUser.name}</div>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>
            {t('plugin:secret')}
            <Button
              className="ml-2 h-auto p-1.5"
              title={t('plugin:regenerateSecret')}
              size={'xs'}
              variant={'outline'}
              onClick={() => regenerateSecret(pluginId)}
            >
              <RefreshCcw />
            </Button>
          </Label>
          <div className="text-sm font-normal">{initFormValue?.secret}</div>
        </div>
      </div>
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
        </form>
      </Form>
    </FormPageLayout>
  );
};
