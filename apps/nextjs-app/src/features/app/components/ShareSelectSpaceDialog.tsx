import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RolePermission } from '@teable/core';
import {
  copyBaseShare,
  createSpace,
  getBaseList,
  getSpaceList,
  getUserLastVisit,
  LastVisitResourceType,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  ToggleGroup,
  ToggleGroupItem,
} from '@teable/ui-lib/shadcn';
import { Check, ChevronDown, Loader, Plus } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useShareContext } from '../context/ShareContext';
import { SpaceAvatar } from './space/SpaceAvatar';

type CopyMode = 'newBase' | 'existingBase';

export interface IShareSelectSpaceDialogRef {
  setOpen: (open: boolean) => void;
}

const CreateSpaceSection: React.FC<{
  newSpaceName: string;
  setNewSpaceName: (v: string) => void;
  isCreatingSpace: boolean;
  onCreateSpace: () => void;
}> = ({ newSpaceName, setNewSpaceName, isCreatingSpace, onCreateSpace }) => {
  const { t } = useTranslation(['common']);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">
        {t('common:share.copyToSpaceDialog.noSpaceDescription')}
      </p>
      <div className="flex items-center gap-2">
        <Input
          size="lg"
          value={newSpaceName}
          onChange={(e) => setNewSpaceName(e.target.value)}
          disabled={isCreatingSpace}
          placeholder={t('common:share.copyToSpaceDialog.newSpacePlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreateSpace();
          }}
        />
        <Button onClick={onCreateSpace} disabled={isCreatingSpace} className="shrink-0">
          {isCreatingSpace ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <>
              <Plus className="size-4" />
              {t('common:share.copyToSpaceDialog.createSpace')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

const BasePickerSection: React.FC<{
  isLoading: boolean;
  bases: { id: string; name: string }[] | undefined;
  selectedBaseId: string | undefined;
  setSelectedBaseId: (id: string) => void;
  basePickerOpen: boolean;
  setBasePickerOpen: (open: boolean) => void;
  disabled: boolean;
}> = ({
  isLoading,
  bases,
  selectedBaseId,
  setSelectedBaseId,
  basePickerOpen,
  setBasePickerOpen,
  disabled,
}) => {
  const { t } = useTranslation(['common']);
  const selectedBaseName = bases?.find((b) => b.id === selectedBaseId)?.name;

  const baseNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    bases?.forEach((b) => {
      map[b.id] = b.name;
    });
    return map;
  }, [bases]);

  const commandFilter = useCallback(
    (id: string, search: string) => {
      const name = baseNameMap[id?.trim()]?.toLowerCase() || '';
      return name.includes(search?.toLowerCase()?.trim()) ? 1 : 0;
    },
    [baseNameMap]
  );

  if (isLoading) {
    return (
      <div className="flex h-9 items-center justify-center">
        <Loader className="size-4 animate-spin" />
      </div>
    );
  }

  if (!bases || bases.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {t('common:share.copyToSpaceDialog.noBaseInSpace')}
      </p>
    );
  }

  return (
    <Popover open={basePickerOpen} onOpenChange={setBasePickerOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-9 w-full justify-between overflow-hidden px-3 font-normal"
        >
          <span
            className={`truncate text-[13px] ${!selectedBaseName ? 'text-muted-foreground' : ''}`}
          >
            {selectedBaseName ?? t('common:share.copyToSpaceDialog.selectBasePlaceholder')}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={commandFilter}>
          <CommandInput placeholder={`${t('common:actions.search')}...`} className="h-10" />
          <CommandList>
            <CommandEmpty>{t('common:share.copyToSpaceDialog.noBaseInSpace')}</CommandEmpty>
            {bases.map((b) => (
              <CommandItem
                key={b.id}
                value={b.id}
                onSelect={() => {
                  setSelectedBaseId(b.id);
                  setBasePickerOpen(false);
                }}
                className="flex items-center"
              >
                <Check
                  className={[
                    'mr-2 size-4 shrink-0',
                    selectedBaseId === b.id ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                />
                <span className="truncate">{b.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const ShareSelectSpaceDialog = React.forwardRef<IShareSelectSpaceDialogRef, object>(
  (_, ref) => {
    const { t } = useTranslation(['common']);
    const [selectedSpaceId, setSelectedSpaceId] = useState<string>();
    const [selectedBaseId, setSelectedBaseId] = useState<string>();
    const [baseName, setBaseName] = useState<string>();
    const [newSpaceName, setNewSpaceName] = useState('');
    const [copyMode, setCopyMode] = useState<CopyMode>('newBase');
    const [basePickerOpen, setBasePickerOpen] = useState(false);
    const router = useRouter();
    const isCopyToSpace = router.query.isCopyToSpace === '1';
    const [open, setOpen] = useState(isCopyToSpace);
    const [copyLoading, setCopyLoading] = useState(false);
    const base = useBase();
    const { shareId } = useShareContext();
    const queryClient = useQueryClient();

    useImperativeHandle(ref, () => ({
      setOpen,
    }));

    const { mutateAsync: copyBaseMutator } = useMutation({
      mutationFn: ({
        spaceId,
        name,
        baseId,
      }: {
        spaceId: string;
        name?: string;
        baseId?: string;
      }) => {
        if (!shareId) {
          return Promise.reject(new Error('Share ID is required'));
        }
        return copyBaseShare(shareId, {
          spaceId,
          name,
          withRecords: true,
          baseId,
        });
      },
      onSuccess: ({ data }) => {
        setOpen(false);
        const { id: newBaseId } = data;
        window.location.href = `/base/${newBaseId}`;
      },
      onError: () => {
        setCopyLoading(false);
      },
    });

    const { mutate: createSpaceMutator, isPending: isCreatingSpace } = useMutation({
      mutationFn: (name: string) => createSpace({ name: name || undefined }),
      onSuccess: async (data) => {
        await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
        setSelectedSpaceId(data.data.id);
        setNewSpaceName('');
      },
    });

    const { data: spaceList, isLoading: isLoadingSpaceList } = useQuery({
      queryKey: ReactQueryKeys.spaceList(),
      queryFn: () => getSpaceList().then((data) => data.data),
      enabled: open,
    });
    const { data: userLastVisitSpace, isLoading: isLoadingUserLastVisitSpace } = useQuery({
      queryKey: ['user-last-visit-space', LastVisitResourceType.Space] as const,
      queryFn: () =>
        getUserLastVisit({ resourceType: LastVisitResourceType.Space, parentResourceId: '' }).then(
          (data) => data.data
        ),
      enabled: open,
    });

    const { data: baseListInSpace, isLoading: isLoadingBaseList } = useQuery({
      queryKey: ['base-list-in-space', selectedSpaceId] as const,
      queryFn: () =>
        selectedSpaceId
          ? getBaseList({ spaceId: selectedSpaceId }).then((data) => data.data)
          : Promise.resolve([]),
      enabled: open && !!selectedSpaceId && copyMode === 'existingBase',
    });

    const creatableSpaces = useMemo(
      () => spaceList?.filter((s) => RolePermission[s.role]['base|create']),
      [spaceList]
    );

    const editableBases = useMemo(
      () => baseListInSpace?.filter((b) => RolePermission[b.role]['base|update']),
      [baseListInSpace]
    );

    const defaultSpaceId = useMemo(() => {
      if (isLoadingUserLastVisitSpace || isLoadingSpaceList) {
        return;
      }
      if (!userLastVisitSpace) {
        return creatableSpaces?.[0]?.id;
      }
      if (creatableSpaces?.some((space) => space.id === userLastVisitSpace.resourceId)) {
        return userLastVisitSpace.resourceId;
      }
      return creatableSpaces?.[0]?.id;
    }, [userLastVisitSpace, creatableSpaces, isLoadingUserLastVisitSpace, isLoadingSpaceList]);

    useEffect(() => {
      if (defaultSpaceId) {
        setSelectedSpaceId(defaultSpaceId);
      }
    }, [defaultSpaceId]);

    useEffect(() => {
      setSelectedBaseId(undefined);
      setBasePickerOpen(false);
    }, [selectedSpaceId, copyMode]);

    const hasNoSpaces = !isLoadingSpaceList && (!creatableSpaces || creatableSpaces.length === 0);

    const copyHandler = () => {
      if (!selectedSpaceId) return;
      if (copyMode === 'existingBase' && !selectedBaseId) return;
      setCopyLoading(true);
      copyBaseMutator({
        spaceId: selectedSpaceId,
        name: copyMode === 'newBase' ? baseName?.trim() || undefined : undefined,
        baseId: copyMode === 'existingBase' ? selectedBaseId : undefined,
      });
    };

    const isConfirmDisabled =
      !selectedSpaceId || copyLoading || (copyMode === 'existingBase' && !selectedBaseId);

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[480px] gap-0 p-0">
          <div className="px-6 pb-1 pt-6">
            <DialogHeader>
              <DialogTitle className="text-lg">
                {t('common:share.copyToSpaceDialog.title')}
              </DialogTitle>
            </DialogHeader>
            {!hasNoSpaces && (
              <DialogDescription className="mt-1 text-[13px]">
                {t('common:share.copyToSpaceDialog.description')}
              </DialogDescription>
            )}
          </div>

          <div className="flex flex-col gap-5 px-6 py-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] text-muted-foreground">
                {t('common:share.copyToSpaceDialog.selectSpace')}
              </Label>
              {hasNoSpaces ? (
                <CreateSpaceSection
                  newSpaceName={newSpaceName}
                  setNewSpaceName={setNewSpaceName}
                  isCreatingSpace={isCreatingSpace}
                  onCreateSpace={() => createSpaceMutator(newSpaceName.trim())}
                />
              ) : (
                <Select
                  value={selectedSpaceId}
                  onValueChange={setSelectedSpaceId}
                  disabled={copyLoading}
                >
                  <SelectTrigger size="lg" className="overflow-hidden [&>svg:last-child]:hidden">
                    <SelectValue />
                    <ChevronDown className="size-4 shrink-0 opacity-50" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px]">
                    {creatableSpaces?.map((space) => (
                      <SelectItem key={space.id} value={space.id} className="py-1">
                        <span className="flex w-[380px] items-center gap-2 overflow-x-hidden">
                          <SpaceAvatar name={space.name} className="size-6" />
                          <span className="truncate">{space.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {!hasNoSpaces && selectedSpaceId && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[13px] text-muted-foreground">
                    {t('common:share.copyToSpaceDialog.copyTarget')}
                  </Label>
                  <ToggleGroup
                    type="single"
                    value={copyMode}
                    aria-label={t('common:share.copyToSpaceDialog.copyTarget')}
                    onValueChange={(v) => {
                      if (!v) return;
                      setCopyMode(v as CopyMode);
                    }}
                    disabled={copyLoading}
                    size="sm"
                    className="h-9 w-full justify-start gap-0 rounded-lg bg-muted p-1"
                  >
                    <ToggleGroupItem
                      value="newBase"
                      className="flex-1 justify-center rounded-[7px] text-[13px] text-muted-foreground shadow-none transition-all data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm hover:text-foreground"
                    >
                      {t('common:share.copyToSpaceDialog.createNewBase')}
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="existingBase"
                      className="flex-1 justify-center rounded-[7px] text-[13px] text-muted-foreground shadow-none transition-all data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm hover:text-foreground"
                    >
                      {t('common:share.copyToSpaceDialog.copyToExistingBase')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="min-h-[42px]">
                  {copyMode === 'newBase' ? (
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[13px] text-muted-foreground">
                        {t('common:share.copyToSpaceDialog.baseName')}
                      </Label>
                      <Input
                        size="lg"
                        value={baseName ?? base?.name ?? ''}
                        onChange={(e) => setBaseName(e.target.value)}
                        disabled={copyLoading}
                        placeholder={t('common:share.copyToSpaceDialog.baseNamePlaceholder')}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[13px] text-muted-foreground">
                        {t('common:share.copyToSpaceDialog.selectBase')}
                      </Label>
                      <BasePickerSection
                        isLoading={isLoadingBaseList}
                        bases={editableBases}
                        selectedBaseId={selectedBaseId}
                        setSelectedBaseId={setSelectedBaseId}
                        basePickerOpen={basePickerOpen}
                        setBasePickerOpen={setBasePickerOpen}
                        disabled={copyLoading}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button
              className="min-w-[72px]"
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              className="relative min-w-[72px]"
              size="sm"
              onClick={copyHandler}
              disabled={isConfirmDisabled}
            >
              {copyLoading ? (
                <Loader className="size-4 animate-spin" />
              ) : (
                t('common:actions.duplicate')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

ShareSelectSpaceDialog.displayName = 'ShareSelectSpaceDialog';
