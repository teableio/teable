import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Selector } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';

interface IEditableSpaceSelect {
  spaceId: string;
  value: string | null;
  onChange: (spaceId: string) => void;
}

export const EditableSpaceSelect: React.FC<React.PropsWithChildren<IEditableSpaceSelect>> = (
  props
) => {
  const { value, onChange, spaceId } = props;
  const { t } = useTranslation(['sdk']);
  const [targetSpaceId, setTargetSpaceId] = useState<string>(value || '');
  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const editableSpaceList = useMemo(() => {
    return (
      spaceList?.filter(
        (space) => hasPermission(space.role, 'base|create') && spaceId !== space.id
      ) || []
    );
  }, [spaceId, spaceList]);

  return (
    <Selector
      className="min-w-40"
      candidates={editableSpaceList}
      selectedId={targetSpaceId}
      placeholder={t('sdk:common.selectPlaceHolder')}
      onChange={(id) => {
        setTargetSpaceId(id);
        onChange(id);
      }}
    />
  );
};
