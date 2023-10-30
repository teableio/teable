import { Plus } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';
import { useRef } from 'react';

export const FileInput = (props: { onChange?: (files: File[]) => void }) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    fileList && props.onChange?.(Array.from(fileList));
    e.target.value = '';
  };

  return (
    <Button
      variant={'ghost'}
      className="m-1 gap-2 font-normal"
      onClick={() => fileInput.current?.click()}
    >
      <input type="file" className="hidden" multiple ref={fileInput} onChange={handleSelectFiles} />
      <Plus /> upload
    </Button>
  );
};
