import { useState, useCallback } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ITableDto } from '@teable/v2-contract-http';

// Types for the condition structure (compatible with v1 IFilter format)
export interface IFilterItem {
  fieldId: string;
  operator: string;
  value?: unknown;
  isSymbol?: boolean;
}

export interface IFilterGroup {
  conjunction: 'and' | 'or';
  filterSet: (IFilterItem | IFilterGroup)[];
}

export interface ConditionValue {
  filter?: IFilterGroup | null;
  sort?: { fieldId: string; order: 'asc' | 'desc' };
  limit?: number;
}

// Available operators based on field type
const TEXT_OPERATORS = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'doesNotContain', label: 'does not contain' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

const NUMBER_OPERATORS = [
  { value: 'is', label: '=' },
  { value: 'isNot', label: '≠' },
  { value: 'isGreater', label: '>' },
  { value: 'isGreaterEqual', label: '≥' },
  { value: 'isLess', label: '<' },
  { value: 'isLessEqual', label: '≤' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

const SELECT_OPERATORS = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'isAnyOf', label: 'is any of' },
  { value: 'isNoneOf', label: 'is none of' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

const MULTI_SELECT_OPERATORS = [
  ...SELECT_OPERATORS,
  { value: 'hasAnyOf', label: 'has any of' },
  { value: 'hasAllOf', label: 'has all of' },
  { value: 'hasNoneOf', label: 'has none of' },
  { value: 'isExactly', label: 'is exactly' },
];

const getOperatorsForFieldType = (fieldType: string) => {
  switch (fieldType) {
    case 'number':
    case 'rating':
    case 'autoNumber':
      return NUMBER_OPERATORS;
    case 'singleSelect':
      return SELECT_OPERATORS;
    case 'multipleSelect':
      return MULTI_SELECT_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
};

const isNullaryOperator = (operator: string) => {
  return operator === 'isEmpty' || operator === 'isNotEmpty';
};

interface FilterItemRowProps {
  item: IFilterItem;
  fields: ITableDto['fields'];
  onChange: (item: IFilterItem) => void;
  onRemove: () => void;
  showRemove: boolean;
}

function FilterItemRow({ item, fields, onChange, onRemove, showRemove }: FilterItemRowProps) {
  const selectedField = fields.find((f) => f.id === item.fieldId);
  const operators = getOperatorsForFieldType(selectedField?.type ?? 'singleLineText');

  return (
    <div className="flex items-center gap-2 py-1">
      <GripVertical className="h-4 w-4 text-muted-foreground cursor-move opacity-50" />

      <Select
        value={item.fieldId}
        onValueChange={(value) => onChange({ ...item, fieldId: value, value: undefined })}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.id} value={field.id}>
              {field.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={item.operator}
        onValueChange={(value) => onChange({ ...item, operator: value })}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Operator" />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!isNullaryOperator(item.operator) && (
        <Input
          value={String(item.value ?? '')}
          onChange={(e) => onChange({ ...item, value: e.target.value })}
          placeholder="Value"
          className="w-[120px]"
        />
      )}

      {showRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

interface FilterGroupProps {
  group: IFilterGroup;
  fields: ITableDto['fields'];
  onChange: (group: IFilterGroup) => void;
  onRemove?: () => void;
  depth?: number;
}

function FilterGroup({ group, fields, onChange, onRemove, depth = 0 }: FilterGroupProps) {
  const addFilterItem = () => {
    const firstField = fields[0];
    const newItem: IFilterItem = {
      fieldId: firstField?.id ?? '',
      operator: 'is',
      value: '',
    };
    onChange({
      ...group,
      filterSet: [...group.filterSet, newItem],
    });
  };

  const addFilterGroup = () => {
    const firstField = fields[0];
    const newGroup: IFilterGroup = {
      conjunction: group.conjunction === 'and' ? 'or' : 'and',
      filterSet: [
        {
          fieldId: firstField?.id ?? '',
          operator: 'is',
          value: '',
        },
      ],
    };
    onChange({
      ...group,
      filterSet: [...group.filterSet, newGroup],
    });
  };

  const updateItem = (index: number, item: IFilterItem | IFilterGroup) => {
    const newFilterSet = [...group.filterSet];
    newFilterSet[index] = item;
    onChange({ ...group, filterSet: newFilterSet });
  };

  const removeItem = (index: number) => {
    const newFilterSet = group.filterSet.filter((_, i) => i !== index);
    onChange({ ...group, filterSet: newFilterSet });
  };

  const isFilterItem = (item: IFilterItem | IFilterGroup): item is IFilterItem => {
    return 'fieldId' in item;
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        depth === 0 ? 'bg-muted/30' : 'bg-background',
        depth > 0 && 'ml-4'
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground">Where</span>
        <Select
          value={group.conjunction}
          onValueChange={(value) => onChange({ ...group, conjunction: value as 'and' | 'or' })}
        >
          <SelectTrigger className="w-[80px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">And</SelectItem>
            <SelectItem value="or">Or</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">of the following are true...</span>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-6 w-6 ml-auto text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="space-y-1">
        {group.filterSet.map((item, index) => (
          <div key={index}>
            {isFilterItem(item) ? (
              <FilterItemRow
                item={item}
                fields={fields}
                onChange={(newItem) => updateItem(index, newItem)}
                onRemove={() => removeItem(index)}
                showRemove={group.filterSet.length > 1}
              />
            ) : (
              <FilterGroup
                group={item}
                fields={fields}
                onChange={(newGroup) => updateItem(index, newGroup)}
                onRemove={() => removeItem(index)}
                depth={depth + 1}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addFilterItem}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add condition
        </Button>
        {depth < 2 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addFilterGroup}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add condition group
          </Button>
        )}
      </div>
    </div>
  );
}

interface ConditionBuilderProps {
  value: ConditionValue;
  onChange: (value: ConditionValue) => void;
  fields: ITableDto['fields'];
  showSort?: boolean;
  showLimit?: boolean;
}

export function ConditionBuilder({
  value,
  onChange,
  fields,
  showSort = true,
  showLimit = true,
}: ConditionBuilderProps) {
  const [showFilter, setShowFilter] = useState(!!value.filter);

  const initFilter = useCallback(() => {
    const firstField = fields[0];
    return {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: firstField?.id ?? '',
          operator: 'is',
          value: '',
        },
      ],
    };
  }, [fields]);

  const handleFilterChange = (filter: IFilterGroup) => {
    onChange({ ...value, filter });
  };

  const handleAddFilter = () => {
    setShowFilter(true);
    if (!value.filter) {
      onChange({ ...value, filter: initFilter() });
    }
  };

  const handleRemoveFilter = () => {
    setShowFilter(false);
    onChange({ ...value, filter: null });
  };

  return (
    <div className="space-y-4">
      {/* Filter Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Filter Conditions</Label>
          {!showFilter ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddFilter}
              disabled={fields.length === 0}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Filter
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemoveFilter}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {showFilter && value.filter && (
          <FilterGroup group={value.filter} fields={fields} onChange={handleFilterChange} />
        )}

        {!showFilter && (
          <p className="text-xs text-muted-foreground">
            No filter conditions. All records will be included.
          </p>
        )}
      </div>

      {/* Sort Section */}
      {showSort && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Sort</Label>
          <div className="flex gap-2">
            <Select
              value={value.sort?.fieldId ?? '__none__'}
              onValueChange={(fieldId) =>
                onChange({
                  ...value,
                  sort:
                    fieldId && fieldId !== '__none__'
                      ? { fieldId, order: value.sort?.order ?? 'asc' }
                      : undefined,
                })
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Sort by field" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No sort</SelectItem>
                {fields.map((field) => (
                  <SelectItem key={field.id} value={field.id}>
                    {field.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {value.sort?.fieldId && (
              <Select
                value={value.sort.order}
                onValueChange={(order) =>
                  onChange({
                    ...value,
                    sort: { ...value.sort!, order: order as 'asc' | 'desc' },
                  })
                }
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Ascending</SelectItem>
                  <SelectItem value="desc">Descending</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}

      {/* Limit Section */}
      {showLimit && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Limit</Label>
          <Input
            type="number"
            min={1}
            value={value.limit ?? ''}
            onChange={(e) => {
              const num = parseInt(e.target.value, 10);
              onChange({
                ...value,
                limit: isNaN(num) || num < 1 ? undefined : num,
              });
            }}
            placeholder="No limit"
            className="w-[120px]"
          />
          <p className="text-xs text-muted-foreground">
            Maximum number of records to include (optional)
          </p>
        </div>
      )}
    </div>
  );
}
