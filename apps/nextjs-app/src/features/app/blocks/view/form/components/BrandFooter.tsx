import Link from 'next/link';
import { Trans } from 'next-i18next';
import { TeableLogo } from '@/components/TeableLogo';
import { useBrand } from '@/features/app/hooks/useBrand';

export const BrandFooter = () => {
  const { brandName } = useBrand();

  return (
    <div className="flex w-full items-center justify-center">
      <span className="h-px w-16 bg-slate-200 dark:bg-slate-600" />
      <div className="mx-4 flex items-center gap-2 text-xs text-muted-foreground">
        {brandName.toLowerCase() === 'teable' ? (
          <Trans
            ns="common"
            i18nKey="poweredBy"
            components={[
              <Link
                key={'brandFooter'}
                href="/"
                target="_blank"
                className="flex items-center text-sm text-black dark:text-white"
              >
                <TeableLogo className="text-xl" />
                <span className="ml-1 font-semibold">{brandName}</span>
              </Link>,
            ]}
          />
        ) : (
          <Link href="/" target="_blank" className="flex items-center">
            <TeableLogo className="text-xl" />
            <span className="ml-1 font-semibold">{brandName}</span>
          </Link>
        )}
      </div>
      <span className="h-px w-16 bg-slate-200 dark:bg-slate-600" />
    </div>
  );
};
