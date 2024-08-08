import { cn } from '../shadcn';

interface IErrorProps {
  className?: string;
  error?: string;
}

export const Error = (props: IErrorProps) => {
  const { error, className } = props;

  return (
    <div
      data-state={error ? 'show' : 'hide'}
      className={cn(
        'data-[state=show]:mt-2 data-[state=show]:animate-slide-down-normal data-[state=hide]:animate-slide-up-normal text-sm text-destructive transition-all',
        className
      )}
    >
      {error}
    </div>
  );
};
