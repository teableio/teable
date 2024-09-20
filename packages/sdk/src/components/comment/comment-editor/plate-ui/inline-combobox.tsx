import {
  Combobox,
  ComboboxItem,
  type ComboboxItemProps,
  ComboboxPopover,
  ComboboxProvider,
  Portal,
  useComboboxContext,
  useComboboxStore,
} from '@ariakit/react';
import { cn } from '@udecode/cn';
import { filterWords } from '@udecode/plate-combobox';
import {
  type UseComboboxInputResult,
  useComboboxInput,
  useHTMLInputCursorState,
} from '@udecode/plate-combobox/react';
import {
  type TElement,
  createPointRef,
  getPointBefore,
  insertText,
  moveSelection,
} from '@udecode/plate-common';
import { findNodePath, useComposedRef, useEditorRef } from '@udecode/plate-common/react';
import { cva } from 'class-variance-authority';
import React, {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  createContext,
  forwardRef,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { PointRef } from 'slate';
import { useModalRefElement } from '../../../expand-record/useModalRefElement';

type FilterFn = (item: { keywords?: string[]; value: string }, search: string) => boolean;

interface InlineComboboxContextValue {
  filter: FilterFn | false;
  inputProps: UseComboboxInputResult['props'];
  inputRef: RefObject<HTMLInputElement>;
  removeInput: UseComboboxInputResult['removeInput'];
  setHasEmpty: (hasEmpty: boolean) => void;
  showTrigger: boolean;
  trigger: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const InlineComboboxContext = createContext<InlineComboboxContextValue>(null as any);

export const defaultFilter: FilterFn = ({ keywords = [], value }, search) =>
  [value, ...keywords].some((keyword) => filterWords(keyword, search));

interface InlineComboboxProps {
  children: ReactNode;
  element: TElement;
  trigger: string;
  filter?: FilterFn | false;
  hideWhenNoValue?: boolean;
  setValue?: (value: string) => void;
  showTrigger?: boolean;
  value?: string;
}

const InlineCombobox = ({
  children,
  element,
  filter = defaultFilter,
  hideWhenNoValue = false,
  setValue: setValueProp,
  showTrigger = true,
  trigger,
  value: valueProp,
}: InlineComboboxProps) => {
  const editor = useEditorRef();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cursorState = useHTMLInputCursorState(inputRef);

  const [valueState, setValueState] = useState('');
  const hasValueProp = valueProp !== undefined;
  const value = hasValueProp ? valueProp : valueState;

  const setValue = useCallback(
    (newValue: string) => {
      setValueProp?.(newValue);

      if (!hasValueProp) {
        setValueState(newValue);
      }
    },
    [setValueProp, hasValueProp]
  );

  /**
   * Track the point just before the input element so we know where to
   * insertText if the combobox closes due to a selection change.
   */
  const [insertPoint, setInsertPoint] = useState<PointRef | null>(null);

  useEffect(() => {
    const path = findNodePath(editor, element);

    if (!path) return;

    const point = getPointBefore(editor, path);

    if (!point) return;

    const pointRef = createPointRef(editor, point);
    setInsertPoint(pointRef);

    return () => {
      pointRef.unref();
    };
  }, [editor, element]);

  const { props: inputProps, removeInput } = useComboboxInput({
    cancelInputOnBlur: false,
    cursorState,
    onCancelInput: (cause) => {
      if (cause !== 'backspace') {
        insertText(editor, trigger + value, {
          at: insertPoint?.current ?? undefined,
        });
      }
      if (cause === 'arrowLeft' || cause === 'arrowRight') {
        moveSelection(editor, {
          distance: 1,
          reverse: cause === 'arrowLeft',
        });
      }
    },
    ref: inputRef,
  });

  const [hasEmpty, setHasEmpty] = useState(false);

  const contextValue: InlineComboboxContextValue = useMemo(
    () => ({
      filter,
      inputProps,
      inputRef,
      removeInput,
      setHasEmpty,
      showTrigger,
      trigger,
    }),
    [trigger, showTrigger, filter, inputRef, inputProps, removeInput, setHasEmpty]
  );

  const store = useComboboxStore({
    // open: ,
    setValue: (newValue) => startTransition(() => setValue(newValue)),
  });

  const items = store.useState('items');

  /**
   * If there is no active ID and the list of items changes, select the first
   * item.
   */
  useEffect(() => {
    if (!store.getState().activeId) {
      store.setActiveId(store.first());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, store]);

  return (
    <span contentEditable={false}>
      <ComboboxProvider
        open={(items.length > 0 || hasEmpty) && (!hideWhenNoValue || value.length > 0)}
        store={store}
      >
        <InlineComboboxContext.Provider value={contextValue}>
          {children}
        </InlineComboboxContext.Provider>
      </ComboboxProvider>
    </span>
  );
};

const InlineComboboxInput = forwardRef<HTMLInputElement, HTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, propRef) => {
    const {
      inputProps,
      inputRef: contextRef,
      showTrigger,
      trigger,
    } = useContext(InlineComboboxContext);

    const store = useComboboxContext()!;
    const value = store.useState('value');

    const ref = useComposedRef(propRef, contextRef);

    /**
     * To create an auto-resizing input, we render a visually hidden span
     * containing the input value and position the input element on top of it.
     * This works well for all cases except when input exceeds the width of the
     * container.
     */

    return (
      <>
        {showTrigger && trigger}

        <span className="relative min-h-[1lh]">
          <span aria-hidden="true" className="invisible overflow-hidden text-nowrap">
            {value || '\u200B'}
          </span>

          <Combobox
            autoSelect
            className={cn('absolute left-0 top-0 size-full bg-transparent outline-none', className)}
            ref={ref}
            value={value}
            {...inputProps}
            {...props}
          />
        </span>
      </>
    );
  }
);

InlineComboboxInput.displayName = 'InlineComboboxInput';

const InlineComboboxContent: typeof ComboboxPopover = ({ className, ...props }) => {
  const ref = useModalRefElement();
  // Portal prevents CSS from leaking into popover
  return (
    <Portal portalElement={ref.current}>
      <ComboboxPopover
        className={cn(
          'z-[500] max-h-[288px] w-[300px] overflow-y-auto rounded-md bg-white shadow-md dark:bg-slate-950',
          className
        )}
        {...props}
      />
    </Portal>
  );
};

const comboboxItemVariants = cva(
  'relative flex h-9 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
  {
    defaultVariants: {
      interactive: true,
    },
    variants: {
      interactive: {
        false: '',
        true: 'cursor-pointer transition-colors hover:bg-slate-100 hover:text-slate-900 data-[active-item=true]:bg-slate-100 data-[active-item=true]:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-50 dark:data-[active-item=true]:bg-slate-800 dark:data-[active-item=true]:text-slate-50',
      },
    },
  }
);

export type InlineComboboxItemProps = {
  keywords?: string[];
} & ComboboxItemProps &
  Required<Pick<ComboboxItemProps, 'value'>>;

const InlineComboboxItem = ({
  className,
  keywords,
  onClick,
  ...props
}: InlineComboboxItemProps) => {
  const { value } = props;

  const { filter, removeInput } = useContext(InlineComboboxContext);

  const store = useComboboxContext()!;

  // Optimization: Do not subscribe to value if filter is false
  const search = filter && store.useState('value');

  const visible = useMemo(
    () => !filter || filter({ keywords, value }, search as string),
    [filter, value, keywords, search]
  );

  if (!visible) return null;

  return (
    <ComboboxItem
      className={cn(comboboxItemVariants(), className)}
      onClick={(event) => {
        removeInput(true);
        onClick?.(event);
      }}
      {...props}
    />
  );
};

const InlineComboboxEmpty = ({ children, className }: HTMLAttributes<HTMLDivElement>) => {
  const { setHasEmpty } = useContext(InlineComboboxContext);
  const store = useComboboxContext()!;
  const items = store.useState('items');

  useEffect(() => {
    setHasEmpty(true);

    return () => {
      setHasEmpty(false);
    };
  }, [setHasEmpty]);

  if (items.length > 0) return null;

  return (
    <div className={cn(comboboxItemVariants({ interactive: false }), className)}>{children}</div>
  );
};

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxInput,
  InlineComboboxItem,
};
