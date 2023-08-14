import type { IOrder, FieldCore } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { Checked, Square } from '@teable-group/icons';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectContent,
  SelectItem,
} from '@teable-group/ui-lib';
import { useMemo } from 'react';
import { useFields } from '../../hooks';

interface IOrderProps {
  value: IOrder;
  column: string;
  onSelect: (value: IOrder) => void;
}
//   if (!type) {
//     return DEFAULTOPTIONS;
//   }

//   switch (type) {
//     case FieldType.SingleLineText:
//       return DEFAULTOPTIONS;
//     case FieldType.Number:
//       return NUMBEROPTIONS;
//     case FieldType.Checkbox:
//       return CHECKBOXOPTIONS;
//     case FieldType.SingleSelect:
//       return SELECTOPTIONS;
//     case FieldType.MultipleSelect:
//       return SELECTOPTIONS;
//     default:
//       return DEFAULTOPTIONS;
//   }
// };

function OrderSelect(props: IOrderProps) {
  const { value, onSelect, column } = props;

  const fields = useFields();

  const field = useMemo(() => {
    const map: Record<string, FieldCore> = {};
    fields.forEach((field) => {
      map[field.dbFieldName] = field;
    });
    return map[column];
  }, [column, fields]);

  const options = useMemo(() => {
    const { type, cellValueType } = field;

    const DEFAULTOPTIONS = [
      {
        value: 'asc',
        label: 'A → Z',
      },
      {
        value: 'desc',
        label: 'Z → A',
      },
    ];

    const NUMBEROPTIONS = [
      {
        value: 'asc',
        label: '1 → 9',
      },
      {
        value: 'desc',
        label: '9 → 1',
      },
    ];

    const SELECTOPTIONS = [
      {
        value: 'asc',
        label: 'first → last',
      },
      {
        value: 'desc',
        label: 'last → first',
      },
    ];

    const CHECKBOXOPTIONS = [
      {
        value: 'asc',
        label: (
          <div className="flex items-center">
            <Square className="w-4 py-px" />
            <span className="px-1">→</span>
            <Checked className="w-4" />
          </div>
        ),
      },
      {
        value: 'desc',
        label: (
          <div className="flex items-center">
            <Checked className="w-4" />
            <span className="px-1">→</span>
            <Square className="w-4 py-px" />
          </div>
        ),
      },
    ];

    let option;

    switch (cellValueType) {
      case 'string':
        option = DEFAULTOPTIONS;
        break;
      case 'number':
        option = NUMBEROPTIONS;
        break;
      case 'boolean':
        option = CHECKBOXOPTIONS;
        break;
      default:
        option = DEFAULTOPTIONS;
        break;
    }

    /**
     * for select type
     * sort should sort by option's order
     */
    if (type === FieldType.SingleSelect || type === FieldType.MultipleSelect) {
      option = SELECTOPTIONS;
    }

    return option || DEFAULTOPTIONS;
  }, [field]);

  return (
    <Select value={value} onValueChange={onSelect}>
      <SelectTrigger className="w-32 mx-2 h-8">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option, index) => (
            <SelectItem value={option.value} key={index}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export { OrderSelect };
