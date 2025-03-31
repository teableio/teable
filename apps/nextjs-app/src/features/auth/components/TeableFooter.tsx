import { cn } from '@teable/ui-lib/shadcn';
import { TeableLogo } from '@/components/TeableLogo';
import { useBrand } from '@/features/app/hooks/useBrand';

interface ITeableHeaderProps {
  className?: string;
  enableClick?: boolean;
}

export const TeableFooter = (props: ITeableHeaderProps) => {
  const { className, enableClick } = props;
  const { brandName } = useBrand();

  return (
    <div
      data-state={enableClick ? 'click' : undefined}
      className={cn(
        'max-w-6xl mx-auto w-full flex items-center justify-center gap-2 data-[state=click]:cursor-pointer font-bold',
        className
      )}
    >
      <TeableLogo className="size-8" />
      {brandName}
    </div>
  );
};
