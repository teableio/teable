import { useMutation } from '@tanstack/react-query';
import { UploadType } from '@teable/openapi';
import { FileZone } from '@teable/sdk/components/FileZone';
import { Button, useToast } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { uploadFiles } from '@/features/app/utils/uploadFile';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';

export const LogoEditor = (props: {
  value?: string;
  onChange: (value?: string | null) => void;
}) => {
  const { value, onChange } = props;
  const previewUrl = usePreviewUrl();
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const { mutateAsync: uploadLogo, isLoading: uploadLogoLoading } = useMutation({
    mutationFn: (files: File[]) => uploadFiles(files, UploadType.Plugin),
    onSuccess: (res) => {
      if (res?.[0]) {
        onChange(res[0].path);
        setUploadedPath(res[0].path);
      }
      return res;
    },
  });

  const logoChange = (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1) {
      toast({ title: t('plugin:form.logo.lengthError') });
      return;
    }
    if (files[0].type.indexOf('image') === -1) {
      toast({ title: t('plugin:form.logo.typeError') });
      return;
    }
    uploadLogo(files);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="file"
          className="hidden"
          accept="image/*,"
          ref={fileInput}
          onChange={(e) => logoChange(Array.from(e.target.files || []))}
        />
        <Button
          type="button"
          variant={'outline'}
          size={'xs'}
          className="m-1 gap-2 font-normal"
          onClick={(e) => {
            fileInput.current?.click();
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          {t('plugin:form.logo.upload')}
        </Button>
        {value && (
          <Button type="button" size={'xs'} variant={'destructive'} onClick={() => onChange(null)}>
            {t('plugin:form.logo.clear')}
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
        defaultText={t('plugin:form.logo.placeholder')}
      >
        {value && (
          <div className="relative size-full overflow-hidden rounded-md border border-border">
            <Image
              src={previewUrl(uploadedPath || value)}
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
    </div>
  );
};
