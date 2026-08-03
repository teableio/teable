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
    <div className={cn('h-full w-full', wrapperClassName)}>
      <div className={cn('h-full w-full flex flex-col p-6', headerClassName)}>
        <div className={cn('pb-6', titleClassName)}>
          <p className="text-lg font-semibold">{title}</p>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        <div className={cn('overflow-y-auto flex flex-col flex-1 gap-6', className)}>
          {children}
        </div>
      </div>
    </div>
  );
};
