import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { ChevronsLeft, ChevronDown, HelpCircle, Pencil } from '@teable/icons';
import { CollaboratorType, updateBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import { useIsTemplate } from '@teable/sdk/hooks/use-is-template';
import {
  cn,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
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
  winFreeCredit,
}: {
  children: React.ReactNode;
  showRename: boolean;
  onRename: () => void;
  backSpace: () => void;
  spaceId?: string;
  creditUsage?: React.ReactNode;
  winFreeCredit?: React.ReactNode;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isCloud = useIsCloud();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-[220px]"
        align="start"
        alignOffset={8}
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onClick={backSpace}>
          <div className="flex w-full cursor-pointer items-center gap-2">
            <ArrowLeft className="size-4" />
            {t('common:baseDropdown.backToSpace')}
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isCloud && creditUsage && (
          <>
            {creditUsage && <DropdownMenuItem>{creditUsage}</DropdownMenuItem>}
            {winFreeCredit && <DropdownMenuItem>{winFreeCredit}</DropdownMenuItem>}
            <DropdownMenuSeparator />
          </>
        )}
        {showRename && (
          <DropdownMenuItem onClick={onRename}>
            <div className="flex w-full cursor-pointer items-center gap-2">
              <Pencil className="size-4" />
              {t('actions.rename')}
            </div>
          </DropdownMenuItem>
        )}
        <PublishBaseDialog
          onClose={() => {
            console.log('close');
          }}
          closeOnSuccess={false}
        >
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

export const BaseSidebarHeaderLeft = ({
  creditUsage,
  winFreeCredit,
}: {
  creditUsage?: React.ReactNode;
  winFreeCredit?: React.ReactNode;
}) => {
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
    <div className="flex max-w-[calc(100%-28px)] shrink grow items-center">
      <div
        className="relative mr-2 size-6 shrink-0 cursor-pointer"
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
      <div className="flex shrink grow items-center gap-1 overflow-hidden p-1">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              toggleRenameBase();
            }}
          >
            <Input
              ref={inputRef}
              className="h-7 flex-1 shrink"
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
            winFreeCredit={winFreeCredit}
          >
            <div className="flex h-7 items-center gap-2">
              <span className="shrink truncate text-sm" title={base.name}>
                {base.name}
              </span>
              <ChevronDown className="size-4" />
            </div>
          </BaseDropdownMenu>
        )}
      </div>
    </div>
  );
};
