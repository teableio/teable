import { Trash, TeableNew } from '@teable/icons';
import { Button, cn, Progress } from '@teable/ui-lib';
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
      <div className="max-w-100 group relative flex flex-col items-center gap-4 rounded-lg border px-6 py-8 text-sm">
        <img
          className="size-24 rounded-lg border bg-secondary object-contain p-4"
          src={teaIcon}
          alt={name}
        />
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">{filesize(size)}</div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-2 top-2"
          onClick={() => onClose()}
        >
          <Trash className="size-4 text-muted-foreground" />
        </Button>
      </div>
      {<Progress className={cn('absolute top-0', { hidden: process === 100 })} value={process} />}
    </>
  );
};
