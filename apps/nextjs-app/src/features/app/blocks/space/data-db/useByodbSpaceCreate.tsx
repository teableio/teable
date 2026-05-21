import { useMutation } from '@tanstack/react-query';
import { preflightSpaceDataDb, type IDataDbPreflightVo } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { ByodbSpaceCreateSection } from './ByodbSpaceCreateSection';
import {
  canCreateSpaceWithDataDb,
  getCreateSpaceDataDbPayload,
  isByodbSpaceCreateEnabled,
} from './create-space-data-db';

export const useByodbSpaceCreate = () => {
  const { t } = useTranslation('space');
  const { edition } = useEnv();
  const enabled = isByodbSpaceCreateEnabled(edition);
  const [dataDbMode, setDataDbMode] = useState<'default' | 'byodb'>('default');
  const [dataDbUrl, setDataDbUrl] = useState('');
  const [preflightResult, setPreflightResult] = useState<IDataDbPreflightVo>();
  const [preflightTestedUrl, setPreflightTestedUrl] = useState<string>();
  const [preflightError, setPreflightError] = useState<string>();

  const { mutateAsync: preflightDataDb, isPending: isPreflightPending } = useMutation({
    mutationFn: preflightSpaceDataDb,
  });

  const reset = useCallback(() => {
    setDataDbMode('default');
    setDataDbUrl('');
    setPreflightResult(undefined);
    setPreflightTestedUrl(undefined);
    setPreflightError(undefined);
  }, []);

  const handlePreflightDataDb = useCallback(async () => {
    const url = dataDbUrl.trim();
    if (!url) return;

    try {
      const result = await preflightDataDb({ url, targetMode: 'initialize-empty' });
      setPreflightResult(result.data);
      setPreflightTestedUrl(url);
      setPreflightError(undefined);
    } catch {
      setPreflightResult(undefined);
      setPreflightTestedUrl(undefined);
      setPreflightError(t('dataDb.create.testFailed'));
    }
  }, [dataDbUrl, preflightDataDb, t]);

  const getPayload = useCallback(
    () => getCreateSpaceDataDbPayload(dataDbMode, dataDbUrl),
    [dataDbMode, dataDbUrl]
  );

  const confirmDisabled = !canCreateSpaceWithDataDb(
    dataDbMode,
    dataDbUrl,
    preflightResult,
    preflightTestedUrl
  );

  const content = enabled ? (
    <ByodbSpaceCreateSection
      mode={dataDbMode}
      url={dataDbUrl}
      preflightResult={preflightResult}
      preflightError={preflightError}
      testedUrl={preflightTestedUrl}
      isTesting={isPreflightPending}
      onModeChange={setDataDbMode}
      onUrlChange={(url) => {
        setDataDbUrl(url);
        setPreflightResult(undefined);
        setPreflightTestedUrl(undefined);
        setPreflightError(undefined);
      }}
      onTestConnection={handlePreflightDataDb}
    />
  ) : undefined;

  return {
    enabled,
    content,
    confirmDisabled: enabled ? confirmDisabled : false,
    getPayload: enabled ? getPayload : undefined,
    reset: enabled ? reset : undefined,
  };
};
