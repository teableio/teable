import { useTheme } from '@teable/next-themes';
import { useSession } from '@teable/sdk/hooks';
import { Button, Dialog, DialogContent } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { useBrand } from '../../hooks/useBrand';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useSetting } from '../../hooks/useSetting';

export const FreshSettingGuideDialog = () => {
  const isCloud = useIsCloud();
  const {
    user: { isAdmin },
  } = useSession();

  const { createdTime } = useSetting();

  const [freshAdmin, setFreshAdmin] = useLocalStorage('freshAdmin', true);
  const showGuideModal = Boolean(
    freshAdmin && isAdmin && !isCloud && dayjs().isAfter(dayjs(createdTime).add(4, 'hour'))
  );
  const [isModalOpen, setIsModalOpen] = useState(showGuideModal);
  const { t } = useTranslation('common');

  const router = useRouter();
  const { brandName } = useBrand();

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (!showGuideModal) return null;

  return (
    <div className="fixed inset-0 z-50">
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFreshAdmin(false);
          }
          setIsModalOpen(open);
        }}
      >
        <DialogContent
          className="flex h-[482px] w-[560px] flex-col justify-between p-10"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-col items-center">
            <Image
              src={isDark ? '/images/layout/eelcome-dark.png' : '/images/layout/welcome-light.png'}
              alt="Init setting guide"
              width={240}
              height={240}
            />
            <h1 className="text-base-foreground justify-start self-stretch pt-4 text-center font-['Inter'] text-xl font-semibold leading-7">
              {t('admin.tips.thankYouForUsingTeable', { brandName })}
            </h1>
            <p className="justify-start self-stretch pt-[6px] text-center font-['Inter'] text-sm font-normal leading-tight text-muted-foreground">
              {t('admin.tips.pleaseGoToConfiguration')}
            </p>
          </div>
          <Button
            onClick={() => {
              router.push('/admin/setting');
              setFreshAdmin(false);
            }}
            className="h-[44px] w-[194px] self-center"
          >
            {t('admin.action.goToConfiguration')}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};
