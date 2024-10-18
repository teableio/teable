'use client';

import type {
  IWorkbookData,
  ICommandInfo,
  IWorksheetData,
  ISelectionCellWithMergeInfo,
} from '@univerjs/core';
import { Univer, LocaleType, UniverInstanceType, Tools } from '@univerjs/core';
import { AddDataValidationMutation, UniverDataValidationPlugin } from '@univerjs/data-validation';
import { defaultTheme, greenTheme } from '@univerjs/design';
import DesignEnUs from '@univerjs/design/locale/en-US';
import DesignZhCN from '@univerjs/design/locale/zh-CN';

import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import DocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { FUniver } from '@univerjs/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import SheetsZhCN from '@univerjs/sheets/locale/zh-CN';

import {
  AddSheetDataValidationCommand,
  UniverSheetsDataValidationPlugin,
} from '@univerjs/sheets-data-validation';
import SheetsDataValidationEnUS from '@univerjs/sheets-data-validation/locale/en-US';
import SheetsDataValidationZhCN from '@univerjs/sheets-data-validation/locale/zh-CN';

import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import SheetsFormulaEnUS from '@univerjs/sheets-formula/locale/en-US';
import SheetsFormulaZhCN from '@univerjs/sheets-formula/locale/zh-CN';

import { UniverSheetsUIPlugin, AddRangeProtectionFromToolbarCommand } from '@univerjs/sheets-ui';
import SheetsUIEnUs from '@univerjs/sheets-ui/locale/en-US';
import SheetsUIZhCN from '@univerjs/sheets-ui/locale/zh-CN';

import { UniverUIPlugin } from '@univerjs/ui';
import UIEnUS from '@univerjs/ui/locale/en-US';
import UIZhCN from '@univerjs/ui/locale/zh-CN';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDebounce } from 'react-use';
import { DarkTheme } from '../theme';
import { DefaultSheetId } from './constant';

export interface IUniverSheetRef {
  insertActiveCell: (value: string) => void;
  insertCellByRange: (
    range: [number, number, number, number],
    value: { name: string; id: string }
  ) => void;
  getActiveWorkBookData: () => IWorkbookData | undefined;
  getActiveSheetCellData: () => IWorksheetData['cellData'] | undefined;
  getCellValueByRange: (range: [number, number]) => unknown;
  getCellByPartialRanges: (range: [number, number]) => ISelectionCellWithMergeInfo | undefined;
  exitCellEditor: () => void;
  getWholeRangesFromPartial: (range: [number, number]) => [number, number, number, number];
  setCellSelectRulesByRange: (
    range: [number, number, number, number],
    option: string[],
    isMultiple?: boolean
  ) => void;
  setCellCheckBoxByRange: (range: [number, number, number, number]) => void;
  setCellDateByRange: (range: [number, number, number, number]) => void;
  setCellNumberByRange: (range: [number, number, number, number]) => void;
  setCellValueByRange: (range?: [number, number, number, number], value?: unknown) => void;
}

export interface IUniverSheetProps {
  workBookData?: IWorkbookData;
  toolbarVisible?: boolean;
  footerVisible?: boolean;
  validate?: boolean;
  onChange?: (workBookData: IWorkbookData) => void;
  onDragDrop?: (cell: [number, number, number, number]) => void;
}

