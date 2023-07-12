import AddIcon from '@teable-group/ui-lib/icons/app/add.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { useRef } from 'react';

export const FileInput = (props: { onChange?: (files: FileList) => void }) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    fileList && props.onChange?.(fileList);
    e.target.value = '';
  };

  return (
    <Button
      variant={'ghost'}
      className="m-1 gap-2 font-normal"
      onClick={() => fileInput.current?.click()}
    >
      <input type="file" className="hidden" multiple ref={fileInput} onChange={handleSelectFiles} />
      <AddIcon /> upload
    </Button>
  );
};
