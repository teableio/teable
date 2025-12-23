import type { TableTemplateDefinition } from '@teable/v2-table-templates';
import type { VariantProps } from 'class-variance-authority';
import { Plus } from 'lucide-react';

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
  size = 'default',
  className,
}: CreateTableDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={isCreating} className={className}>
          <Plus className="mr-2 h-4 w-4" />
          {isCreating ? 'Creating...' : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72">
        <DropdownMenuLabel>Templates</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {templates.map((template) => (
          <DropdownMenuItem
            key={template.key}
            onSelect={(_event) => {
              onSelect(template);
            }}
            disabled={isCreating}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <span className="text-sm font-medium text-foreground">{template.name}</span>
            <span className="text-xs text-muted-foreground">{template.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
