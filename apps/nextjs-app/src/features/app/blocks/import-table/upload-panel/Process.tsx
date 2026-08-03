import { X } from '@teable/icons';
import { getFieldIconString } from '@teable/sdk';
import { Progress } from '@teable/ui-lib';
import { filesize } from 'filesize';

interface IFileItemProps {
  file: File;
  process: number;
  onClose: () => void;
}

export const Process = (props: IFileItemProps) => {
  const { file, onClose, process } = props;
  const { name, size, type } = file;

  return (
    <>
      <div className="group relative rounded-sm text-sm">
        <img
          className="size-full rounded-sm bg-secondary object-contain p-2"
          src={getFieldIconString(type)}
          alt={name}
        />
        <div>{name}</div>
        <div>{filesize(size)}</div>
        <X
          className="absolute -right-2 -top-2 hidden size-4 cursor-pointer rounded-full bg-secondary p-0.5 group-hover:block hover:opacity-70"
          onClick={() => onClose()}
        />
      </div>
      {<Progress className="absolute top-0" value={process}></Progress>}
    </>
  );
};
