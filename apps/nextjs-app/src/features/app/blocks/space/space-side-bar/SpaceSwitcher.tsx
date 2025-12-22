import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { Admin, Check, ChevronDown, Database, Plus, Settings, Trash2 } from '@teable/icons';
import {
  BillingProductLevel,
  createSpace,
  getSubscriptionSummaryList,
  PinType,
  type IGetSpaceVo,
  type ISubscriptionSummaryVo,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { useSession } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Badge,
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceAvatar } from '../../../components/space/SpaceAvatar';
import { useSpaceList } from '../hooks';
import { usePinMap } from '../usePinMap';
import { StarButton } from './StarButton';

interface ISubscriptionBadgeProps {
  level?: BillingProductLevel;
}

const SubscriptionBadge = ({ level }: ISubscriptionBadgeProps) => {
  if (!level) return null;

  const badgeConfig: Record<BillingProductLevel, { className: string; label: string }> = {
    [BillingProductLevel.Free]: {
      className: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-100',
      label: 'Free',
    },
    [BillingProductLevel.Pro]: {
      className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
      label: 'Pro',
    },
    [BillingProductLevel.Business]: {
      className: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
      label: 'Business',
    },
    [BillingProductLevel.Enterprise]: {
      className: 'bg-zinc-900 text-neutral-50 hover:bg-zinc-900',
      label: 'Enterprise',
    },
  };

  const config = badgeConfig[level];
  if (!config) return null;

  return (
    <Badge variant="secondary" className={cn('shrink-0 border-transparent', config.className)}>
      {config.label}
    </Badge>
  );
};

