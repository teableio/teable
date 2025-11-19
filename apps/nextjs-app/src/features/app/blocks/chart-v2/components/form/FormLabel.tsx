import { cn } from '@teable/ui-lib';

export const FormLabel = (props: {
  label: string;
  children: React.ReactNode;
  className?: string;
  labelClassName?: string;
}) => {
  const { children, label, className, labelClassName } = props;

  return (
    <div className={cn('flex size-full flex-col gap-2', className)}>
      <span className={cn('text-sm font-medium', labelClassName)}>{label}</span>
      {children}
    </div>
  );
};
