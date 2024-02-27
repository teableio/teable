import { useRef } from 'react';
import { useDropArea } from 'react-use';

interface IUploadProps {
  accept?: React.InputHTMLAttributes<HTMLInputElement>['accept'];
  onChange: (file: File[] | null) => void;
  children: React.ReactElement;
}

export const Upload = (props: IUploadProps) => {
  const { onChange, children, accept } = props;
  const uploadRef = useRef<HTMLInputElement>(null);
  const [bound] = useDropArea({
    onFiles: onChange,
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
        onChange={(e) => {
          e.target.files && onChange(Array.from(e.target.files));
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
