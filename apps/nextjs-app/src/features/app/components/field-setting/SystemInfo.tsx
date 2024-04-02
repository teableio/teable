import type { IFieldVo } from '@teable/core';
import { LocalStorageKeys } from '@teable/sdk/config/local-storage-keys';
import { useLocalStorage } from 'react-use';

// eslint-disable-next-line sonarjs/cognitive-complexity
export const SystemInfo: React.FC<{ field: Partial<IFieldVo> }> = ({ field }) => {
  const [show, setShow] = useLocalStorage<boolean>(LocalStorageKeys.FieldSystem);

  if (!field.id) {
    return null;
  }

  return show ? (
    <div className="flex flex-col space-y-1 border-b border-slate-200 pb-2">
      <p className="text-xs">
        <span className="select-none text-slate-400">id: </span>
        {field.id}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">dbName: </span>
        {field.dbFieldName}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">dbType: </span>
        {field.dbFieldType}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">cellValueType: </span>
        {field.cellValueType}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">isMultipleCellValue: </span>
        {field.isMultipleCellValue ? 'true' : 'false'}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">isPrimary: </span>
        {field.isPrimary ? 'true' : 'false'}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">isComputed: </span>
        {field.isComputed ? 'true' : 'false'}
      </p>
      <p className="text-left text-xs font-medium">
        <span
          onClick={() => {
            setShow(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setShow(false);
            }
          }}
          tabIndex={0}
          role={'button'}
          className="cursor-pointer border-b border-solid border-slate-500 "
        >
          Hide
        </span>
      </p>
    </div>
  ) : (
    <div className="absolute right-0">
      <p className="text-xs font-medium text-slate-500">
        <span
          onClick={() => {
            setShow(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setShow(true);
            }
          }}
          tabIndex={0}
          role={'button'}
          className="cursor-pointer border-b border-solid border-slate-500 "
        >
          System Info
        </span>
      </p>
    </div>
  );
};
