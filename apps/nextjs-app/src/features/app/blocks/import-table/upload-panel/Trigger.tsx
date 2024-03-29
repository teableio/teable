import type { SUPPORTEDTYPE } from '@teable/openapi';
import { importTypeMap } from '@teable/openapi';
import { useRef } from 'react';
import { useDropArea } from 'react-use';

interface IUploadProps {
  fileType: SUPPORTEDTYPE;
  onChange: (file: File | null) => void;
  children: React.ReactElement;
}

export const Trigger = (props: IUploadProps) => {
  const { onChange, children, fileType } = props;
  const uploadRef = useRef<HTMLInputElement>(null);

  const [bound] = useDropArea({
    onFiles: (files: File[]) => onChange(files[0]),
  });

  return (
    <>
      <input
        className="hidden"
        ref={uploadRef}
        type="file"
        accept={importTypeMap[fileType].accept}
        multiple={false}
        autoComplete="off"
        tabIndex={-1}
        onChange={(e) => {
          const files = (e.target.files && Array.from(e.target.files)) || null;
          files && onChange(files[0]);
        }}
      ></input>
      <div
        role="button"
        tabIndex={0}
        className="size-full"
        onClick={() => {
          if (uploadRef?.current) {
            uploadRef.current.value = '';
            uploadRef?.current?.click();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            uploadRef?.current?.click();
          }
        }}
        {...bound}
      >
        {children}
      </div>
    </>
  );
};
