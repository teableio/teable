/* eslint-disable @typescript-eslint/no-unused-vars */
import { zodResolver } from '@hookform/resolvers/zod';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import { llmProviderSchema, LLMProviderType } from '@teable/openapi/src/admin/setting';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LLM_PROVIDERS } from './constant';

interface ILLMProviderManageProps {
  onAdd: (data: LLMProvider) => void;
}

export const UpdateLLMProviderForm = ({
  value,
  onChange,
  children,
}: LLMProviderFormProps & {
  children?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('common');
  const handleChange = (data: LLMProvider) => {
    onChange?.(data);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('admin.setting.ai.updateLLMProvider')}</DialogTitle>
        </DialogHeader>
        <LLMProviderForm value={value} onChange={handleChange} />
      </DialogContent>
    </Dialog>
  );
};

export const NewLLMProviderForm = ({ onAdd }: ILLMProviderManageProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const handleAdd = (data: LLMProvider) => {
    onAdd(data);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {t('admin.setting.ai.addProvider')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('admin.setting.ai.addProvider')}</DialogTitle>
          <DialogDescription>{t('admin.setting.ai.addProviderDescription')}</DialogDescription>
        </DialogHeader>
        <LLMProviderForm onAdd={handleAdd} />
      </DialogContent>
    </Dialog>
  );
};

interface LLMProviderFormProps {
  value?: LLMProvider;
  onChange?: (value: LLMProvider) => void;
  onAdd?: (data: LLMProvider) => void;
}

export const LLMProviderForm = ({ onAdd, value, onChange }: LLMProviderFormProps) => {
  const { t } = useTranslation();
  const form = useForm<LLMProvider>({
    resolver: zodResolver(llmProviderSchema),
    defaultValues: value || {
      name: '',
      type: LLMProviderType.OPENAI,
      apiKey: '',
      baseUrl: '',
      models: '',
    },
  });

  function onSubmit(data: LLMProvider) {
    onChange ? onChange(data) : onAdd?.(data);
  }

  function handleSubmit() {
    const data = form.getValues();
    onSubmit(data);
  }

  // async function getModelList(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
  //   e.preventDefault();
  //   const baseUrl = form.getValues('baseUrl');
  //   if (!baseUrl) {
  //     toast.toast({
  //       title: t('common.error'),
  //       description: t('admin.setting.ai.baseUrlRequired'),
  //     });
  //     return;
  //   }
  //   const openai = new OpenAI({
  //     apiKey: form.getValues('apiKey'),
  //     baseURL: baseUrl,
  //     dangerouslyAllowBrowser: true,
  //   });
  //   try {
  //     const resp = await openai.models.list();
  //     const modelIds = resp.data.map((model) => model.id).join(', ');
  //     form.setValue('models', modelIds);
  //     // focus on models input
  //     form.setFocus('models');
  //   } catch (error) {
  //     console.error(error);
  //     toast.toast({
  //       title: t('common.error'),
  //       description: t('admin.setting.ai.fetchModelListError'),
  //     });
  //   }
  // }

  const mode = onChange ? t('actions.update') : t('actions.add');
  const type = form.watch('type');
  const currentProvider = LLM_PROVIDERS.find((provider) => provider.value === type);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          name="name"
          render={({ field }) => (
            <FormItem>
              <div>
                <FormLabel>{t('admin.setting.ai.name')}</FormLabel>
                <FormDescription>{t('admin.setting.ai.nameDescription')}</FormDescription>
              </div>
              <FormControl>
                <Input {...field} autoComplete="off" placeholder="openai/claude/gemini..." />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.setting.ai.providerType')}</FormLabel>
              <FormControl>
                <Select
                  {...field}
                  onValueChange={(value) => {
                    form.setValue('type', value as unknown as LLMProvider['type']);
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('admin.setting.ai.providerType')} />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_PROVIDERS.map(({ value, label, Icon }) => (
                      <SelectItem key={value} value={value}>
                        <div className="flex flex-row items-center text-[13px]">
                          <Icon className="size-5 shrink-0 pr-1" />
                          {label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {!!currentProvider && (
          <>
            <FormField
              name="baseUrl"
              render={({ field }) => (
                <FormItem>
                  <div>
                    <FormLabel>{t('admin.setting.ai.baseUrl')}</FormLabel>
                    <FormDescription>{t('admin.setting.ai.baseUrlDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Input {...field} placeholder={currentProvider.baseUrlPlaceholder} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <div>
                    <FormLabel>{t('admin.setting.ai.apiKey')}</FormLabel>
                    <FormDescription>{t('admin.setting.ai.apiKeyDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Input {...field} type="password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="models"
              render={({ field }) => (
                <FormItem>
                  <div>
                    <FormLabel>{t('admin.setting.ai.models')}</FormLabel>
                    <FormDescription>{t('admin.setting.ai.modelsDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Input {...field} placeholder={currentProvider.modelsPlaceholder} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button onClick={handleSubmit}>{mode}</Button>
          </>
        )}
      </form>
    </Form>
  );
};
