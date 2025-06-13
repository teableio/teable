import type { IDateFieldOptions } from '@teable/core';
import { defaultDatetimeFormatting, normalizeDateFormatting, TimeFormatting } from '@teable/core';
import { Input } from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import {
  forwardRef,
  Fragment,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { DateEditorMain } from '../../editor';
import { convertZonedInputToUtc, formatDisplayValue } from '../../editor/date/utils';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { GRID_DEFAULT } from '../../grid/configs';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

const GridDateEditorBase: ForwardRefRenderFunction<
  IEditorRef<string>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { record, field, rect, style, theme, isEditing, setEditing } = props;
  const dateTime = record.getCellValue(field.id) as string;
  const options = field.options as IDateFieldOptions;
  const formatting = options?.formatting || defaultDatetimeFormatting;
  const { date: dateFormatting, time: timeFormatting } = formatting;
  const { cellLineColorActived } = theme;
  const { width, height } = rect;

  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<IEditorRef<string>>(null);
  const [inputValue, setInputValue] = useState('');
  const { t } = useTranslation();

  const finalRect = useMemo(() => ({ ...rect, height: height + 2 }), [rect, height]);
  const attachStyle = useGridPopupPosition(finalRect);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus?.(),
    setValue: (value?: string) => {
      setInputValue(formatDisplayValue(value || '', formatting));
      editorRef.current?.setValue?.(value);
    },
    saveValue: () => {
      if (!isEditing) return;
      const value = convertZonedInputToUtc(inputValue, formatting);
      onCalendarChange(value);
    },
  }));

  useEffect(() => {
    setInputValue(formatDisplayValue(dateTime || '', formatting));
  }, [dateTime, formatting]);

  const onCalendarChange = (dateStr?: string | null) => {
    if (dateStr == dateTime) return;

    record.updateCell(field.id, dateStr ?? null, { t });

    if (timeFormatting === TimeFormatting.None) {
      setEditing?.(false);
    }
  };

  const attachInputStyle = useMemo(() => {
    const style: React.CSSProperties = {
      width: width + 4,
      height: height + 4,
      marginLeft: -1.5,
      marginTop: -2,
    };
    if (height > defaultRowHeight) {
      style.paddingBottom = height - defaultRowHeight;
    }
    return style;
  }, [width, height]);

  return (
    <Fragment>
      <Input
        ref={inputRef}
        value={inputValue}
        placeholder={`${normalizeDateFormatting(dateFormatting)} ${timeFormatting !== TimeFormatting.None ? timeFormatting : ''}`}
        style={{
          ...style,
          ...attachInputStyle,
          border: `2px solid ${cellLineColorActived}`,
        }}
        className="absolute left-0 top-0 h-8 w-full text-[13px] shadow-none focus-visible:ring-transparent"
        onChange={(e) => setInputValue(e.target.value)}
      />
      <DateEditorMain
        ref={editorRef}
        className="absolute rounded-md border bg-background"
        style={{
          ...style,
          ...attachStyle,
          minWidth: 250,
          maxHeight: 'auto',
        }}
        value={dateTime}
        options={options}
        onChange={onCalendarChange}
      />
    </Fragment>
  );
};

export const GridDateEditor = forwardRef(GridDateEditorBase);
