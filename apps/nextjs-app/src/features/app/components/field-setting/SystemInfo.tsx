import { LocalStorageKeys } from '@teable-group/sdk/config/local-storage-keys';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { useLocalStorage } from 'react-use';

export const SystemInfo: React.FC<{ fieldInstance?: IFieldInstance }> = ({ fieldInstance }) => {
  const [show, setShow] = useLocalStorage<boolean>(LocalStorageKeys.FieldSystem);

  if (!fieldInstance) {
    return null;
  }

  return show ? (
    <div className="flex flex-col space-y-1 border-b border-slate-200 pb-2">
      <p className="text-xs">
        <span className="select-none text-slate-400">id: </span>
        {fieldInstance.id}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">dbName: </span>
        {fieldInstance.dbFieldName}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">dbType: </span>
        {fieldInstance.dbFieldType}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">cellValueType: </span>
        {fieldInstance.cellValueType}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">isMultipleCellValue: </span>
        {fieldInstance.isMultipleCellValue ? 'true' : 'false'}
      </p>
      <p className="text-xs">
        <span className="select-none text-slate-400">isComputed: </span>
        {fieldInstance.isComputed ? 'true' : 'false'}
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
