import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useTables } from '../../../hooks';
import { QueryFormContext } from '../context/QueryFormContext';

export const useQueryFromTableValidation = (from?: string, needValidator?: boolean) => {
  const tables = useTables();
  const [error, setError] = useState<string>();
  const { registerValidator } = useContext(QueryFormContext);
  const { t } = useTranslation();

  const validator = useCallback(() => {
    setError(undefined);
    if (!from) {
      setError(t('baseQuery.error.requiredSelect'));
      return false;
    }
    if (!tables.some((table) => table.id === from)) {
      setError(t('baseQuery.error.invalidTable'));
      return false;
    }
    return true;
  }, [from, tables, t]);

  useEffect(() => {
    if (needValidator) {
      registerValidator('from', validator);
    }
    return () => {
      registerValidator('from', undefined);
    };
  }, [registerValidator, validator, needValidator]);

  return error;
};
