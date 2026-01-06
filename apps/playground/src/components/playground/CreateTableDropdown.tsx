import type { TableTemplateDefinition } from '@teable/v2-table-templates';
import type { VariantProps } from 'class-variance-authority';
import { FileUp, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { ImportCsvDialog } from './ImportCsvDialog';

type CreateTableDropdownProps = {
  templates: ReadonlyArray<TableTemplateDefinition>;
  isCreating: boolean;
  onSelect: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean; recordCount: number }
  ) => void;
  onImportCsv?: (data: { tableName: string; csvData?: string; csvUrl?: string }) => Promise<void>;
  label?: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
  className?: string;
};

export function CreateTableDropdown({
  templates,
  isCreating,
  onSelect,
  onImportCsv,
  label = 'Create table',
  variant = 'default',
  size = 'sm',
  className,
}: CreateTableDropdownProps) {
  const initialRecordCount = templates[0]?.defaultRecordCount ?? 0;
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(templates[0]?.key ?? '');
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === selectedKey) ?? templates[0] ?? null,
    [selectedKey, templates]
  );
  const [includeRecords, setIncludeRecords] = useState(initialRecordCount > 0);
  const [recordCount, setRecordCount] = useState(initialRecordCount);
  const [seedSelectionLocked, setSeedSelectionLocked] = useState(false);

  useEffect(() => {
    if (!templates.length) {
      setSelectedKey('');
      return;
    }
    if (!selectedTemplate) {
      setSelectedKey(templates[0]!.key);
    }
  }, [selectedTemplate, templates]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const defaultCount = selectedTemplate.defaultRecordCount ?? 0;
    setRecordCount(defaultCount);
    if (!seedSelectionLocked) {
      setIncludeRecords(defaultCount > 0);
    }
  }, [seedSelectionLocked, selectedTemplate?.key]);

  const supportsRecords = (selectedTemplate?.defaultRecordCount ?? 0) > 0;
  const selectedTables = selectedTemplate?.tables ?? [];

  const handleRecordCountChange = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setRecordCount(0);
      return;
    }
    setSeedSelectionLocked(true);
    setRecordCount(Math.max(0, Math.floor(parsed)));
  };

  const handleCreate = () => {
    if (!selectedTemplate) return;
    onSelect(selectedTemplate, {
      includeRecords: includeRecords && supportsRecords,
      recordCount: includeRecords && supportsRecords ? recordCount : 0,
    });
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={isCreating || templates.length === 0}
            className={cn('text-xs font-normal', className)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {isCreating ? 'Creating...' : label}
          </Button>
        </DialogTrigger>
        <DialogContent className="flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none sm:max-w-none flex-col">
          <DialogHeader>
            <DialogTitle>Create table</DialogTitle>
            <DialogDescription>
              Pick a template and optionally seed it with example records.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[360px_1fr] lg:grid-cols-[420px_1fr]">
            <div className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-muted/10">
              <div className="border-b border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground">
                Templates
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="p-2">
                  {templates.map((template) => {
                    const selected = template.key === selectedTemplate?.key;
                    const seedCount = template.defaultRecordCount ?? 0;
                    const tableCount = template.tables.length;
                    return (
                      <button
                        key={template.key}
                        type="button"
                        onClick={() => setSelectedKey(template.key)}
                        className={cn(
                          'flex w-full flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left text-sm transition',
                          selected
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-border/70 hover:border-foreground/40'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {template.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] font-normal uppercase">
                              {tableCount} {tableCount === 1 ? 'table' : 'tables'}
                            </Badge>
                            {seedCount > 0 ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-normal uppercase"
                              >
                                {seedCount} records
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                          {template.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="flex min-h-0 flex-col gap-4">
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 pr-1">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {selectedTemplate?.name ?? 'Select a template'}
                    </div>
                    {selectedTemplate ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {selectedTemplate.description}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                    <div className="text-xs font-medium text-muted-foreground">Tables</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {selectedTables.map((table) => (
                        <div
                          key={table.key}
                          className="rounded-md border border-border/70 bg-background/60 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-foreground">
                              {table.name}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="secondary"
                                className="text-[10px] font-normal uppercase"
                              >
                                {table.fieldCount} fields
                              </Badge>
                              {table.defaultRecordCount > 0 ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] font-normal uppercase"
                                >
                                  {table.defaultRecordCount} records
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          {table.description ? (
                            <div className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">
                              {table.description}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">Seed records</div>
                        <div className="text-xs text-muted-foreground">
                          {supportsRecords
                            ? 'Add sample records from the selected template.'
                            : 'This template ships without sample records.'}
                        </div>
                      </div>
                      <Switch
                        checked={includeRecords && supportsRecords}
                        onCheckedChange={(checked) => {
                          setSeedSelectionLocked(true);
                          setIncludeRecords(checked);
                        }}
                        disabled={!supportsRecords}
                      />
                    </div>
                    <div className="mt-3 grid gap-2">
                      <Label htmlFor="record-count" className="text-xs text-muted-foreground">
                        Records per table
                      </Label>
                      <Input
                        id="record-count"
                        type="number"
                        min={0}
                        value={recordCount}
                        onChange={(event) => handleRecordCountChange(event.target.value)}
                        disabled={!supportsRecords || !includeRecords}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={isCreating || !selectedTemplate}>
              {isCreating
                ? 'Creating...'
                : selectedTemplate && selectedTemplate.tables.length > 1
                  ? 'Create tables'
                  : 'Create table'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {onImportCsv && (
        <ImportCsvDialog
          onImport={onImportCsv}
          trigger={
            <Button
              variant="outline"
              size={size}
              disabled={isCreating}
              className={cn('text-xs font-normal', className)}
            >
              <FileUp className="mr-1.5 h-3.5 w-3.5" />
              Import CSV
            </Button>
          }
        />
      )}
    </div>
  );
}
