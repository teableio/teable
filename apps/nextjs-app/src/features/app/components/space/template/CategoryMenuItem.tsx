import { Button, cn } from '@teable/ui-lib/shadcn';

interface CategoryMenuItemProps {
  category: string;
  currentCategoryId: string | null;
  id: string | null;
  onClickHandler: (id: string | null) => void;
  className?: string;
}

export const CategoryMenuItem = (props: CategoryMenuItemProps) => {
  const { category, currentCategoryId, id, onClickHandler, className } = props;
  return (
    <Button
      className={cn('h-8 shrink-0 cursor-pointer justify-start px-2 @5xl:w-full', className, {
        'bg-accent': currentCategoryId === id,
      })}
      variant="ghost"
      onClick={() => onClickHandler(id)}
    >
      <span className="truncate text-nowrap text-sm" title={category}>
        {category}
      </span>
    </Button>
  );
};
