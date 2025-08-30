/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import type { EditorSelection } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { FunctionName } from '@teable/core';
import { FieldType, FormulaLexer } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import type { IFunctionSchema } from '@teable/openapi';
import { Button, cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@teable/ui-lib';
import { CharStreams } from 'antlr4ts';
import Fuse from 'fuse.js';
import { cloneDeep, keyBy } from 'lodash';
import type { FC } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useFieldStaticGetter, useFields } from '../../../hooks';
import { FormulaField } from '../../../model';
import type { ICodeEditorRef } from './components';
import { AiPromptContainer, CodeEditor, FunctionGuide, FunctionHelper } from './components';
import {
  FOCUS_TOKENS_SET,
  Type2IconMap,
  useFormulaFunctionsMap,
  useFunctionsDisplayMap,
} from './constants';
import { THEME_EXTENSIONS, TOKEN_EXTENSIONS, getVariableExtensions } from './extensions';
import type { IFocusToken, IFuncHelpData, IFunctionCollectionItem } from './interface';
import { SuggestionItemType } from './interface';
import { FormulaNodePathVisitor } from './visitor';

interface IFormulaEditorProps {
  expression?: string;
  onConfirm?: (expression: string) => void;
  enableAI?: boolean;
}

export const FormulaEditor: FC<IFormulaEditorProps> = (props) => {
  const { expression, onConfirm, enableAI } = props;
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((field) => field.type !== FieldType.Button);
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const isLightTheme = resolvedTheme === 'light';
  const getFieldStatic = useFieldStaticGetter();
  const listRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ICodeEditorRef | null>(null);
  const suggestionItemRef = useRef<HTMLDivElement | null>(null);
  const [suggestionItemIndex, setSuggestionItemIndex] = useState(0);
  const [focusToken, setFocusToken] = useState<IFocusToken | null>(null);
  const [funcHelpData, setFuncHelpData] = useState<IFuncHelpData | null>(null);
  const [expressionByName, setExpressionByName] = useState<string>((): string => {
    return expression
      ? FormulaField.convertExpressionIdToName(expression, keyBy(fields, 'id'))
      : '';
  });
  const [errMsg, setErrMsg] = useState('');
  const formulaFunctionsMap = useFormulaFunctionsMap();
  const Functions = useMemo(
    () => Array.from(formulaFunctionsMap).map((item) => item[1]),
    [formulaFunctionsMap]
  );
  const functionsDisplayMap = useFunctionsDisplayMap();

  const filteredFields = useMemo(() => {
    const fuse = new Fuse(fields, {
      findAllMatches: true,
      keys: ['name'],
    });
    let searchValue = focusToken?.value || '';
    searchValue = searchValue[0] === '{' ? searchValue.slice(1) : searchValue;
    searchValue =
      searchValue[searchValue.length - 1] === '}' ? searchValue.slice(0, -1) : searchValue;

    return searchValue
      ? fuse.search(searchValue)
      : fields.map((c, i) => ({ item: c, refIndex: i }));
  }, [fields, focusToken]);

  const { orderedFunctionList, formatFunctionList } = useMemo(() => {
    const fuse = new Fuse(Functions, {
      findAllMatches: true,
      keys: ['name'],
    });
    let searchValue = focusToken?.value || '';
    searchValue = searchValue[0] === '{' ? searchValue.slice(1) : searchValue;
    searchValue =
      searchValue[searchValue.length - 1] === '}' ? searchValue.slice(0, -1) : searchValue;

    const orderedFunctionList: IFunctionSchema<FunctionName>[] = [];
    const filteredFunctionList = searchValue
      ? fuse.search(searchValue).map((data) => data.item)
      : Functions;

    const clonedFunctionsDisplayMap = cloneDeep(functionsDisplayMap);

    filteredFunctionList.forEach((item, index) => {
      const funcType = item.func.type;
      clonedFunctionsDisplayMap[funcType].list.push(item);
      if (clonedFunctionsDisplayMap[funcType].sortIndex === -1) {
        clonedFunctionsDisplayMap[funcType].sortIndex = index;
      }
    });

    let formatFunctionList: IFunctionCollectionItem[] = Object.values(clonedFunctionsDisplayMap)
      .filter((item) => item.list.length)
      .sort((prev, next) => prev.sortIndex - next.sortIndex);

    formatFunctionList = formatFunctionList.map((item, index) => {
      if (index > 0) {
        const prevItem = formatFunctionList[index - 1];
        item.prevCount = prevItem.list.length + prevItem.prevCount;
      }
      item.list.forEach((fn) => orderedFunctionList.push(fn));
      return item;
    });

    return {
      orderedFunctionList,
      formatFunctionList,
    };
  }, [Functions, focusToken?.value, functionsDisplayMap]);

  const totalItemCount = filteredFields.length + orderedFunctionList.length;

  const suggestionItem = useMemo(() => {
    if (suggestionItemIndex < 0 || suggestionItemIndex > totalItemCount - 1) {
      return { type: SuggestionItemType.Function, key: '', name: '' };
    }
    if (suggestionItemIndex > filteredFields.length - 1) {
      const realIndex = suggestionItemIndex - filteredFields.length;
      const name = orderedFunctionList[realIndex].name;
      return { type: SuggestionItemType.Function, key: name, name };
    }
    const field = filteredFields[suggestionItemIndex].item;
    return {
      type: SuggestionItemType.Field,
      key: field.id,
      name: field.name,
    };
  }, [filteredFields, suggestionItemIndex, orderedFunctionList, totalItemCount]);

  const {
    type: suggestionItemType,
    key: suggestionItemKey,
    name: suggestionItemName,
  } = suggestionItem;

  const onItemClick = useCallback(() => {
    if (editorRef.current == null) return;
    const editorView = editorRef.current.getEditorView();
    if (editorView == null) return;
    const selection = editorView.state.selection;
    let fromIndex = selection.ranges[0].from;
    let toIndex = fromIndex;
    const { type, name } = suggestionItem;
    const isSuggestionField = type === SuggestionItemType.Field;

    if (name == null) return;

    if (focusToken != null) {
      fromIndex = focusToken.index;
      toIndex = focusToken.index + focusToken.value.length;
    }

    editorView.dispatch({
      changes: {
        from: fromIndex,
        to: toIndex,
        insert: isSuggestionField ? `{${name}}` : `${name}()`,
      },
      selection: {
        anchor: isSuggestionField ? fromIndex + name.length + 2 : fromIndex + name.length + 1,
      },
    });
    editorView.focus();
  }, [focusToken, suggestionItem]);

  const fieldNamesReg = useMemo(() => {
    const fieldNames = fields.map((f) => {
      const name = f.name.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
      return `(\\{${name}\\})`;
    });
    const regStr = fieldNames.join('|');
    return new RegExp(regStr, 'g');
  }, [fields]);

  const extensions = useMemo(() => {
    const commandExtension = keymap.of([
      {
        key: 'ArrowUp',
        run: () => {
          let nextIndex = suggestionItemIndex - 1;
          if (nextIndex < 0) {
            nextIndex = totalItemCount - 1;
          }
          setSuggestionItemIndex(nextIndex);
          requestAnimationFrame(() =>
            suggestionItemRef.current?.scrollIntoView({ block: 'nearest' })
          );
          return true;
        },
      },
      {
        key: 'ArrowDown',
        run: () => {
          let nextIndex = suggestionItemIndex + 1;
          if (nextIndex > totalItemCount - 1) {
            nextIndex = 0;
          }
          setSuggestionItemIndex(nextIndex);
          requestAnimationFrame(() =>
            suggestionItemRef.current?.scrollIntoView({ block: 'nearest' })
          );
          return true;
        },
      },
      {
        key: 'Enter',
        run: () => {
          onItemClick();
          return true;
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]);

    const variableExtensions = getVariableExtensions(fieldNamesReg);

    return [
      commandExtension,
      ...TOKEN_EXTENSIONS,
      ...variableExtensions,
      isLightTheme ? THEME_EXTENSIONS[0] : THEME_EXTENSIONS[1],
    ];
  }, [onItemClick, suggestionItemIndex, totalItemCount, isLightTheme, fieldNamesReg]);

  const functionGuideData = useMemo(() => {
    if (
      suggestionItemType === SuggestionItemType.Function &&
      formulaFunctionsMap.has(suggestionItemKey as FunctionName)
    ) {
      return formulaFunctionsMap.get(
        suggestionItemKey as FunctionName
      ) as IFunctionSchema<FunctionName>;
    }
    if (suggestionItemType === SuggestionItemType.Field) {
      return {
        name: suggestionItemName,
        summary: t('editor.formula.fieldValue', { fieldName: suggestionItemName }),
        definition: `{${suggestionItemName}}`,
        example: `{${suggestionItemName}}`,
      } as Partial<IFunctionSchema<FunctionName>>;
    }
    return {
      name: t('field.title.formula'),
      summary: t('formula.FORMULA.summary'),
      example: t('formula.FORMULA.example'),
    } as unknown as IFunctionSchema<FunctionName>;
  }, [formulaFunctionsMap, suggestionItemKey, suggestionItemName, suggestionItemType, t]);

  const onValueChange = useCallback(
    (value: string) => {
      try {
        const dependFieldMap = keyBy(fields, 'id');
        const expression = FormulaField.convertExpressionNameToId(value, dependFieldMap);
        FormulaField.getParsedValueType(expression, dependFieldMap);
        setErrMsg('');
      } catch (e) {
        setErrMsg((e as Error).message);
      }
      setSuggestionItemIndex(0);
      setExpressionByName(value);
    },
    [fields]
  );

  const onSelectionChange = useCallback((value: string, selection: EditorSelection) => {
    const cursorIndex = selection.ranges[0].from;

    try {
      if (value) {
        const inputStream = CharStreams.fromString(value);
        const lexer = new FormulaLexer(inputStream);
        const allTokens = lexer.getAllTokens();
        allTokens.forEach((token) => {
          const { startIndex, stopIndex, text, type } = token;
          if (cursorIndex - 1 >= startIndex && cursorIndex - 1 <= stopIndex) {
            FOCUS_TOKENS_SET.has(type)
              ? setFocusToken({ value: text || '', index: startIndex })
              : setFocusToken(null);
          }
        });
      } else {
        setFocusToken(null);
      }

      const parser = FormulaField.parse(value);
      const visitor = new FormulaNodePathVisitor(cursorIndex);

      visitor.visit(parser);

      const nearestFunction = visitor.getNearestFunctionNode();
      const paramIndex = visitor.getParamsIndex();
      const funcName = nearestFunction?.func_name().text.toUpperCase() as FunctionName;
      const newFuncHelpData = funcName == null ? null : { funcName, focusParamIndex: paramIndex };

      setFuncHelpData(newFuncHelpData);
    } catch (e) {
      // Parent components for error catching
    }
  }, []);

  const onConfirmInner = () => {
    if (errMsg !== '') return;
    try {
      const expression = FormulaField.convertExpressionNameToId(
        expressionByName,
        keyBy(fields, 'id')
      );
      onConfirm?.(expression);
      setErrMsg('');
    } catch (e) {
      setErrMsg((e as Error).message);
    }
  };

  const codeBg = isLightTheme ? 'bg-slate-100' : 'bg-gray-900';

  const normalContent = (
    <div className="flex h-[360px] w-full">
      <div ref={listRef} className="w-[200px] shrink-0 overflow-y-auto border-r">
        {formatFunctionList.length || filteredFields.length ? (
          <>
            {filteredFields.length > 0 && (
              <div>
                <h3 className="text- py-1 pl-2 text-[13px] font-semibold text-slate-500">
                  {t('functionType.fields')}
                </h3>
                {filteredFields.map((result, index: number) => {
                  const { id, name, type, isLookup, aiConfig } = result.item;
                  const { Icon } = getFieldStatic(type, {
                    isLookup,
                    hasAiConfig: Boolean(aiConfig),
                  });
                  const isSuggestionItem =
                    suggestionItemType === SuggestionItemType.Field && suggestionItemKey === id;
                  return (
                    <div
                      key={id}
                      ref={isSuggestionItem ? suggestionItemRef : null}
                      className={cn(
                        'flex items-center px-2 py-[6px] w-full cursor-pointer text-sm',
                        isSuggestionItem ? codeBg : 'bg-transparent'
                      )}
                      onClick={onItemClick}
                      onMouseEnter={() => setSuggestionItemIndex(index)}
                    >
                      <Icon className="mr-1 size-4 shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {formatFunctionList.map((funcDataList) => {
              const { name: listName, list, prevCount, type } = funcDataList;
              return (
                <div key={listName}>
                  <h3 className="py-1 pl-2 text-[13px] font-semibold text-slate-500">{listName}</h3>
                  {list.map((item, index) => {
                    const { name: funcName } = item;
                    const Icon = Type2IconMap[type];
                    const isSuggestionItem =
                      suggestionItemType === SuggestionItemType.Function &&
                      suggestionItemKey === funcName;

                    return (
                      <div
                        key={funcName}
                        ref={isSuggestionItem ? suggestionItemRef : null}
                        className={cn(
                          'flex items-center px-2 py-[6px] w-full cursor-pointer text-sm',
                          isSuggestionItem ? codeBg : 'bg-transparent'
                        )}
                        onClick={onItemClick}
                        onMouseEnter={() =>
                          setSuggestionItemIndex(filteredFields.length + prevCount + index)
                        }
                      >
                        <Icon className="mr-1 shrink-0" />
                        <span className="truncate">{funcName}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : (
          <div className="pt-2 text-center text-sm">{t('common.search.empty')}</div>
        )}
      </div>
      <FunctionGuide data={functionGuideData} />
    </div>
  );

  return (
    <div className="w-[700px]">
      <div className="flex h-12 w-full items-center justify-between border-b pl-4 pr-2">
        <h1 className="text-base">{t('editor.formula.title')}</h1>
      </div>

      <div className={cn('flex w-full flex-col border-b caret-foreground', codeBg)}>
        <CodeEditor
          ref={editorRef}
          value={expressionByName}
          extensions={extensions}
          onChange={onValueChange}
          onSelectionChange={onSelectionChange}
          placeholder={t('editor.formula.placeholder')}
        />
        <div className="h-5 w-full truncate px-2 text-xs text-destructive">{errMsg}</div>
      </div>
      <div className="flex h-[52px] w-full items-center justify-between border-b px-2">
        <div className="mr-2 flex flex-1 flex-col justify-center overflow-hidden">
          <FunctionHelper funcHelpData={funcHelpData} />
        </div>
        <Button size={'sm'} className="ml-2" onClick={onConfirmInner}>
          {t('common.confirm')}
        </Button>
      </div>
      {enableAI ? (
        <Tabs defaultValue="normal" className="w-full overflow-auto">
          <TabsList className="grid w-full grid-cols-2 rounded-none border-b">
            <TabsTrigger value="normal" className="py-1.5 text-xs">
              {t('editor.formula.editExpression')}
            </TabsTrigger>
            <TabsTrigger value="ai" className="py-1.5 text-xs">
              {t('editor.formula.generateExpressionByAI')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="normal" className="mt-0 data-[state=inactive]:hidden" forceMount>
            {normalContent}
          </TabsContent>
          <TabsContent
            value="ai"
            className="mt-0 space-y-4 data-[state=inactive]:hidden"
            forceMount
          >
            <AiPromptContainer onApply={onValueChange} />
          </TabsContent>
        </Tabs>
      ) : (
        normalContent
      )}
    </div>
  );
};
