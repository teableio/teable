import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { Check, ChevronDown, Database, Plus, ShieldUser, Trash2 } from '@teable/icons';
import {
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
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { spaceConfig } from '@/features/i18n/space.config';
import {
  SpaceInnerSettingModal as SpaceInnerSettingModalComponent,
  SettingTab,
} from '@overridable/SpaceInnerSettingModal';
import { Level } from '../../../components/billing/Level';
import { SpaceAvatar } from '../../../components/space/SpaceAvatar';
import { useSpaceList } from '../hooks';
import { usePinMap } from '../usePinMap';
import { StarButton } from './StarButton';

interface ISpaceSwitcherProps {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  upgradeTip?: ReactNode;
  creditUsage?: ReactNode;
  spaceInnerSettingModal?: ReactNode;
}

export const SpaceSwitcher = (props: ISpaceSwitcherProps) => {
  const {
    open: controlledOpen,
    setOpen: controlledSetOpen,
    upgradeTip,
    creditUsage,
    spaceInnerSettingModal,
  } = props;
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { user } = useSession();
  const isCloud = useIsCloud();
  const queryClient = useQueryClient();

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (controlledSetOpen) {
        controlledSetOpen(value);
      }
      if (!isControlled) {
        setInternalOpen(value);
      }
    },
    [controlledSetOpen, isControlled, setInternalOpen]
  );

  const [settingModalOpen, setSettingModalOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [highlightedValue, setHighlightedValue] = useState<string | undefined>();

  const pinMap = usePinMap();
  const { spaceList } = useSpaceList();
  const { spaceId: currentSpaceId } = useParams<{ spaceId: string }>();

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

  const sortedSpaceList = useMemo(() => {
    if (!spaceList || !currentSpaceId) return spaceList;
    const currentSpaceItem = spaceList.find((s) => s.id === currentSpaceId);
    if (!currentSpaceItem) return spaceList;
    return [currentSpaceItem, ...spaceList.filter((s) => s.id !== currentSpaceId)];
  }, [spaceList, currentSpaceId]);

  const organization = user?.organization;

  const { mutate: addSpace, isPending: isLoading } = useMutation({
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

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setHighlightedValue(currentSpaceId);
    }
  };

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
    if (space.id === currentSpaceId) return;
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
          <Button
            variant="ghost"
            size="sm"
            className="h-10 max-w-full justify-start overflow-hidden p-2 text-base"
          >
            <SpaceAvatar name={currentSpace?.name ?? ''} className="size-8 shrink-0" />
            <p className="min-w-0 truncate text-left font-semibold">{currentSpace?.name}</p>
            <ChevronDown className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[360px] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command
            value={highlightedValue}
            onValueChange={setHighlightedValue}
            filter={(value, search, keywords) => {
              const searchLower = search.toLowerCase();
              if (keywords?.some((keyword) => keyword.toLowerCase().includes(searchLower))) {
                return 1;
              }
              return 0;
            }}
          >
            {isCloud && (upgradeTip || creditUsage) && (
              <div className="flex flex-col gap-2 border-b p-4">
                {upgradeTip}
                {creditUsage}
              </div>
            )}

            <div>
              <div className="px-4 pb-2 pt-4">
                <CommandInput
                  placeholder={searchPlaceholder}
                  containerClassName="h-8 px-2 border rounded-md"
                />
              </div>

              <CommandList className="max-h-[200px]">
                <CommandEmpty>{t('common:noResult')}</CommandEmpty>

                <CommandGroup className="px-2 py-0">
                  {sortedSpaceList?.map((space) => {
                    const isSelected = space.id === currentSpaceId;
                    const subscription = subscriptionMap.get(space.id);
                    const spaceIsPinned = pinMap?.[space.id];

                    return (
                      <CommandItem
                        key={space.id}
                        value={space.id}
                        keywords={[space.name]}
                        onSelect={() => handleSelectSpace(space)}
                        className={cn('group flex items-center gap-2 rounded-md h-10')}
                      >
                        <div className="flex min-w-0 grow items-center gap-2">
                          <SpaceAvatar name={space.name} className="size-6" />
                          <span className="truncate text-sm">{space.name}</span>
                          <StarButton
                            id={space.id}
                            type={PinType.Space}
                            className={cn('w-0 shrink-0 group-hover:w-auto', {
                              'opacity-100 w-auto': spaceIsPinned,
                            })}
                          />
                          {isCloud && (
                            <Level
                              level={subscription?.level}
                              appSumoTier={subscription?.appSumoTier}
                            />
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {isSelected && <Check className="size-5" />}
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
                  className="hover:text-blue-700dark:hover:text-blue-400 flex h-8 w-full items-center justify-start rounded-md p-2 text-blue-500"
                >
                  <Plus className="size-4 shrink-0" />
                  {t('space:action.createSpace')}
                </Button>
              </div>
            </div>

            <CommandSeparator />

            <div className="flex flex-col px-2 py-1">
              <Link
                href="/space/shared-base"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-accent"
              >
                <Database className="size-4 shrink-0" />
                <span className="text-sm">{t('space:sharedBase.title')}</span>
              </Link>

              {user?.isAdmin && (
                <Link
                  href="/admin/setting"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-accent"
                >
                  <ShieldUser className="size-4 shrink-0" />
                  <span className="text-sm">{t('common:noun.adminPanel')}</span>
                </Link>
              )}

              {organization?.isAdmin && (
                <Link
                  href={`/enterprise/${organization.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-accent"
                >
                  <Building2 className="size-4 shrink-0" />
                  <span className="text-sm">{t('common:noun.organizationPanel')}</span>
                </Link>
              )}

              <Link
                href="/space/trash"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex h-8 items-center gap-2 rounded-md p-2 hover:bg-accent"
              >
                <Trash2 className="size-4 shrink-0" />
                <span className="text-sm">{t('common:trash.spaceTrash')}</span>
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

      {spaceInnerSettingModal ? (
        spaceInnerSettingModal
      ) : (
        <SpaceInnerSettingModalComponent
          open={settingModalOpen}
          setOpen={setSettingModalOpen}
          defaultTab={SettingTab.General}
        >
          <span className="hidden" />
        </SpaceInnerSettingModalComponent>
      )}
    </>
  );
};
