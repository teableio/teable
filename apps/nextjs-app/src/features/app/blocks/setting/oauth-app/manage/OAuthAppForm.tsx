import { useMutation } from '@tanstack/react-query';
import type { Action } from '@teable/core';
import {
  UploadType,
  oauthCreateRoSchema,
  type OAuthCreateRo,
  type OAuthUpdateRo,
} from '@teable/openapi';
import { FileZone } from '@teable/sdk/components/FileZone';
import { Button, Input, Separator, Textarea, useToast } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { uploadFiles } from '@/features/app/utils/uploadFile';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import type { IFormItemRef } from '../../components/FormItem';
import { FormItem } from '../../components/FormItem';
import { ScopesSelect } from '../../components/ScopesSelect';
import { OAuthActionsPrefixes } from '../constant';
import { CallbackEditor } from './CallbackEditor';

interface IOAuthAppFormProps {
  value?: OAuthCreateRo | OAuthUpdateRo;
  onChange?: (value: OAuthCreateRo | OAuthUpdateRo) => void;
  showBasicTitle?: boolean;
}

export interface IOAuthAppFormRef {
  validate: () => boolean;
}

export const OAuthAppForm = forwardRef<IOAuthAppFormRef, IOAuthAppFormProps>((props, ref) => {
  const { showBasicTitle, value, onChange } = props;

  const validateRefs = useRef<Partial<{ [key in keyof OAuthCreateRo]: IFormItemRef | null }>>({});
  const errorRef = useRef<IFormItemRef | null>();

  const [form, setForm] = useState<OAuthCreateRo>(
    value ?? {
      name: '',
      homepage: '',
      redirectUris: [],
    }
  );

  useImperativeHandle(ref, () => ({
    validate: () => {
      errorRef.current = Object.entries(validateRefs.current).find(
        ([key, ref]) => !ref?.validate(form?.[key as keyof OAuthCreateRo])
      )?.[1];
      return !errorRef.current;
    },
  }));

  const updateForm = (key: keyof OAuthCreateRo, value: OAuthCreateRo[keyof OAuthCreateRo]) => {
    errorRef.current?.reset();
    setForm((prev) => {
      const newForm = { ...prev, [key]: value };
      onChange?.(newForm);
      return newForm;
    });
  };

  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const { toast } = useToast();
  const getPreviewUrl = usePreviewUrl();
  const fileInput = useRef<HTMLInputElement>(null);

  const { mutateAsync: uploadLogo, isLoading: uploadLogoLoading } = useMutation({
    mutationFn: (files: File[]) => uploadFiles(files, UploadType.OAuth),
    onSuccess: (res) => {
      if (res?.[0]?.path) {
        updateForm('logo', res[0].path);
      }
      return res;
    },
  });

  const logoChange = (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1) {
      toast({ title: t('oauth:form.logo.lengthError') });
      return;
    }
    if (files[0].type.indexOf('image') === -1) {
      toast({ title: t('oauth:form.logo.typeError') });
      return;
    }
    uploadLogo(files);
  };

  return (
    <>
      <div className="space-y-4">
        {showBasicTitle && (
          <div className="space-y-1">
            <h3 className="font-semibold">{t('oauth:formType.basic')}</h3>
            <Separator />
          </div>
        )}
        <FormItem
          validateSchema={oauthCreateRoSchema.shape.name}
          ref={(el) => {
            validateRefs.current['name'] = el;
          }}
          title={t('oauth:form.name.label')}
          description={t('oauth:form.name.description')}
          required
        >
          <Input
            className="h-8"
            type="text"
            value={form.name}
            onChange={(e) => updateForm('name', e.target.value)}
          />
        </FormItem>

        <FormItem title={t('oauth:form.description.label')}>
          <Textarea
            className="h-32"
            value={form.description}
            onChange={(e) => updateForm('description', e.target.value)}
          />
        </FormItem>
        <FormItem
          validateSchema={oauthCreateRoSchema.shape.homepage}
          ref={(el) => {
            validateRefs.current['homepage'] = el;
          }}
          title={t('oauth:form.homePageUrl.label')}
          description={t('oauth:form.homePageUrl.description')}
          required
        >
          <Input
            className="h-8"
            type="text"
            value={form.homepage}
            onChange={(e) => updateForm('homepage', e.target.value)}
          />
        </FormItem>
        <FormItem title={t('oauth:form.logo.label')} description={t('oauth:form.logo.description')}>
          <div className="flex items-center gap-3">
            <Button
              variant={'outline'}
              size={'xs'}
              className="m-1 gap-2 font-normal"
              onClick={() => fileInput.current?.click()}
            >
              <input
                type="file"
                className="hidden"
                accept="image/*,"
                ref={fileInput}
                onChange={(e) => logoChange(Array.from(e.target.files || []))}
              />
              {t('oauth:form.logo.button')}
            </Button>
            {form.logo && (
              <Button
                size={'xs'}
                variant={'destructive'}
                onClick={() => updateForm('logo', undefined)}
              >
                {t('oauth:form.logo.clear')}
              </Button>
            )}
          </div>
          <FileZone
            className="size-52"
            fileInputProps={{
              accept: 'image/*,',
              multiple: false,
            }}
            action={['click', 'drop']}
            onChange={logoChange}
            disabled={uploadLogoLoading}
            defaultText={t('oauth:form.logo.placeholder')}
          >
            {form.logo && (
              <div className="relative size-full overflow-hidden rounded-md border border-border">
                <Image
                  src={getPreviewUrl(form.logo)}
                  alt="card cover"
                  fill
                  sizes="100%"
                  style={{
                    objectFit: 'contain',
                  }}
                />
              </div>
            )}
          </FileZone>
        </FormItem>
      </div>
      <div className="space-y-2">
        <div className="space-y-1">
          <h3 className="font-semibold">{t('oauth:formType.identify')}</h3>
          <Separator />
        </div>
        <div className="space-y-2">
          <FormItem
            title={t('oauth:form.callbackUrl.label')}
            description={t('oauth:form.callbackUrl.description')}
            validateSchema={oauthCreateRoSchema.shape.redirectUris}
            ref={(el) => {
              validateRefs.current['redirectUris'] = el;
            }}
            required
          >
            <CallbackEditor
              value={form.redirectUris}
              onChange={(value) => updateForm('redirectUris', value ?? [])}
            />
          </FormItem>
        </div>
      </div>
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-semibold">{t('oauth:formType.scopes')}</h3>
          <Separator />
        </div>
        <ScopesSelect
          actionsPrefixes={OAuthActionsPrefixes}
          initValue={form.scopes as Action[]}
          onChange={(value) => updateForm('scopes', value)}
        />
      </div>
    </>
  );
});

OAuthAppForm.displayName = 'OAuthAppForm';
