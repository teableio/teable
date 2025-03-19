import { useRef } from 'react';
import { useDropArea } from 'react-use';

interface IUploadProps {
  accept?: string;
  onChange: (file: File | null) => void;
  onBeforeUpload?: () => void;
  children: React.ReactElement;
}

export const Trigger = (props: IUploadProps) => {
  const { onChange, children, accept, onBeforeUpload } = props;
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
        accept={accept}
        multiple={false}
        autoComplete="off"
        tabIndex={-1}
        onChange={async (e) => {
          onBeforeUpload?.();
          const files = (e.target.files && Array.from(e.target.files)) || null;
          if (files && files.length > 0) {
            onChange(files[0]);
          }
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
