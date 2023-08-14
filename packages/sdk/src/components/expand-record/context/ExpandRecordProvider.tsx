import type { IRecord } from '@teable-group/core';
import { useCallback, type FC, type PropsWithChildren, useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import { IExpandRecordModel, ExpandRecordContext } from './ExpandRecordContext';

export const ExpandRecordProvider: FC<
  PropsWithChildren<{
    serverData?: IRecord;
  }>
> = (props) => {
  const { children, serverData } = props;
  const [hideActivity, setHideActivity] = useLocalStorage<boolean>('hideActivity', true);
  const [model, setModel] = useLocalStorage<IExpandRecordModel>(
    'expandRecordModel',
    IExpandRecordModel.Panel
  );

  const updateHideActivity = useCallback(
    (val?: boolean) => {
      setHideActivity(val);
    },
    [setHideActivity]
  );

  const updateModel = useCallback(
    (val?: IExpandRecordModel) => {
      setModel(val);
    },
    [setModel]
  );

  const value = useMemo(() => {
    return { model, hideActivity, updateModel, updateHideActivity, serverData };
  }, [model, hideActivity, updateModel, updateHideActivity, serverData]);

  return <ExpandRecordContext.Provider value={value}>{children}</ExpandRecordContext.Provider>;
};
