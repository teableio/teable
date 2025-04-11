import { Alert, AlertTitle, AlertDescription } from '@teable/ui-lib/shadcn/ui/alert';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

export function AutomationPage() {
  const { t } = useTranslation('common');
  return (
    <div className="h-full flex-col md:flex">
      <Head>
        <title>{t('noun.automation')}</title>
      </Head>
      <div className="flex flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">{t('noun.automation')}</h2>
        </div>
      </div>
      <div className="flex h-full items-center justify-center p-4">
        <Alert className="w-[400px]">
          <AlertTitle>
            <span className="text-lg">✨</span> {t('billing.enterpriseFeature')}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-xs">
            <p>{t('billing.automationRequiresUpgrade')}</p>
            <Button className="w-fit" variant="default" asChild size="xs">
              <Link href={`${t('help.appLink')}/setting/license-plan`} target="_blank">
                {t('billing.viewPricing')}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
