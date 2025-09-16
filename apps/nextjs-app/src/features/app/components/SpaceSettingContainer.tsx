import { cn } from '@teable/ui-lib/shadcn';

interface SpaceSettingContainerProps {
  title: string;
  description?: string | React.ReactElement;
  className?: string;
  children: React.ReactNode | React.ReactNode[];
  headerClassName?: string;
  wrapperClassName?: string;
  titleClassName?: string;
}

export const SpaceSettingContainer = ({
  title,
  description,
  className,
  children,
  headerClassName,
  wrapperClassName,
  titleClassName,
}: SpaceSettingContainerProps) => {
  return (
    <div className={cn('h-screen w-full overflow-y-auto overflow-x-hidden', wrapperClassName)}>
      <div className={cn('w-full px-8 py-6', headerClassName)}>
        <div className={cn('border-b pb-4', titleClassName)}>
          <h1 className="text-3xl font-semibold">{title}</h1>
          {description && <div className="mt-3 text-sm text-slate-500">{description}</div>}
        </div>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
};
