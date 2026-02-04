import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { ChevronsLeft, ChevronDown, Database, HelpCircle, Pencil } from '@teable/icons';
import { CollaboratorType, getBaseList, getSharedBase, updateBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import { useIsTemplate } from '@teable/sdk/hooks/use-is-template';
import {
  cn,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Input,
  DropdownMenuSeparator,
} from '@teable/ui-lib';
import { ArrowLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { tableConfig } from '@/features/i18n/table.config';
import { PublishBaseDialog } from '../../table/table-header/publish-base/PublishBaseDialog';

const BaseDropdownMenu = ({
  children,
  showRename,
  onRename,
  backSpace,
  creditUsage,
  spaceId,
  collaboratorType,
  currentBaseId,
  disabled,
}: {
  children: React.ReactNode;
  showRename: boolean;
  onRename: () => void;
  backSpace: () => void;
  spaceId: string;
  creditUsage?: React.ReactNode;
  collaboratorType?: CollaboratorType;
  currentBaseId: string;
  disabled?: boolean;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isCloud = useIsCloud();
  const [open, setOpen] = useState(false);

  const isSpaceCollaborator = collaboratorType === CollaboratorType.Space;
  const { data: spaceBases } = useQuery({
    queryKey: ReactQueryKeys.baseList(spaceId),
    queryFn: ({ queryKey }) => getBaseList({ spaceId: queryKey[1] }).then((res) => res.data),
    enabled: open && isSpaceCollaborator,
  });

  const { data: sharedBases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
    enabled: open && collaboratorType === CollaboratorType.Base,
  });

  const bases = spaceBases || sharedBases;

  return (
    <DropdownMenu open={open} onOpenChange={disabled ? undefined : setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-[260px]"
        align="start"
        alignOffset={0}
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onClick={backSpace}>
          <div className="flex w-full cursor-pointer items-center gap-2">
            <ArrowLeft className="size-4" />
            {t('common:actions.backToSpace')}
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isCloud && isSpaceCollaborator && creditUsage && (
          <>
            <div className="px-2 py-1">{creditUsage}</div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <div className="flex w-full cursor-pointer items-center gap-2">
              <Database className="size-4" />
              {t('common:actions.switchBase')}
            </div>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[300px] w-56 overflow-y-auto">
            {bases?.map((base) => (
              <DropdownMenuItem
                key={base.id}
                className={cn('cursor-pointer', {
                  'bg-accent': base.id === currentBaseId,
                })}
                asChild
              >
                <Link href={`/base/${base.id}`} className="flex items-center gap-2">
                  <span className="shrink-0">
                    {base.icon ? (
                      <Emoji emoji={base.icon} size="1rem" />
                    ) : (
                      <Database className="size-4" />
                    )}
                  </span>
                  <span className="truncate" title={base.name}>
                    {base.name}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {showRename && (
          <DropdownMenuItem onClick={onRename}>
            <div className="flex w-full cursor-pointer items-center gap-2">
              <Pencil className="size-4" />
              {t('actions.rename')}
            </div>
          </DropdownMenuItem>
        )}
        <PublishBaseDialog onClose={() => setOpen(false)} closeOnSuccess={false}>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <div className="flex w-full cursor-pointer items-center gap-2">
              <Send className="size-4" />
              {t('space:publishBase.publishToCommunity')}
            </div>
          </DropdownMenuItem>
        </PublishBaseDialog>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            href={t('help.mainLink')}
            title={t('help.title')}
            target="_blank"
            rel="noreferrer"
            className="flex w-full cursor-pointer items-center gap-2"
          >
            <HelpCircle className="size-4" />
            {t('help.title')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const BaseSidebarHeaderLeft = ({ creditUsage }: { creditUsage?: React.ReactNode }) => {
  const base = useBase();
  const router = useRouter();
  const [renaming, setRenaming] = useState<boolean>();
  const [baseName, setBaseName] = useState<string>(base.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const isTemplate = useIsTemplate();
  const { mutateAsync: updateBaseMutator } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.base(base.id),
      });
    },
  });

  const toggleRenameBase = async () => {
    if (baseName && baseName !== base.name) {
      await updateBaseMutator({
        baseId: base.id,
        updateBaseRo: { name: baseName },
      });
    }
    setTimeout(() => setRenaming(false), 200);
  };

  const onRename = () => {
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 200);
  };

  const hasUpdatePermission = hasPermission(base.role, 'base|update');

  const backSpace = () => {
    if (isTemplate) {
      return;
    }
    if (base.collaboratorType === CollaboratorType.Base) {
      router.push({
        pathname: '/space/shared-base',
      });
    } else {
      router.push({
        pathname: '/space/[spaceId]',
        query: { spaceId: base.spaceId },
      });
    }
  };

  return (
    <div className="flex min-w-0 shrink grow items-center">
      <div
        className="relative mr-1 size-6 shrink-0 cursor-pointer"
        onClick={backSpace}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            backSpace();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div
          className={cn('absolute top-0 size-6 transition-all group-hover/sidebar:opacity-0', {
            'group-hover/sidebar:opacity-100': isTemplate,
          })}
        >
          {base.icon ? (
            <Emoji emoji={base.icon} size={'1.5rem'} />
          ) : (
            <TeableLogo className="size-6 text-black" />
          )}
        </div>
        <ChevronsLeft
          className={cn(
            'absolute top-0 size-6 opacity-0 transition-all group-hover/sidebar:opacity-100',
            {
              'group-hover/sidebar:opacity-0': isTemplate,
            }
          )}
        />
      </div>
      <div className="flex shrink grow items-center gap-1 overflow-hidden">
        {renaming ? (
          <form
            className="w-full"
            onSubmit={(e) => {
              e.preventDefault();
              toggleRenameBase();
            }}
          >
            <Input
              ref={inputRef}
              className="h-7 flex-1 shrink focus-visible:ring-0"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              onBlur={toggleRenameBase}
            />
          </form>
        ) : (
          <BaseDropdownMenu
            backSpace={backSpace}
            showRename={hasUpdatePermission}
            onRename={onRename}
            spaceId={base.spaceId}
            creditUsage={creditUsage}
            collaboratorType={base.collaboratorType}
            currentBaseId={base.id}
            disabled={isTemplate}
          >
            <div
              className={cn(
                'flex h-7 max-w-full overflow-hidden px-2 py-1 hover:bg-accent hover:cursor-pointer rounded-md items-center gap-2',
                {
                  'cursor-default': isTemplate,
                }
              )}
            >
              <span className="min-w-0 shrink truncate text-sm" title={base.name}>
                {base.name}
              </span>
              {!isTemplate && <ChevronDown className="size-4 shrink-0" />}
            </div>
          </BaseDropdownMenu>
        )}
      </div>
    </div>
  );
};
