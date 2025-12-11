import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Home, Plus, Settings, Trash2 } from '@teable/icons';
import { getSpaceById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { CreateBaseModalTrigger } from '@/features/app/components/space/CreateBaseModal';
import { spaceConfig } from '@/features/i18n/space.config';
import { PinList } from './PinList';

export const SpaceInnerSideBar = (props: { isAdmin?: boolean | null }) => {
  const { isAdmin } = props;
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { spaceId } = useParams<{ spaceId: string }>();

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
    enabled: !!spaceId,
  });

  const pageRoutes: {
    href: string;
    text: string;
    Icon: React.FC<{ className?: string }>;
    hidden?: boolean;
  }[] = [
    {
      href: `/space/${spaceId}`,
      text: t('space:baseList.allBases'),
      Icon: Home,
    },
    {
      href: `/space/${spaceId}/setting/general`,
      text: t('space:spaceSetting.title'),
      Icon: Settings,
      hidden: !isAdmin,
    },
    {
      href: `/space/${spaceId}/trash`,
      text: t('noun.trash'),
      Icon: Trash2,
    },
  ];

  const canCreateSpace = space && hasPermission(space?.role, 'space|create');

  return (
    <>
      <div className="flex flex-col justify-center px-2">
        {space && (
          <div className="p-2">
            <CreateBaseModalTrigger spaceId={space.id}>
              <Button variant={'outline'} size={'sm'} className="w-full" disabled={!canCreateSpace}>
                <Plus className="size-4 shrink-0" />
                {t('space:action.createBase')}
              </Button>
            </CreateBaseModalTrigger>
          </div>
        )}
        <ul className="py-1">
          {pageRoutes.map(({ href, text, Icon, hidden }) => {
            if (hidden) return null;
            return (
              <li key={href}>
                <Button
                  variant="ghost"
                  size={'xs'}
                  asChild
                  className={cn(
                    'w-full justify-start h-8 text-sm ',
                    href === router.pathname && 'bg-accent'
                  )}
                >
                  <Link href={href} className="font-normal">
                    <Icon className="size-4 shrink-0" />
                    <p className="truncate">{text}</p>
                    <div className="grow basis-0"></div>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PinList />
      </div>
    </>
  );
};
