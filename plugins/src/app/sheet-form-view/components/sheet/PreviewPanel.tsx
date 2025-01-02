import { useMutation, useQuery } from '@tanstack/react-query';
import { FieldType } from '@teable/core';
import type { IRecordsVo, UserCollaboratorItem } from '@teable/openapi';
import {
  shareViewFormSubmit,
  getShareViewCollaborators,
  getBaseCollaboratorList,
  getShareViewLinkRecords,
  getRecords,
  ShareViewLinkRecordsType,
  PrincipalType,
} from '@teable/openapi';
import type { IFieldInstance, LinkField } from '@teable/sdk';
import { useIsHydrated, useView, useFields } from '@teable/sdk';
import { Spin, Button, toast } from '@teable/ui-lib';
import type { IWorkbookData } from '@univerjs/core';
import { uniq, get } from 'lodash';
import { lazy, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useInitializationZodI18n } from '../../../../hooks/useInitializationZodI18n';
import { LinkDisplayCount, DefaultSheetId } from './constant';
import { SheetSkeleton } from './SheetSkeleton';
import type { IUniverSheetProps, IUniverSheetRef } from './UniverSheet';
import { getPreviewSheetData, getRecordRangesMap, getLetterCoordinateByRange } from './utils';
const UniverSheet = lazy(() => import('./UniverSheet'));

interface IPreviewPanel extends IUniverSheetProps {
  shareId?: string;
  baseId?: string;
}

export const PreviewPanel = (props: IPreviewPanel) => {
  const { shareId, baseId, workBookData, ...restProps } = props;
  const isHydrated = useIsHydrated();
  const view = useView();
  const { t } = useTranslation();
  const univerRef = useRef<IUniverSheetRef>(null);
  const fields = useFields({ withHidden: true, withDenied: true });
  useInitializationZodI18n();

  const { data: shareCollaborators } = useQuery({
    queryKey: ['sheet_form_collaborator', shareId],
    queryFn: () =>
      getShareViewCollaborators(shareId!, {
        take: 100,
        skip: 0,
      }).then((res) => res.data),
    enabled: Boolean(shareId && isHydrated),
  });

  const { data: baseCollaboratorsData } = useQuery({
    queryKey: ['sheet_form_collaborator', baseId],
    queryFn: () =>
      getBaseCollaboratorList(baseId!, {
        take: 100,
        skip: 0,
        type: PrincipalType.User,
      }).then((res) => res.data),
    enabled: Boolean(!shareId && baseId && isHydrated),
  });

  const baseCollaborators = baseCollaboratorsData?.collaborators as UserCollaboratorItem[];

  const { mutateAsync: getShareLinkRecordsFn } = useMutation({
    mutationFn: ({ shareId, fieldId }: { shareId: string; fieldId: string }) =>
      getShareViewLinkRecords(shareId, {
        fieldId: fieldId,
        take: LinkDisplayCount,
        skip: 0,
        type: ShareViewLinkRecordsType.Candidate,
      }),
  });

  const { mutateAsync: getRecordsFn } = useMutation({
    mutationFn: ({ tableId }: { tableId: string }) =>
      getRecords(tableId, { take: LinkDisplayCount, skip: 0 }),
  });

  const proxyCellValue2RecordValue = useCallback((field: IFieldInstance, cellValue: unknown) => {
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
  }, []);

  const getRecordsMap = useCallback(() => {
    const fieldRangesMap = getRecordRangesMap(workBookData?.sheets?.[DefaultSheetId]?.cellData);
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
  }, [fields, proxyCellValue2RecordValue, workBookData?.sheets]);

  const getLinkRecordMap = useCallback(async () => {
    const linkRecordMap: Record<string, string[]> = {};
    const recordMap = getRecordsMap();
    const linkFields = Object.values(recordMap)
      .map((v) => v.fieldIns)
      .filter((f) => f.type === FieldType.Link);

    for (let i = 0; i < linkFields.length; i++) {
      const linkField = linkFields[i] as LinkField;
      let records: IRecordsVo['records'] | { id: string; title?: string }[] = [];
      if (shareId) {
        const result = await getShareLinkRecordsFn({ shareId, fieldId: linkField.id });
        records = result?.data;
      } else {
        const result = await getRecordsFn({ tableId: linkField?.options?.foreignTableId });
        records = result?.data?.records;
      }
      linkRecordMap[linkField.id] = uniq(
        records.map((r) => get(r, 'name') || get(r, 'title') || t('validation.unTitle'))
      );
    }

    return linkRecordMap;
  }, [getRecordsFn, getRecordsMap, getShareLinkRecordsFn, shareId, t]);

  const { data: linkRecordMap } = useQuery({
    queryKey: ['sheet_form_link_records'],
    queryFn: () => getLinkRecordMap().then((res) => res),
    enabled: Boolean(
      fields.some((f) => f.type === FieldType.Link) && isHydrated && univerRef?.current
    ),
  });

  const collaborator = useMemo(
    () => (shareId ? shareCollaborators : baseCollaborators),
    [shareCollaborators, baseCollaborators, shareId]
  );

  const setCellRules = useCallback(
    async (field: IFieldInstance, range?: [number, number, number, number]) => {
      const { type, isComputed, isMultipleCellValue, id } = field;

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
        case FieldType.User: {
          const cellOption = uniq(collaborator?.map((c) => c.userName)) || null;
          cellOption &&
            univerRef?.current?.setCellSelectRulesByRange(range, cellOption, isMultipleCellValue);
          break;
        }
        case FieldType.Link: {
          const records = linkRecordMap?.[id] || null;
          records &&
            univerRef?.current?.setCellSelectRulesByRange(range, records, isMultipleCellValue);
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
    },
    [collaborator, linkRecordMap]
  );

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
  }, [fields, getRecordsMap, setCellRules]);

  const newWorkBookData = useMemo(
    () =>
      ({
        ...workBookData,
        sheets: {
          [DefaultSheetId]: {
            ...workBookData?.sheets?.[DefaultSheetId],
            cellData: getPreviewSheetData(workBookData?.sheets?.[DefaultSheetId]?.cellData),
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
        if (
          !res?.success &&
          f.cellValue !== undefined &&
          ![FieldType.Link, FieldType.User].includes(f.fieldIns.type)
        ) {
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

      // only submit when share page
      if (shareId) {
        submitFormFn({ shareId, fields: submitField, typecast: true });
      } else {
        toast({ description: t('tooltips.onlyPreview') });
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
