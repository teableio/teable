import { Button, cn } from '@teable/ui-lib/shadcn';

interface CategoryMenuItemProps {
  category: string;
  currentCategoryId: string | null;
  id: string | null;
  onClickHandler: (id: string | null) => void;
}

export const CategoryMenuItem = (props: CategoryMenuItemProps) => {
  const { category, currentCategoryId, id, onClickHandler } = props;
  return (
    <Button
      className={cn('px-2 h-8 cursor-pointer w-full justify-start', {
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
