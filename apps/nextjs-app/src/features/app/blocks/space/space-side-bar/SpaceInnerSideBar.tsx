import { useMutation, useQuery } from '@tanstack/react-query';
import { getUniqName, hasPermission } from '@teable/core';
import { Home, Plus, Settings, Trash2 } from '@teable/icons';
import { createBase, getSpaceById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { useBaseList } from '../useBaseList';
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

  const allBases = useBaseList();
  const bases = allBases?.filter((base) => base.spaceId === spaceId);

  const { mutate: createBaseMutator, isLoading: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const handleCreateBase = () => {
    if (!spaceId) return;
    const name = getUniqName(t('common:noun.base'), bases?.map((base) => base.name) || []);
    createBaseMutator({ spaceId, name });
  };

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

  const canCreateBase = space && hasPermission(space?.role, 'base|create');

  return (
    <>
      <div className="flex flex-col justify-center px-2">
        {space && (
          <div className="p-2">
            <Button
              variant={'outline'}
              size={'sm'}
              className="w-full"
              disabled={!canCreateBase || createBaseLoading}
              onClick={handleCreateBase}
            >
              <Plus className="size-4 shrink-0" />
              {t('space:action.createBase')}
            </Button>
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
