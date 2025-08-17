import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Action } from '@teable/core';
import { ArrowUpRight, Plus } from '@teable/icons';
import { deleteAccessToken, listAccessToken } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { usePermissionActionsStatic } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
  Button,
  Input,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';

export const PersonAccessTokenListQueryKey = 'person-access-token-list';

export const AccessTokenList = (props: { newToken?: string }) => {
  const { newToken: defaultNewToken } = props;
  const newTokenRef = useRef<string | undefined>(defaultNewToken);
  const newToken = newTokenRef.current;
  const router = useRouter();
  const { actionStaticMap } = usePermissionActionsStatic();
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);
  const [deleteId, setDeleteId] = useState<string>();
  const queryClient = useQueryClient();
  const { data: listResult } = useQuery({
    queryKey: ReactQueryKeys.personAccessTokenList(),
    queryFn: () => listAccessToken().then((data) => data.data),
  });

  const { mutate: deleteAccessTokenMutate, isLoading: deleteLoading } = useMutation({
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

  const onEdit = (id: string) => {
    router.push({
      pathname: router.pathname,
      query: { form: 'edit', id },
    });
  };

  const onDelete = () => {
    if (!deleteId) {
      setDeleteId(undefined);
      return;
    }
    deleteAccessTokenMutate(deleteId);
  };

  return (
    <>
      {newToken && (
        <div className="rounded border border-green-300 bg-green-300/20 p-3 text-sm dark:border-green-700 dark:bg-green-700/20">
          <div>{t('token:new.success.title')}</div>
          <div className="mb-4 mt-2">{t('token:new.success.description')}</div>
          <div className="flex items-center gap-3">
            <Input className="h-8 w-[26rem] text-muted-foreground" readOnly value={newToken} />
            <CopyButton variant="outline" text={newToken} size="xs" iconClassName="size-4" />
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size={'xs'} variant="link" className="space-x-1" asChild>
          <Link href="/developer/tool/query-builder">
            <ArrowUpRight />
            {t('developer:apiQueryBuilder')}
          </Link>
        </Button>
        <Button
          size={'xs'}
          className="space-x-1"
          onClick={() =>
            router.push({
              pathname: router.pathname,
              query: { form: 'new' },
            })
          }
        >
          <Plus />
          {t('token:new.button')}
        </Button>
      </div>
      <Table>
        {!listResult?.length && (
          <TableCaption className="text-center">{t('token:empty.list')}</TableCaption>
        )}
        <TableHeader>
          <TableRow>
            <TableHead>{t('token:name')}</TableHead>
            <TableHead>{t('token:access')}</TableHead>
            <TableHead>{t('token:scopes')}</TableHead>
            <TableHead>{t('token:createdTime')}</TableHead>
            <TableHead>{t('token:expiration')}</TableHead>
            <TableHead>{t('token:lastUse')}</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listResult?.map(
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
                accessArr.push(t('token:accessSelect.fullAccess.title'));
              } else {
                if (baseIds?.length) {
                  accessArr.push(`${baseIds.length} ${t('common:noun.base')}`);
                }
                if (spaceIds?.length) {
                  accessArr.push(`${spaceIds.length} ${t('common:noun.space')}`);
                }
              }
              const scopesMoreLen = scopes.slice(2).length;
              return (
                <TableRow key={id}>
                  <TableCell>
                    <Button
                      className="underline"
                      variant={'link'}
                      size={'sm'}
                      onClick={() => onEdit(id)}
                    >
                      {name}
                    </Button>
                  </TableCell>
                  <TableCell>
                    {accessArr.length ? accessArr.join(', ') : t('token:empty.access')}
                  </TableCell>
                  <TableCell title={scopes.join('; ')}>
                    {scopes
                      .slice(0, 2)
                      .map((action) => actionStaticMap[action as Action].description)
                      .join('; ')}
                    {scopesMoreLen ? ` ${t('token:moreScopes', { len: scopesMoreLen })}` : ''}
                  </TableCell>
                  <TableCell>{new Date(createdTime).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(expiredTime).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {lastUsedTime ? new Date(lastUsedTime).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size={'sm'}
                      variant="outline"
                      className="h-7 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => setDeleteId(id)}
                    >
                      {t('common:actions.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            }
          )}
        </TableBody>
      </Table>
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
    </>
  );
};
