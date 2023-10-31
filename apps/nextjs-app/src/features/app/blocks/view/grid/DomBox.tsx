import { RecordMenu, FieldMenu, FieldSetting, StatisticMenu, GridTooltip } from './components';

export const DomBox = () => {
  return (
    <>
      {<FieldMenu />}
      {<RecordMenu />}
      {<FieldSetting />}
      {<StatisticMenu />}
      {<GridTooltip />}
    </>
  );
};
