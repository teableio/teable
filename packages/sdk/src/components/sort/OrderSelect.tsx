import type { FieldCore, SortFunc } from '@teable-group/core';
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
import { useTranslation } from '../../context/app/i18n';
import { useFields } from '../../hooks';

interface IOrderProps {
  value: SortFunc;
  fieldId: string;
  onSelect: (value: SortFunc) => void;
}

function OrderSelect(props: IOrderProps) {
  const { value, onSelect, fieldId } = props;
  const { t } = useTranslation();

  const fields = useFields({ withHidden: true });

  const field = useMemo(() => {
    const map: Record<string, FieldCore> = {};
    fields.forEach((field) => {
      map[field.id] = field;
    });
    return map[fieldId];
  }, [fieldId, fields]);

  const options = useMemo(() => {
    const { cellValueType } = field;

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

    // const SELECTOPTIONS = [
    //   {
    //     value: 'asc',
    //     label: 'first → last',
    //   },
    //   {
    //     value: 'desc',
    //     label: 'last → first',
    //   },
    // ];

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
     * todo
     * for select type
     * sort should sort by option's order
     */
    // if (type === FieldType.SingleSelect || type === FieldType.MultipleSelect) {
    //   option = SELECTOPTIONS;
    // }

    return option || DEFAULTOPTIONS;
  }, [field]);

  return (
    <Select value={value} onValueChange={onSelect}>
      <SelectTrigger className="mx-2 h-8 w-32">
        <SelectValue placeholder={t('common.selectPlaceHolder')} />
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
