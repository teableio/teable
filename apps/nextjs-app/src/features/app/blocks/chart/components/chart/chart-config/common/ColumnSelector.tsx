import { useContentDir } from '@teable/sdk/hooks';
import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@teable/ui-lib';

export const ColumnSelector = (props: {
  value?: string;
  onChange: (value: string) => void;
  columns: {
    name: string;
    column: string;
  }[];
  className?: string;
}) => {
  const { className, value, onChange, columns } = props;
  const contentDir = useContentDir();

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          'h-8',
          {
            'text-muted-foreground': !value,
          },
          className
        )}
      >
        <SelectValue placeholder="Select a column" />
      </SelectTrigger>
      <SelectContent>
        {columns.map((column) => (
          <SelectItem key={column.column} value={column.column}>
            <span dir={contentDir}>{column.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
