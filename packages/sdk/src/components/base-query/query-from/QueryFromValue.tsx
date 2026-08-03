import { X } from '@teable/icons';
import type { IBaseQuery } from '@teable/openapi';
import { Badge, Error } from '@teable/ui-lib';
import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useTables } from '../../../hooks';
import { QueryFormContext } from '../context/QueryFormContext';

export const QueryFromTableValue = ({
  from,
  onChange,
  component,
}: {
  from?: IBaseQuery['from'];
  onChange: (from?: string) => void;
  component?: React.ReactNode;
}) => {
  const tables = useTables();
  const [error, setError] = useState<string>();
  const { registerValidator } = useContext(QueryFormContext);
  const { t } = useTranslation();
  const needValidator = !from || typeof from === 'string';

  useEffect(() => {
    if (from) {
      setError(undefined);
    }
  }, [from]);

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

  const clearFrom = () => {
    onChange(undefined);
  };

  return (
    <div className="flex-1">
      {component ||
        (from && (
          <Badge variant={'outline'} className="mt-0.5 h-6 gap-1">
            {tables.find((table) => table.id === from)?.name}
            <X className="cursor-pointer" onClick={clearFrom} />
          </Badge>
        ))}
      <Error error={error} />
    </div>
  );
};
