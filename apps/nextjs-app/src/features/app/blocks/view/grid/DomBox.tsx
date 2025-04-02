import { GridTooltip } from '@teable/sdk/components';
import type { FC } from 'react';
import { RecordMenu, FieldMenu, FieldSetting, StatisticMenu } from './components';

export const DomBox: FC<{ id?: string }> = (props) => {
  const { id } = props;

  return (
    <>
      <FieldMenu />
      <RecordMenu />
      <FieldSetting />
      <StatisticMenu />
      <GridTooltip id={id} />
    </>
  );
};
