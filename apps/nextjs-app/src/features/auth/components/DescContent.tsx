import { useTranslation } from 'next-i18next';
import { authConfig } from '@/features/i18n/auth.config';
import { Rectangles } from './Rectangles';

export const DescContent = () => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  return (
    <div className="shrink-1 relative hidden h-full flex-1 basis-1/4 border-r shadow-lg lg:block ">
      <div className="absolute inset-10 -z-10 flex flex-wrap justify-between gap-2">
        <Rectangles className="size-10 rounded-md" amount={36 * 2} />
        <Rectangles className="hidden size-10 rounded-md md:block" amount={36 * 2} />
        <Rectangles className="hidden size-10 rounded-md lg:block" amount={36 * 2} />
        <Rectangles className="hidden size-10 rounded-md xl:block" amount={36 * 2} />
      </div>
      <div className="flex h-full flex-col items-center justify-center p-10">
        <div className="relative">
          <h2 className="absolute -translate-y-full text-nowrap text-6xl font-bold">
            {t('auth:content.title')}
          </h2>
          <p className="py-10">{t('auth:content.description')}</p>
        </div>
      </div>
    </div>
  );
};
