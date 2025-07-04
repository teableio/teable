import { cn, Skeleton } from '@teable/ui-lib/shadcn';
import { useState } from 'react';

interface IFrameLoadingProps extends React.HTMLAttributes<HTMLIFrameElement> {
  src: string;
  wrapperClassName?: string;
}

export const IFrameLoading = (props: IFrameLoadingProps) => {
  const { title, wrapperClassName, ...rest } = props;
  const [loading, setLoading] = useState(true);

  return (
    <div className={cn('relative size-full', wrapperClassName)}>
      <iframe
        {...rest}
        onLoad={() => {
          setLoading(false);
        }}
        title={title}
      />
      {loading && <Skeleton className="absolute inset-0 size-full bg-accent" />}
    </div>
  );
};
