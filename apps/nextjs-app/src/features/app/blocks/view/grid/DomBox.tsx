import { RecordMenu, FieldMenu, FieldSetting, StatisticMenu } from './components';

export const DomBox = () => {
  return (
    <>
      {<FieldMenu />}
      {<RecordMenu />}
      {<FieldSetting />}
      {<StatisticMenu />}
    </>
  );
};
