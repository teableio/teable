/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useMutation } from '@tanstack/react-query';
import { Plus } from '@teable/icons';
import { uploadLogo } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { useToast } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';

export const BrandingLogo = (props: { value?: string }) => {
  const { value } = props;
  const [logoUrl, setLogoUrl] = useState(value);
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const { mutate: uploadLogoMutation, isLoading } = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return uploadLogo(formData as any);
    },
    onSuccess: (res) => {
      if (res.data.url) {
        console.log('res.data.url', res.data.url);
        setLogoUrl(res.data.url + '?v=' + Date.now());
      }
    },
  });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: t('common:noun.unknownError') });
      return;
    }
    uploadLogoMutation(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="file"
          className="hidden"
          accept="image/*"
          ref={fileInput}
          onChange={handleLogoChange}
        />
        <div
          className="group relative flex h-fit items-center justify-center"
          onClick={() => fileInput.current?.click()}
        >
          {logoUrl ? (
            <div className="relative size-14 overflow-hidden rounded-md border border-border">
              <Image src={logoUrl} alt="logo" fill sizes="100%" style={{ objectFit: 'contain' }} />
            </div>
          ) : (
            <div className="flex size-14 items-center justify-center rounded-md border border-border">
              {isLoading ? <Spin /> : <Plus className="size-8 text-foreground" />}
            </div>
          )}
          <div className="absolute left-0 top-0 size-full rounded-md bg-transparent group-hover:bg-muted-foreground/20" />
        </div>
      </div>
    </div>
  );
};
