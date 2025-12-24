import type { TableTemplateDefinition } from '@teable/v2-table-templates';
import type { VariantProps } from 'class-variance-authority';
import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type CreateTableDropdownProps = {
  templates: ReadonlyArray<TableTemplateDefinition>;
  isCreating: boolean;
  onSelect: (template: TableTemplateDefinition) => void;
  label?: string;
  align?: 'start' | 'center' | 'end';
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
  className?: string;
};

export function CreateTableDropdown({
  templates,
  isCreating,
  onSelect,
  label = 'Create table',
  align = 'start',
  variant = 'default',
  size = 'sm',
  className,
}: CreateTableDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={isCreating}
          className={cn('text-xs font-normal', className)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {isCreating ? 'Creating...' : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold py-1.5">Templates</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {templates.map((template) => (
          <DropdownMenuItem
            key={template.key}
            onSelect={(_event) => {
              onSelect(template);
            }}
            disabled={isCreating}
            className="flex flex-col items-start gap-0 p-2"
          >
            <span className="text-xs font-medium text-foreground">{template.name}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              {template.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
