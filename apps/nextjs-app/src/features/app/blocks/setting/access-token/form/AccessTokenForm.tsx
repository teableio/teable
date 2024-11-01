import { ActionPrefix, type Action } from '@teable/core';
import {
  createAccessTokenRoSchema,
  type CreateAccessTokenRo,
  type UpdateAccessTokenRo,
  updateAccessTokenRoSchema,
} from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button, Input, Label, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { RequireCom } from '../../components/RequireCom';
import { ScopesSelect } from '../../components/ScopesSelect';
import { AccessSelect } from './AccessSelect';
import { ExpirationSelect } from './ExpirationSelect';
import { RefreshToken } from './RefreshToken';

export type IFormType = 'new' | 'edit';

type ISubmitData = {
  new: CreateAccessTokenRo;
  edit: UpdateAccessTokenRo;
};

export interface IAccessTokenForm<T extends IFormType = 'new'> {
  id?: string;
  type: T;
  isLoading?: boolean;
  onCancel?: () => void;
  onRefresh?: (token: string) => void;
  onSubmit?: (data: ISubmitData[T]) => void;
  defaultData?: {
    name?: string;
    description?: string;
    scopes?: string[];
    spaceIds?: string[];
    baseIds?: string[];
    expiredTime?: string;
  };
}

export const AccessTokenForm = <T extends IFormType>(props: IAccessTokenForm<T>) => {
  const { type, isLoading, onCancel, onSubmit, onRefresh, defaultData, id } = props;
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);

  const { user } = useSession();

  const [spaceIds, setSpaceIds] = useState<string[] | undefined | null>(defaultData?.spaceIds);
  const [baseIds, setBaseIds] = useState<string[] | undefined | null>(defaultData?.baseIds);
  const [expiredTime, setExpiredTime] = useState<string | undefined>(defaultData?.expiredTime);
  const [name, setName] = useState<string | undefined>(defaultData?.name || '');
  const [description, setDescription] = useState<string | undefined>(
    defaultData?.description || ''
  );
  const [scopes, setScopes] = useState<string[]>(defaultData?.scopes || []);

  const actionsPrefixes = useMemo(() => {
    const prefixes = [
      ActionPrefix.Space,
      ActionPrefix.Base,
      ActionPrefix.Table,
      ActionPrefix.View,
      ActionPrefix.Field,
      ActionPrefix.Record,
      ActionPrefix.Automation,
    ];

    if (user.isAdmin) {
      prefixes.push(ActionPrefix.Instance);
    }
    return prefixes;
  }, [user.isAdmin]);

  const disableSubmit = useMemo(() => {
    if (type === 'new') {
      return !createAccessTokenRoSchema.safeParse({
        name,
        description,
        scopes,
        expiredTime,
        spaceIds,
        baseIds,
      }).success;
    }
    return !updateAccessTokenRoSchema.safeParse({
      name,
      description,
      scopes,
      spaceIds,
      baseIds,
    }).success;
  }, [type, name, description, scopes, expiredTime, spaceIds, baseIds]);

  const onSubmitInner = () => {
    if (type === 'new') {
      return onSubmit?.({
        name: name!,
        description,
        scopes,
        expiredTime: expiredTime!,
        spaceIds,
        baseIds,
      });
    }
    if (type === 'edit') {
      return onSubmit?.({
        name: name!,
        description,
        scopes,
        spaceIds,
        baseIds,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  };

  return (
    <div className="w-full max-w-5xl space-y-3 pl-1">
      {type === 'new' && (
        <>
          <p>{t('token:new.title')}</p>
          <p className="text-xs text-muted-foreground">{t('token:new.description')}</p>
        </>
      )}
      <div className="space-y-2">
        <Label>
          {t('token:name')} <RequireCom />
          <div className="text-xs font-normal text-muted-foreground">
            {t('token:formLabelTips.name')}
          </div>
        </Label>
        <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>
          {t('token:description')}
          <div className="text-xs font-normal text-muted-foreground">
            {t('token:formLabelTips.description')}
          </div>
        </Label>
        <Input
          className="h-8"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        ></Input>
      </div>
      {type === 'new' && (
        <div className="space-y-2">
          <Label>
            {t('token:expiration')} <RequireCom />
          </Label>
          <ExpirationSelect onChange={setExpiredTime} />
        </div>
      )}
      <div className="space-y-2">
        <Label>
          {t('token:scopes')} <RequireCom />
          <div className="text-xs font-normal text-muted-foreground">
            {t('token:formLabelTips.scopes')}
          </div>
        </Label>
        <ScopesSelect
          initValue={scopes as Action[]}
          onChange={setScopes}
          actionsPrefixes={actionsPrefixes}
        />
      </div>
      <div className="space-y-2">
        <Label aria-required>
          {t('token:access')}
          <div className="text-xs font-normal text-muted-foreground">
            {t('token:formLabelTips.access')}
          </div>
        </Label>
        <div>
          <AccessSelect
            value={{ spaceIds: spaceIds || [], baseIds: baseIds || [] }}
            onChange={({ spaceIds, baseIds }) => {
              setSpaceIds(spaceIds.length ? spaceIds : null);
              setBaseIds(baseIds.length ? baseIds : null);
            }}
          />
        </div>
      </div>
      <Separator />
      <div className="space-x-3 text-right">
        {id && <RefreshToken accessTokenId={id} onRefresh={onRefresh} />}
        <Button size={'sm'} variant={'ghost'} onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button size={'sm'} onClick={onSubmitInner} disabled={disableSubmit || isLoading}>
          {isLoading && <Spin />}
          {t('common:actions.submit')}
        </Button>
      </div>
    </div>
  );
};
