import { GridTooltip } from '@teable/sdk/components';
import type { FC } from 'react';
import { RecordMenu, FieldMenu, FieldSetting, StatisticMenu, GroupHeaderMenu } from './components';

export const DomBox: FC<{ id?: string }> = (props) => {
  const { id } = props;

  return (
    <>
      <FieldMenu />
      <RecordMenu />
      <GroupHeaderMenu />
      <FieldSetting />
      <StatisticMenu />
      <GridTooltip id={id} />
    </>
  );
};
