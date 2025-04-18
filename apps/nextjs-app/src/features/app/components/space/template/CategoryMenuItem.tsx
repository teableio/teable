import { Button, cn } from '@teable/ui-lib/shadcn';

interface CategoryMenuItemProps {
  category: string;
  currentCategoryId: string;
  id: string;
  onClickHandler: (id: string) => void;
}

export const CategoryMenuItem = (props: CategoryMenuItemProps) => {
  const { category, currentCategoryId, id, onClickHandler } = props;
  return (
    <Button
      className={cn('w-full justify-start', {
        'bg-secondary': currentCategoryId === id,
      })}
      variant="ghost"
      onClick={() => onClickHandler(id)}
    >
      <span className="truncate text-nowrap text-sm font-medium" title={category}>
        {category}
      </span>
    </Button>
  );
};
