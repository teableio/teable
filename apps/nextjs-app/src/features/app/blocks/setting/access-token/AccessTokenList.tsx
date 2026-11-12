import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessTokenPreset } from '@teable/core';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from '@teable/icons';
import { deleteAccessToken, listAccessToken } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { SettingEmpty } from '@/features/app/components/setting/SettingSection';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';

export const PersonAccessTokenListQueryKey = 'person-access-token-list';

type ISortKey = 'expiredTime' | 'lastUsedTime';

const DAY = 24 * 60 * 60 * 1000;
// "Never expires" is stored as 2099-12-31 by ExpirationSelect.
const NEVER_EXPIRES_YEAR = 2099;

const isNeverExpires = (expiredTime: string) =>
  new Date(expiredTime).getFullYear() >= NEVER_EXPIRES_YEAR;

interface IAccessTokenListProps {
  newToken?: string;
  onEdit: (id: string) => void;
  /** Shown as the empty state's action. */
  onCreate?: () => void;
}

export const AccessTokenList = (props: IAccessTokenListProps) => {
  const { newToken: defaultNewToken, onEdit, onCreate } = props;
  const newTokenRef = useRef<string | undefined>(defaultNewToken);
  const newToken = newTokenRef.current;
  const [sort, setSort] = useState<{ key: ISortKey; desc: boolean }>();
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);
  const [deleteId, setDeleteId] = useState<string>();
  const queryClient = useQueryClient();
  const { data: listResult } = useQuery({
    queryKey: ReactQueryKeys.personAccessTokenList(),
    queryFn: () => listAccessToken().then((data) => data.data),
  });

  const { mutate: deleteAccessTokenMutate, isPending: deleteLoading } = useMutation({
    mutationFn: deleteAccessToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.personAccessTokenList() });
      deleteId &&
        (await queryClient.invalidateQueries({
          queryKey: ReactQueryKeys.personAccessToken(deleteId),
        }));
      setDeleteId(undefined);
    },
  });

  const sortedList = useMemo(() => {
    if (!listResult || !sort) return listResult;
    const value = (time?: string | null) =>
      time ? new Date(time).getTime() : Number.NEGATIVE_INFINITY;
    return [...listResult].sort((a, b) => {
      const x = value(a[sort.key]);
      const y = value(b[sort.key]);
      if (x === y) return 0;
      return (x < y ? -1 : 1) * (sort.desc ? -1 : 1);
    });
  }, [listResult, sort]);

  // Click cycles through descending, ascending and the default order.
  const toggleSort = (key: ISortKey) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, desc: true };
      return prev.desc ? { key, desc: false } : undefined;
    });
  };

  const sortableHead = (key: ISortKey, label: string) => (
    <TableHead>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          sort?.key === key && 'text-foreground'
        )}
        onClick={() => toggleSort(key)}
      >
        {label}
        {sort?.key !== key ? (
          <ArrowUpDown className="size-3.5 text-muted-foreground" />
        ) : sort.desc ? (
          <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUp className="size-3.5" />
        )}
      </button>
    </TableHead>
  );

  const renderExpiration = (expiredTime: string) => {
    if (isNeverExpires(expiredTime)) return t('token:new.expirationList.permanent');
    const date = new Date(expiredTime).toLocaleDateString();
    const msLeft = new Date(expiredTime).getTime() - Date.now();
    if (msLeft <= 0) {
      return (
        <>
          <span className="text-destructive">{t('token:expired')}</span>{' '}
          <span className="text-xs text-muted-foreground">{date}</span>
        </>
      );
    }
    const daysLeft = Math.ceil(msLeft / DAY);
    if (daysLeft <= 7) {
      return (
        <>
          <span className="text-amber-600">{t('token:expiresIn', { count: daysLeft })}</span>{' '}
          <span className="text-xs text-muted-foreground">{date}</span>
        </>
      );
    }
    return date;
  };

  const onDelete = () => {
    if (!deleteId) {
      setDeleteId(undefined);
      return;
    }
    deleteAccessTokenMutate(deleteId);
  };

  return (
    <div className="flex flex-col gap-4">
      {newToken && (
        <div className="rounded-lg border border-green-300 bg-green-300/20 p-4 text-sm dark:border-green-700 dark:bg-green-700/20">
          <div className="font-medium">{t('token:new.success.title')}</div>
          <div className="mb-3 mt-1 text-muted-foreground">
            {t('token:new.success.description')}
          </div>
          <div className="flex items-center gap-2">
            <Input className="w-full text-muted-foreground sm:w-96" readOnly value={newToken} />
            <CopyButton variant="outline" text={newToken} size="xs" iconClassName="size-4" />
          </div>
        </div>
      )}
      {listResult && !listResult.length ? (
        <SettingEmpty
          action={
            onCreate && (
              <Button size="sm" variant="outline" onClick={onCreate}>
                <Plus className="size-4 shrink-0" />
                {t('token:new.button')}
              </Button>
            )
          }
        >
          {t('token:empty.list')}
        </SettingEmpty>
      ) : (
        // Scrolls sideways when the column is narrower than the table; cells keep to one line.
        <div className="overflow-x-auto rounded-lg border">
          <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>{t('token:name')}</TableHead>
                <TableHead>{t('token:access')}</TableHead>
                <TableHead>{t('token:permission.title')}</TableHead>
                <TableHead>{t('token:createdTime')}</TableHead>
                {sortableHead('expiredTime', t('token:expiration'))}
                {sortableHead('lastUsedTime', t('token:lastUse'))}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedList?.map(
                ({
                  id,
                  name,
                  baseIds,
                  spaceIds,
                  hasFullAccess,
                  scopes,
                  expiredTime,
                  lastUsedTime,
                  createdTime,
                }) => {
                  const accessArr: string[] = [];
                  if (hasFullAccess) {
                    accessArr.push(t('token:accessScope.all'));
                  } else {
                    if (baseIds?.length) {
                      accessArr.push(`${baseIds.length} ${t('common:noun.base')}`);
                    }
                    if (spaceIds?.length) {
                      accessArr.push(`${spaceIds.length} ${t('common:noun.space')}`);
                    }
                  }
                  const preset = getAccessTokenPreset(scopes);
                  return (
                    <TableRow key={id}>
                      <TableCell>
                        <Button
                          className="h-auto p-0 font-medium text-foreground"
                          variant="link"
                          size="sm"
                          onClick={() => onEdit(id)}
                        >
                          {name}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {accessArr.length ? accessArr.join(', ') : t('token:empty.access')}
                      </TableCell>
                      <TableCell title={scopes.join('; ')}>
                        <span
                          className={cn(
                            'whitespace-nowrap rounded-full border px-2 py-0.5 text-xs',
                            !preset && 'border-amber-500/40 text-amber-600'
                          )}
                        >
                          {preset
                            ? t(`token:permission.presets.${preset}.name`)
                            : t('token:permission.custom')}
                        </span>
                      </TableCell>
                      <TableCell>{new Date(createdTime).toLocaleDateString()}</TableCell>
                      <TableCell>{renderExpiration(expiredTime)}</TableCell>
                      <TableCell>
                        {lastUsedTime ? new Date(lastUsedTime).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t('common:actions.more')}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(id)}>
                              <Pencil className="size-4" />
                              {t('common:actions.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteId(id)}
                            >
                              <Trash2 className="size-4" />
                              {t('common:actions.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                }
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteId)}
        closeable={true}
        onOpenChange={(val) => {
          if (!val) {
            setDeleteId(undefined);
          }
        }}
        title={t('token:deleteConfirm.title')}
        description={t('token:deleteConfirm.description')}
        onCancel={() => setDeleteId(undefined)}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.confirm')}
        confirmLoading={deleteLoading}
        onConfirm={onDelete}
      />
    </div>
  );
};
