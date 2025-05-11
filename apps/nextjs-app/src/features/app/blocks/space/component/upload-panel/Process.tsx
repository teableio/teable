import { X, TeableNew } from '@teable/icons';
import { cn, Progress } from '@teable/ui-lib';
import { filesize } from 'filesize';
import { renderToString } from 'react-dom/server';

interface IFileItemProps {
  file: File;
  process: number;
  onClose: () => void;
}

export const Process = (props: IFileItemProps) => {
  const { file, onClose, process } = props;
  const { name, size } = file;

  const teaIcon = 'data:image/svg+xml,' + encodeURIComponent(renderToString(TeableNew({})));

  return (
    <>
      <div className="group relative rounded-sm text-sm">
        <img
          className="size-full rounded-sm bg-secondary object-contain p-2"
          src={teaIcon}
          alt={name}
        />
        <div>{name}</div>
        <div>{filesize(size)}</div>
        <X
          className="absolute -right-2 -top-2 hidden size-4 cursor-pointer rounded-full bg-secondary p-0.5 group-hover:block hover:opacity-70"
          onClick={() => onClose()}
        />
      </div>
      {<Progress className={cn('absolute top-0', { hidden: process === 100 })} value={process} />}
    </>
  );
};