export const SpaceSwitcher = () => {
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { user } = useSession();
  const isCloud = useIsCloud();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [highlightedValue, setHighlightedValue] = useState<string | undefined>();

  const pinMap = usePinMap();
  const { spaceList } = useSpaceList();
  const currentSpaceId = router.query.spaceId as string | undefined;

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setHighlightedValue(currentSpaceId);
    }
  };

  const { data: subscriptionList } = useQuery({
    queryKey: ['subscription-summary-list'],
    queryFn: () => getSubscriptionSummaryList().then((res) => res.data),
    enabled: isCloud,
  });

  const subscriptionMap = useMemo(() => {
    const map = new Map<string, ISubscriptionSummaryVo>();
    subscriptionList?.forEach((item) => {
      map.set(item.spaceId, item);
    });
    return map;
  }, [subscriptionList]);

  const currentSpace = useMemo(() => {
    return spaceList?.find((space) => space.id === currentSpaceId);
  }, [spaceList, currentSpaceId]);

  const organization = user?.organization;

  const { mutate: addSpace, isLoading } = useMutation({
    mutationFn: createSpace,
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      setShowCreateDialog(false);
      setSpaceName('');
      setOpen(false);
      router.push({
        pathname: '/space/[spaceId]',
        query: {
          spaceId: data.data.id,
        },
      });
    },
  });

  const handleCreateSpace = () => {
    const name =
      spaceName.trim() ||
      getUniqName(t('common:noun.space'), spaceList?.length ? spaceList?.map((s) => s.name) : []);
    addSpace({ name });
  };

  const handleOpenCreateDialog = () => {
    setShowCreateDialog(true);
    setSpaceName('');
  };

  const handleSelectSpace = (space: IGetSpaceVo) => {
    setOpen(false);
    router.push({
      pathname: '/space/[spaceId]',
      query: {
        spaceId: space.id,
      },
    });
  };

  const searchPlaceholder = `${t('common:actions.search')} ${t('common:noun.space').toLowerCase()}`;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-10 min-w-0 justify-start p-2 text-base">
            <SpaceAvatar name={currentSpace?.name ?? ''} className="size-8" />
            <p className="truncate text-left font-semibold ">{currentSpace?.name}</p>
            <ChevronDown className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="min-w-[360px] p-0" align="start">
          <Command value={highlightedValue} onValueChange={setHighlightedValue}>
            <div className="px-4 pb-2 pt-4">
              <p className="pb-2 text-sm font-semibold ">
                {t('space:allSpaces')} ({spaceList?.length || 0})
              </p>
              <CommandInput
                placeholder={searchPlaceholder}
                className="h-8"
                containerClassName="border rounded-md"
              />
            </div>

            <CommandList className="max-h-[300px]">
              <CommandEmpty>{t('common:noResult')}</CommandEmpty>

              <CommandGroup className="px-2 py-0">
                {spaceList?.map((space) => {
                  const isSelected = space.id === currentSpaceId;
                  const subscription = subscriptionMap.get(space.id);
                  const isPinned = pinMap?.[space.id];

                  return (
                    <CommandItem
                      key={space.id}
                      value={space.id}
                      onSelect={() => handleSelectSpace(space)}
                      className={cn('group flex items-center gap-2 rounded-md h-10')}
                    >
                      <div className="flex min-w-0 grow items-center gap-2">
                        <SpaceAvatar name={space.name} className="size-6" />
                        <span className="truncate text-sm ">{space.name}</span>
                        {isCloud && <SubscriptionBadge level={subscription?.level} />}
                        <StarButton
                          id={space.id}
                          type={PinType.Space}
                          className={cn('w-0 shrink-0 group-hover:w-auto', {
                            'opacity-100 w-auto': isPinned,
                          })}
                        />
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {isSelected && <Check className="size-5 " />}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>

            <div className="w-full px-2 py-1">
              <Button
                onClick={handleOpenCreateDialog}
                variant="ghost"
                className="flex h-8 w-full items-center justify-start rounded-md p-2 text-blue-600 hover:text-blue-600"
              >
                <Plus className="size-4 shrink-0 " />
                {t('space:action.createSpace')}
              </Button>
            </div>

            <CommandSeparator />

            <div className="flex flex-col px-2 py-1">
              <Link
                href="/space/shared-base"
                onClick={() => setOpen(false)}
                className="flex h-9 items-center gap-2 rounded-md p-2 hover:bg-accent"
              >
                <Database className="size-4 shrink-0" />
                <span className="text-sm ">{t('space:sharedBase.title')}</span>
              </Link>
              {user?.isAdmin && (
                <Link
                  href="/admin/setting"
                  onClick={() => setOpen(false)}
                  className="flex h-9 items-center gap-2 rounded-md p-2 hover:bg-accent"
                >
                  <Admin className="size-4 shrink-0" />
                  <span className="text-sm ">{t('common:noun.adminPanel')}</span>
                </Link>
              )}

              {organization?.isAdmin && (
                <Link
                  href={`/enterprise/${organization.id}`}
                  onClick={() => setOpen(false)}
                  className="flex h-9 items-center gap-2 rounded-md p-2 hover:bg-accent"
                >
                  <Settings className="size-4 shrink-0" />
                  <span className="text-sm ">{t('common:noun.organizationPanel')}</span>
                </Link>
              )}

              <Link
                href="/space/trash"
                onClick={() => setOpen(false)}
                className="flex h-9 items-center gap-2 rounded-md p-2 hover:bg-accent"
              >
                <Trash2 className="size-4 shrink-0" />
                <span className="text-sm ">{t('common:trash.spaceTrash')}</span>
              </Link>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        title={t('space:action.createSpace')}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.confirm')}
        confirmLoading={isLoading}
        onCancel={() => {
          setShowCreateDialog(false);
          setSpaceName('');
        }}
        onConfirm={handleCreateSpace}
        content={
          <div className="space-y-2">
            <div className="flex flex-col gap-2">
              <Input
                placeholder={getUniqName(
                  t('common:noun.space'),
                  spaceList?.length ? spaceList?.map((s) => s.name) : []
                )}
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateSpace();
                  }
                }}
              />
            </div>
          </div>
        }
      />
    </>
  );
};
