import { cn } from '@teable/ui-lib';

export const ConfigItem = (props: {
  className?: string;
  children: React.ReactNode;
  label: string | React.ReactNode;
}) => {
  const { className, children, label } = props;
  return (
    <div className={cn('space-y-2 px-0.5', className)}>
      <label className="text-sm font-normal">{label}</label>
      {children}
    </div>
  );
};
