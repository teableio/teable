import { cn } from '../shadcn';

interface IErrorProps {
  className?: string;
  error?: string;
}

const ErrorMessage = (props: IErrorProps) => {
  const { error, className } = props;

  if (!error) return null;

  return (
    <div
      data-state={error ? 'show' : 'hide'}
      className={cn('data-[state=show]:mt-2 text-sm text-destructive transition-all', className)}
    >
      {error}
    </div>
  );
};

// Exported under the historical name; the declaration avoids shadowing the global Error.
export { ErrorMessage as Error };
