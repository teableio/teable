import type { Action, IVisibleScopeGroup } from '@teable/core';
import {
  AccessTokenPreset,
  AccessTokenScopeGroup,
  accessTokenScopeMap,
  adminScopeGroups,
  allActions,
  getAccessTokenPreset,
  getAccessTokenPresetScopes,
  presetScopeGroups,
} from '@teable/core';
import { ChevronRight } from '@teable/icons';
import {
  createAccessTokenRoSchema,
  type CreateAccessTokenRo,
  type UpdateAccessTokenRo,
  updateAccessTokenRoSchema,
} from '@teable/openapi';
import { useSession, useOrganization } from '@teable/sdk/hooks';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import { Button, Input, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import {
  SettingItem,
  SettingSearchInput,
  SettingSection,
  SettingStack,
} from '@/features/app/components/setting/SettingSection';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { RequireCom } from '../../components/RequireCom';
import { AccessSelect } from './AccessSelect';
import { ExpirationSelect } from './ExpirationSelect';
import { RefreshToken } from './RefreshToken';
import { ScopeGroups } from './ScopeGroups';
import { ScopePresets } from './ScopePresets';

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
    hasFullAccess?: boolean;
  };
}

export const AccessTokenForm = <T extends IFormType>(props: IAccessTokenForm<T>) => {
  const { type, isLoading, onCancel, onSubmit, onRefresh, defaultData, id } = props;
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);

  const { user } = useSession();
  const { organization } = useOrganization();

  const [spaceIds, setSpaceIds] = useState<string[] | undefined | null>(defaultData?.spaceIds);
  const [baseIds, setBaseIds] = useState<string[] | undefined | null>(defaultData?.baseIds);
  const [expiredTime, setExpiredTime] = useState<string | undefined>(defaultData?.expiredTime);
  const [name, setName] = useState<string | undefined>(defaultData?.name || '');
  const [description, setDescription] = useState<string | undefined>(
    defaultData?.description || ''
  );
  // A saved token can still hold scopes of retired actions, which the update schema rejects.
  const [scopes, setScopes] = useState<string[]>(
    () =>
      defaultData?.scopes?.filter((scope) => (allActions as readonly string[]).includes(scope)) ??
      getAccessTokenPresetScopes(AccessTokenPreset.Builder)
  );
  const [hasFullAccess, setHasFullAccess] = useState<boolean | undefined>(
    type === 'new' ? true : defaultData?.hasFullAccess
  );
  const preset = useMemo(() => getAccessTokenPreset(scopes), [scopes]);
  // Open the detailed groups when an existing token matches no preset or carries admin scopes.
  const [customOpen, setCustomOpen] = useState(
    () =>
      type === 'edit' &&
      (getAccessTokenPreset(scopes) === null ||
        scopes.some((scope) =>
          (adminScopeGroups as readonly AccessTokenScopeGroup[]).includes(
            accessTokenScopeMap[scope as Action]?.group
          )
        ))
  );
  const [scopeQuery, setScopeQuery] = useState('');
  const [showNoAccessConfirm, setShowNoAccessConfirm] = useState(false);

  const scopeGroups = useMemo(() => {
    const groups: IVisibleScopeGroup[] = [...presetScopeGroups];
    if (user.isAdmin) {
      groups.push(AccessTokenScopeGroup.Instance);
    }
    if (organization?.isAdmin) {
      groups.push(AccessTokenScopeGroup.Enterprise);
    }
    return groups;
  }, [user.isAdmin, organization?.isAdmin]);

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

  const hasDataAccess = useMemo(() => {
    return hasFullAccess || (spaceIds && spaceIds.length > 0) || (baseIds && baseIds.length > 0);
  }, [hasFullAccess, spaceIds, baseIds]);

  const handleSubmit = () => {
    if (!hasDataAccess) {
      setShowNoAccessConfirm(true);
      return;
    }
    onSubmitInner();
  };

  const onSubmitInner = () => {
    if (type === 'new') {
      return onSubmit?.({
        name: name!,
        description,
        scopes,
        expiredTime: expiredTime!,
        spaceIds,
        baseIds,
        hasFullAccess,
      });
    }
    if (type === 'edit') {
      return onSubmit?.({
        name: name!,
        description,
        scopes,
        spaceIds,
        baseIds,
        hasFullAccess,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  };

  return (
    <SettingStack>
      {type === 'new' && (
        <div className="flex flex-col gap-1 text-sm">
          <p>{t('token:new.title')}</p>
          <p className="text-xs text-muted-foreground">{t('token:new.description')}</p>
        </div>
      )}
      <SettingSection title={t('token:form.basics')}>
        <SettingItem
          htmlFor="access-token-name"
          label={
            <>
              {t('token:name')} <RequireCom />
            </>
          }
          description={t('token:formLabelTips.name')}
          action={
            <Input
              id="access-token-name"
              className="w-full sm:w-64"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          }
        />
        <SettingItem
          htmlFor="access-token-description"
          label={t('token:description')}
          description={t('token:formLabelTips.description')}
          action={
            <Input
              id="access-token-description"
              className="w-full sm:w-64"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          }
        />
        {type === 'new' && (
          <SettingItem
            label={
              <>
                {t('token:expiration')} <RequireCom />
              </>
            }
            description={t('token:form.expirationDescription')}
            action={<ExpirationSelect onChange={setExpiredTime} />}
          />
        )}
      </SettingSection>
      <SettingSection
        title={
          <>
            {t('token:permission.title')} <RequireCom />
          </>
        }
        description={t('token:permission.tip')}
        bare
      >
        <div className="flex flex-col gap-3 pt-1.5">
          <ScopePresets
            value={preset}
            onChange={(value) => setScopes(getAccessTokenPresetScopes(value, scopes))}
          />
          {!preset && (
            <div className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              {t('token:permission.customHint')}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ms-3 text-muted-foreground"
              onClick={() => setCustomOpen((open) => !open)}
            >
              <ChevronRight
                className={cn('size-4 shrink-0 transition-transform', customOpen && 'rotate-90')}
              />
              {t('token:permission.customize')}
            </Button>
            <SettingSearchInput
              value={scopeQuery}
              placeholder={t('token:permission.searchPlaceholder')}
              onChange={(e) => setScopeQuery(e.target.value)}
            />
          </div>
          <ScopeGroups
            scopes={scopes}
            groups={scopeGroups}
            onChange={setScopes}
            query={scopeQuery}
            showGroups={customOpen || Boolean(scopeQuery.trim())}
          />
          <div className="text-xs text-muted-foreground">
            {t('token:permission.summary', { count: scopes.length })}
          </div>
        </div>
      </SettingSection>
      <SettingSection
        title={
          <>
            {t('token:access')} <RequireCom />
          </>
        }
        description={t('token:formLabelTips.access')}
        bare
      >
        <div className="pt-1.5">
          <AccessSelect
            value={{ spaceIds: spaceIds || [], baseIds: baseIds || [], hasFullAccess }}
            onChange={({ spaceIds, baseIds, hasFullAccess }) => {
              setSpaceIds(spaceIds?.length ? spaceIds : null);
              setBaseIds(baseIds?.length ? baseIds : null);
              setHasFullAccess(hasFullAccess ?? undefined);
            }}
          />
        </div>
      </SettingSection>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {id && <RefreshToken accessTokenId={id} onRefresh={onRefresh} />}
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={disableSubmit || isLoading}>
          {isLoading && <Spin />}
          {t('common:actions.submit')}
        </Button>
      </div>

      <ConfirmDialog
        open={showNoAccessConfirm}
        onOpenChange={setShowNoAccessConfirm}
        title={t('token:noAccessConfirm.title')}
        content={t('token:noAccessConfirm.description')}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.continue')}
        onCancel={() => setShowNoAccessConfirm(false)}
        onConfirm={() => {
          setShowNoAccessConfirm(false);
          onSubmitInner();
        }}
      />
    </SettingStack>
  );
};