// eslint-disable-next-line react/display-name
const UniverSheet = forwardRef<IUniverSheetRef, IUniverSheetProps>((props, ref) => {
  const {
    toolbarVisible = true,
    footerVisible = false,
    validate = false,
    workBookData: remoteWorkBookData,
    onChange,
    onDragDrop,
  } = props;
  const containerRef = useRef(null);
  const fUniverRef = useRef<FUniver | null>(null);
  const workBookData = useMemo(
    () => ({
      ...remoteWorkBookData,
      locale: LocaleType.ZH_CN,
    }),
    [remoteWorkBookData]
  );

  const {
    i18n: { resolvedLanguage },
  } = useTranslation();

  const insertActiveCell = useCallback((value: string) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const range = sheet?.getActiveRange();
    range?.setValue({
      v: value,
    });
  }, []);

  const insertCellByRange = useCallback(
    (
      range: [number, number, number, number],
      value: {
        name: string;
        id: string;
      }
    ) => {
      const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
      const ranges = sheet?.getRange(...range);
      const { name, id } = value;
      ranges?.setValue({
        v: `{{${name}}}`,
        custom: {
          fieldId: id,
        },
      });
    },
    []
  );

  const setCellValueByRange = useCallback(
    (range?: [number, number, number, number], value?: unknown) => {
      if (range?.length) {
        const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
        const ranges = sheet?.getRange(...range);
        ranges?.setValue({
          v: value as string,
        });
      }
    },
    []
  );

  const getCellValueByRange = (ranges: [number, number]) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const startRange = sheet?.getRange(...ranges);
    const cell = startRange?.getCell();
    const wholeRange = cell?.isMerged
      ? [
          cell.mergeInfo.startRow,
          cell.mergeInfo.startColumn,
          cell.mergeInfo.endRow - cell.mergeInfo.startRow,
          cell.mergeInfo.endColumn - cell.mergeInfo.startColumn,
        ]
      : (ranges as number[]);
    const range = sheet?.getRange(wholeRange[0], wholeRange[1], wholeRange[2], wholeRange[3]);
    return range?.getValue();
  };

  const getWholeRangesFromPartial = (
    ranges: [number, number]
  ): [number, number, number, number] => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const startRange = sheet?.getRange(...ranges);
    const cell = startRange?.getCell();

    return cell?.isMerged
      ? [
          cell.mergeInfo.startRow,
          cell.mergeInfo.startColumn,
          cell.mergeInfo.endRow - cell.mergeInfo.startRow + 1,
          cell.mergeInfo.endColumn - cell.mergeInfo.startColumn + 1,
        ]
      : [ranges[0], ranges[1], 1, 1];
  };

  const getCellByPartialRanges = (ranges: [number, number]) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const range = sheet?.getRange(...ranges);
    return range?.getCell();
  };

  const getActiveWorkBookData = useCallback(() => {
    const activeWorkbook = fUniverRef?.current?.getActiveWorkbook();
    return activeWorkbook?.save();
  }, []);

  const getActiveSheetCellData = useCallback(() => {
    const workBookData = getActiveWorkBookData();
    return workBookData?.sheets?.[DefaultSheetId]?.cellData;
  }, [getActiveWorkBookData]);

  const setCellSelectRulesByRange = (
    range: [number, number, number, number],
    option: string[],
    isMultiple = false
  ) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const ranges = sheet?.getRange(...range);

    const dataValidationBuilder = FUniver.newDataValidation();
    const dataValidation = dataValidationBuilder.requireValueInList(option, isMultiple).build();
    ranges?.setDataValidation(dataValidation);
  };

  const setCellCheckBoxByRange = (range: [number, number, number, number]) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const ranges = sheet?.getRange(...range);

    const dataValidationBuilder = FUniver.newDataValidation();
    const dataValidation = dataValidationBuilder.requireCheckbox('true', 'false').build();
    ranges?.setDataValidation(dataValidation);
  };

  const setCellDateByRange = (range: [number, number, number, number]) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const ranges = sheet?.getRange(...range);

    const dataValidationBuilder = FUniver.newDataValidation();
    const dataValidation = dataValidationBuilder
      .requireDateBetween(new Date('1990'), new Date('2100'))
      .build();
    ranges?.setDataValidation(dataValidation);
  };

  const setCellNumberByRange = (range: [number, number, number, number]) => {
    const sheet = fUniverRef?.current?.getActiveWorkbook()?.getActiveSheet();
    const ranges = sheet?.getRange(...range);

    const dataValidationBuilder = FUniver.newDataValidation();
    const dataValidation = dataValidationBuilder.requireNumberBetween(-Infinity, Infinity).build();
    ranges?.setDataValidation(dataValidation);
  };

  const exitCellEditor = () => {
    fUniverRef?.current?.executeCommand('sheet.operation.set-cell-edit-visible', {
      visible: false,
    });
  };

  const [commandQueue, setCommandQueue] = useState<ICommandInfo[]>([]);

  useImperativeHandle(ref, () => ({
    insertActiveCell,
    insertCellByRange,
    getActiveWorkBookData,
    getActiveSheetCellData,
    getCellValueByRange,
    exitCellEditor,
    getCellByPartialRanges,
    getWholeRangesFromPartial,
    setCellSelectRulesByRange,
    setCellCheckBoxByRange,
    setCellDateByRange,
    setCellNumberByRange,
    setCellValueByRange,
  }));

  useDebounce(
    () => {
      const newWorkBookData = getActiveWorkBookData();
      if (commandQueue.length > 0) {
        newWorkBookData && onChange?.(newWorkBookData);
        setCommandQueue([]);
      }
    },
    1000,
    [commandQueue]
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const univer = new Univer({
      theme: greenTheme || defaultTheme || DarkTheme,
      locale: resolvedLanguage === 'zh' ? LocaleType.ZH_CN : LocaleType.EN_US,
      locales: {
        [LocaleType.ZH_CN]: Tools.deepMerge(
          SheetsZhCN,
          DocsUIZhCN,
          SheetsUIZhCN,
          SheetsFormulaZhCN,
          UIZhCN,
          DesignZhCN,
          SheetsDataValidationZhCN
        ),
        [LocaleType.EN_US]: Tools.deepMerge(
          SheetsEnUS,
          DocsUIEnUS,
          SheetsUIEnUs,
          SheetsFormulaEnUS,
          UIEnUS,
          DesignEnUs,
          SheetsDataValidationEnUS
        ),
      },
    });

    // core plugins
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
      container: containerRef.current,
      toolbar: toolbarVisible,
      footer: footerVisible,
    });

    univer.registerPlugin(UniverDocsPlugin, {
      hasScroll: false,
    });
    univer.registerPlugin(UniverDocsUIPlugin);

    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin, {
      menu: {
        [AddRangeProtectionFromToolbarCommand.id]: {
          hidden: true,
        },
        [AddSheetDataValidationCommand.id]: {
          hidden: true,
        },
        [AddDataValidationMutation.id]: {
          hidden: true,
        },
      },
    });

    // sheet feature plugins
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);

    if (validate) {
      univer.registerPlugin(UniverDataValidationPlugin);
      univer.registerPlugin(UniverSheetsDataValidationPlugin, {
        // Whether to show the edit button in the dropdown menu
        // version >= 0.2.16
        showEditOnDropdown: false,
      });
    }

    // create univer sheet instance
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, workBookData || {});

    fUniverRef.current = FUniver.newAPI(univer);
    fUniverRef.current.onCommandExecuted((command) => {
      onChange && setCommandQueue((prev) => [...prev, command]);
    });

    fUniverRef.current.getSheetHooks().onCellDrop((cell) => {
      const row = cell?.location?.row;
      const col = cell?.location?.col;
      if (row !== undefined && col !== undefined) {
        const ranges = getWholeRangesFromPartial([row, col]);
        onDragDrop?.(ranges);
      }
    });
  }, [
    footerVisible,
    onChange,
    onDragDrop,
    resolvedLanguage,
    toolbarVisible,
    validate,
    workBookData,
  ]);

  return (
    <div
      className="size-full rounded"
      ref={containerRef}
      style={{
        borderRadius: '0.5rem',
      }}
    />
  );
});

export default UniverSheet;
