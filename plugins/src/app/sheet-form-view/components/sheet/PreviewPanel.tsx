import { useMutation } from '@tanstack/react-query';
import { FieldKeyType, FieldType } from '@teable/core';
import type { ICreateRecordsRo } from '@teable/openapi';
import { createRecords, shareViewFormSubmit } from '@teable/openapi';
import type { IFieldInstance } from '@teable/sdk';
import { useIsHydrated, useView, useTableId, useFields } from '@teable/sdk';
import { Spin, Button, toast } from '@teable/ui-lib';
import type { IWorkbookData } from '@univerjs/core';
import { lazy, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useInitializationZodI18n } from '../../../../hooks/useInitializationZodI18n';
import { SheetSkeleton } from './SheetSkeleton';
import type { IUniverSheetProps, IUniverSheetRef } from './UniverSheet';
import { clearTemplateMarker, getRecordRangesMap, getLetterCoordinateByRange } from './utils';
const UniverSheet = lazy(() => import('./UniverSheet'));

interface IPreviewPanel extends IUniverSheetProps {
  shareId?: string;
}

export const PreviewPanel = (props: IPreviewPanel) => {
  const { shareId, workBookData, ...restProps } = props;
  const isHydrated = useIsHydrated();
  const view = useView();
  const { t } = useTranslation();
  const tableId = useTableId();
  const univerRef = useRef<IUniverSheetRef>(null);
  const fields = useFields({ withHidden: true, withDenied: true });
  useInitializationZodI18n();

  const proxyCellValue2RecordValue = (field: IFieldInstance, cellValue: unknown) => {
    const { type } = field;

    if (!field || !cellValue) {
      return;
    }

    switch (type) {
      case FieldType.Rating:
      case FieldType.Number: {
        return Number(cellValue);
      }
      case FieldType.Checkbox: {
        return Boolean(cellValue);
      }
      case FieldType.MultipleSelect: {
        const value = String(cellValue);
        return value?.split(',');
      }
      case FieldType.Date: {
        return new Date(cellValue as string).toISOString();
      }
      case FieldType.Link: {
        return cellValue;
      }
      default:
        return String(cellValue);
    }
  };

  const getRecordsMap = useCallback(() => {
    const fieldRangesMap = getRecordRangesMap(workBookData?.sheets?.['sheet1']?.cellData);
    const fieldsMap: Record<
      string,
      {
        cellValue: unknown;
        fieldIns: IFieldInstance;
        coordinate: string;
        cellCoordinate?: [number, number, number, number];
      }
    > = {};

    for (const key in fieldRangesMap) {
      const range = fieldRangesMap[key];
      const field = fields.find((f) => f.id === key) as IFieldInstance;
      const cellValue = univerRef?.current?.getCellValueByRange(fieldRangesMap[key]);
      fieldsMap[key] = {
        cellValue: proxyCellValue2RecordValue(field, cellValue),
        fieldIns: fields.find((f) => f.id === key) as IFieldInstance,
        coordinate: getLetterCoordinateByRange(range),
        cellCoordinate: univerRef?.current?.getWholeRangesFromPartial(fieldRangesMap[key]),
      };
    }

    return fieldsMap;
  }, [fields, workBookData?.sheets]);

  const setCellRules = (field: IFieldInstance, range?: [number, number, number, number]) => {
    const { type, isComputed } = field;

    if (isComputed || !range) {
      return;
    }

    switch (type) {
      case FieldType.SingleSelect: {
        const cellOption = field.options.choices.map((c) => c.name);
        univerRef?.current?.setCellSelectRulesByRange(range, cellOption, false);
        break;
      }
      case FieldType.MultipleSelect: {
        const cellOption = field.options.choices.map((c) => c.name);
        univerRef?.current?.setCellSelectRulesByRange(range, cellOption, true);
        break;
      }
      case FieldType.Checkbox: {
        univerRef?.current?.setCellCheckBoxByRange(range);
        break;
      }
      case FieldType.Date: {
        univerRef?.current?.setCellDateByRange(range);
        break;
      }
      case FieldType.Number: {
        univerRef?.current?.setCellNumberByRange(range);
        break;
      }
      default:
        break;
    }
  };

  useEffect(() => {
    const initCellRules = () => {
      if (univerRef?.current && fields?.length) {
        const recordMap = getRecordsMap();
        Object.values(recordMap).forEach(({ cellCoordinate, fieldIns }) => {
          setCellRules(fieldIns, cellCoordinate);
        });
      }
    };

    const timeoutId = setTimeout(initCellRules, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [fields, getRecordsMap]);

  const newWorkBookData = useMemo(
    () =>
      ({
        ...workBookData,
        sheets: {
          ['sheet1']: {
            ...workBookData?.sheets?.['sheet1'],
            cellData: clearTemplateMarker(workBookData?.sheets?.['sheet1']?.cellData),
          },
        },
      }) as IWorkbookData,
    [workBookData]
  );

  const resetWorkBookData = () => {
    setTimeout(() => {
      const recordsMap = getRecordsMap();
      Object.entries(recordsMap).forEach(([, value]) => {
        univerRef.current?.setCellValueByRange(value.cellCoordinate, '');
      });
    }, 100);
  };

  const { mutateAsync: submitFormFn, isLoading: submitFormLoading } = useMutation({
    mutationFn: ({
      shareId,
      fields,
      typecast,
    }: {
      shareId: string;
      fields: Record<string, unknown>;
      typecast: boolean;
    }) => shareViewFormSubmit({ shareId, fields, typecast }),
    onSuccess: () => {
      resetWorkBookData();
      toast({ description: t('tooltips.submitSuccess') });
    },
  });

  const { mutateAsync: submitTestFn } = useMutation({
    mutationFn: ({ tableId, recordsRo }: { tableId: string; recordsRo: ICreateRecordsRo }) =>
      createRecords(tableId, recordsRo),
    onSuccess: () => {
      resetWorkBookData();
      toast({ description: t('tooltips.submitSuccess') });
    },
  });

  const submitForm = async () => {
    univerRef.current?.exitCellEditor();
    setTimeout(() => {
      const recordsMap = getRecordsMap();
      const fieldsArray = Object.values(recordsMap);
      const submitField: Record<string, unknown> = {};
      Object.entries(recordsMap).forEach(([key, v]) => {
        submitField[key] = v.cellValue;
      });

      const validateErrors: { coordinate: string; errorMessage: string }[] = [];

      fieldsArray.forEach((f) => {
        const res = f.fieldIns.validateCellValue(f.cellValue);
        // TODO don't check link using typecast
        if (!res?.success && f.cellValue !== undefined && f.fieldIns.type !== FieldType.Link) {
          validateErrors.push({
            coordinate: f.coordinate,
            errorMessage: res?.error?.issues?.[0]?.message,
          });
        }
      });

      if (validateErrors.length) {
        const firstError = validateErrors[0];
        toast({
          variant: 'destructive',
          description: (
            <div className="flex flex-col">
              <span>
                {t('validation.coordinate')}: {firstError.coordinate}
              </span>

              <span>
                {t('validation.errorInfo')}:{' '}
                {firstError.errorMessage || t('validation.unknownError')},
              </span>
            </div>
          ),
          title: t('validation.validateError'),
        });
        return;
      }

      if (shareId) {
        submitFormFn({ shareId, fields: submitField, typecast: true });
      } else {
        submitTestFn({
          tableId: tableId!,
          recordsRo: { fieldKeyType: FieldKeyType.Id, records: [{ fields: submitField }] },
        });
      }
    }, 0);
  };

  return (
    <div className="flex size-full flex-col items-center justify-start p-1">
      <div className="size-full overflow-hidden">
        <div className="mb-1 flex h-8 w-full justify-between px-2">
          <span>{view?.name}</span>
          <Button size="sm" className="px-6" onClick={submitForm}>
            {submitFormLoading && <Spin />}
            {t('toolbar.submit')}
          </Button>
        </div>
        {isHydrated ? (
          <UniverSheet
            {...restProps}
            workBookData={newWorkBookData}
            toolbarVisible={false}
            footerVisible={false}
            ref={univerRef}
            validate={true}
          />
        ) : (
          <SheetSkeleton className="p-1" />
        )}
      </div>
    </div>
  );
};
