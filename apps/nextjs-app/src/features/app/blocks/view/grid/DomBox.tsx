import { RecordMenu, FieldMenu, FieldSetting } from './components';

export const DomBox = () => {
  return (
    <>
      {<FieldMenu />}
      {<RecordMenu />}
      {<FieldSetting />}
    </>
  );
};
