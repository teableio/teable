/* eslint-disable @typescript-eslint/no-unused-vars */
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from '@teable/icons';
import type { ITestLLMVo, LLMProvider } from '@teable/openapi/src/admin/setting';
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
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LLM_PROVIDERS } from './constant';

interface LLMProviderFormProps {
  value?: LLMProvider;
  onChange?: (value: LLMProvider) => void;
  onAdd?: (data: LLMProvider) => void;
  onTest?: (data: Required<LLMProvider>) => Promise<ITestLLMVo>;
}

export const UpdateLLMProviderForm = ({
  value,
  children,
  onChange,
  onTest,
}: PropsWithChildren<Omit<LLMProviderFormProps, 'onAdd'>>) => {
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
        <LLMProviderForm value={value} onChange={handleChange} onTest={onTest} />
      </DialogContent>
    </Dialog>
  );
};

export const NewLLMProviderForm = ({
  children,
  onAdd,
  onTest,
}: PropsWithChildren<Omit<LLMProviderFormProps, 'onChange'>>) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const handleAdd = (data: LLMProvider) => {
    onAdd?.(data);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button size="sm" variant="outline" className="gap-2">
            <Plus className="size-4" />
            {t('admin.setting.ai.addProvider')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{t('admin.setting.ai.addProvider')}</DialogTitle>
          <DialogDescription>{t('admin.setting.ai.addProviderDescription')}</DialogDescription>
        </DialogHeader>
        <LLMProviderForm onAdd={handleAdd} onTest={onTest} />
      </DialogContent>
    </Dialog>
  );
};

export const LLMProviderForm = ({ value, onAdd, onChange, onTest }: LLMProviderFormProps) => {
  const { t } = useTranslation();
  const [isTestLoading, setIsTestLoading] = useState(false);

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

  async function handleTest() {
    if (!onTest) return;

    const formData = form.getValues();

    if (
      !formData.name ||
      !formData.type ||
      !formData.baseUrl ||
      (!formData.apiKey && formData.type !== LLMProviderType.OLLAMA)
    ) {
      return toast.error(t('admin.setting.ai.fillRequiredFields'));
    }

    if (!formData.models) {
      return toast.error(t('admin.setting.ai.modelsRequired'));
    }

    const firstModel = formData.models.split(',')[0]?.trim();

    if (!firstModel) {
      return toast.error(t('admin.setting.ai.noValidModel'));
    }

    setIsTestLoading(true);

    try {
      const result = await onTest(formData as Required<LLMProvider>);
      const { success, response } = result;

      success
        ? toast.success(t('admin.setting.ai.testSuccess'))
        : toast.error(
            response
              ? t('admin.setting.ai.testFailed') + '<br/>' + response
              : t('admin.setting.ai.testFailed')
          );
    } catch (error) {
      toast.error(t('admin.setting.ai.testFailed'));
    } finally {
      setIsTestLoading(false);
    }
  }

  const mode = onChange ? t('actions.update') : t('actions.add');
  const type = form.watch('type');
  const currentProvider = LLM_PROVIDERS.find(
    (provider) => provider.value === type
  ) as (typeof LLM_PROVIDERS)[number] & { apiKeyPlaceholder?: string };

  return (
    <Form {...form}>
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
          {type !== LLMProviderType.OLLAMA && (
            <FormField
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <div>
                    <FormLabel>{t('admin.setting.ai.apiKey')}</FormLabel>
                    <FormDescription>{t('admin.setting.ai.apiKeyDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder={currentProvider?.apiKeyPlaceholder ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
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
          <div className="flex w-full flex-row gap-2">
            {onTest && (
              <Button
                className="flex-1"
                onClick={handleTest}
                disabled={isTestLoading}
                type="button"
                variant="outline"
              >
                {isTestLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('admin.setting.ai.testing')}
                  </>
                ) : (
                  t('admin.setting.ai.testConnection')
                )}
              </Button>
            )}
            <Button className="flex-1" onClick={handleSubmit}>
              {mode}
            </Button>
          </div>
        </>
      )}
    </Form>
  );
};
