import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ILinkFieldOptionsRo } from '@teable/core';
import { Relationship } from '@teable/core';
import { ArrowUpRight, ChevronDown } from '@teable/icons';
import { getFields, getTablePermission } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useTableId } from '@teable/sdk/hooks';
import { Button, Label, Switch } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { Trans, useTranslation } from 'next-i18next';
import { useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { MoreLinkOptions } from './MoreLinkOptions';
import { SelectTable } from './SelectTable';

export const LinkOptions = (props: {
  options: Partial<ILinkFieldOptionsRo> | undefined;
  fieldId?: string;
  isLookup?: boolean;
  onChange?: (options: Partial<ILinkFieldOptionsRo>) => void;
}) => {
  const { fieldId, options, isLookup, onChange } = props;
  const tableId = useTableId();
  const selfBaseId = useBaseId() as string;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const isMoreVisible = Boolean(
    options?.filterByViewId || options?.filter || options?.visibleFieldIds
  );

  const [moreVisible, setMoreVisible] = useState(isMoreVisible);

  const relationship = options?.relationship ?? Relationship.ManyOne;
  const foreignTableId = options?.foreignTableId;
  const isOneWay = options?.isOneWay;
  const baseId = options?.baseId ?? selfBaseId;

  const { data: tablePermission } = useQuery({
    refetchOnWindowFocus: false,
    queryKey: ReactQueryKeys.getTablePermission(baseId, foreignTableId!),
    enabled: !!foreignTableId,
    queryFn: ({ queryKey }) =>
      getTablePermission(queryKey[1], queryKey[2])
        .then((res) => res.data)
        .catch(() => undefined),
  });

  const canCreateField = tablePermission?.field?.['field|create'];

  const translation = {
    [Relationship.OneOne]: t('table:field.editor.oneToOne'),
    [Relationship.OneMany]: t('table:field.editor.oneToMany'),
    [Relationship.ManyOne]: t('table:field.editor.manyToOne'),
    [Relationship.ManyMany]: t('table:field.editor.manyToMany'),
  };

  const onSelect = (key: keyof ILinkFieldOptionsRo, value: unknown) => {
    onChange?.({ foreignTableId, relationship, isOneWay, [key]: value });
  };

  const onRelationshipChange = (leftMulti: boolean, rightMulti: boolean) => {
    if (leftMulti && rightMulti) {
      onSelect('relationship', Relationship.ManyMany);
    }
    if (leftMulti && !rightMulti) {
      onSelect('relationship', Relationship.OneMany);
    }
    if (!leftMulti && rightMulti) {
      onSelect('relationship', Relationship.ManyOne);
    }
    if (!leftMulti && !rightMulti) {
      onSelect('relationship', Relationship.OneOne);
    }
  };

  const isLeftMulti = (relationship: Relationship) => {
    return relationship === Relationship.ManyMany || relationship === Relationship.OneMany;
  };
  const isRightMulti = (relationship: Relationship) => {
    return relationship === Relationship.ManyMany || relationship === Relationship.ManyOne;
  };

  const queryClient = useQueryClient();

  const { mutate: getFieldListMutate } = useMutation({
    mutationFn: (foreignTableId: string) => {
      return getFields(foreignTableId).then((res) => res.data);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(ReactQueryKeys.fieldList(foreignTableId!), data);
      const primaryField = data.find((field) => field.isPrimary);
      onChange?.({
        ...options,
        lookupFieldId: primaryField?.id,
      });
    },
  });

  if (isLookup) {
    return <></>;
  }

  return (
    <div className="flex w-full flex-col gap-4 border-t pt-4">
      <SelectTable
        baseId={options?.baseId}
        tableId={options?.foreignTableId}
        onChange={async (baseId, tableId) => {
          onChange?.({
            baseId,
            foreignTableId: tableId,
            relationship,
            isOneWay,
            filterByViewId: null,
            visibleFieldIds: null,
            filter: null,
          });
          if (tableId) {
            await getFieldListMutate(tableId);
          }
        }}
      />
      {options?.foreignTableId && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-start">
            <Button
              size="xs"
              variant="outline"
              className=""
              onClick={() => setMoreVisible(!moreVisible)}
            >
              {t('table:field.editor.moreOptions')}
              <ChevronDown className="size-3 " />
            </Button>
          </div>
          {moreVisible && (
            <MoreLinkOptions
              foreignTableId={options?.foreignTableId}
              fieldId={fieldId}
              filterByViewId={options?.filterByViewId}
              visibleFieldIds={options?.visibleFieldIds}
              filter={options?.filter}
              lookupFieldId={options?.lookupFieldId}
              onChange={(partialOptions: Partial<ILinkFieldOptionsRo>) => {
                onChange?.({ ...options, ...partialOptions });
              }}
            />
          )}
        </div>
      )}
      {foreignTableId && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <div className="flex h-8 items-center space-x-2">
            <Switch
              id="field-options-one-way-link"
              checked={!isOneWay}
              onCheckedChange={(checked) => {
                onSelect('isOneWay', !checked);
              }}
              disabled={!canCreateField}
            />
            <Label htmlFor="field-options-one-way-link" className="font-normal leading-tight">
              {t('table:field.editor.createSymmetricLink')}
            </Label>
          </div>
          <div className="flex h-8 items-center space-x-2">
            <Switch
              id="field-options-self-multi"
              checked={isLeftMulti(relationship)}
              onCheckedChange={(checked) => {
                onRelationshipChange(checked, isRightMulti(relationship));
              }}
            />
            <Label htmlFor="field-options-self-multi" className="font-normal leading-tight">
              {t('table:field.editor.allowLinkMultipleRecords')}
            </Label>
          </div>
          <div className="flex h-8 items-center space-x-2">
            <Switch
              id="field-options-sym-multi"
              checked={isRightMulti(relationship)}
              onCheckedChange={(checked) => {
                onRelationshipChange(isLeftMulti(relationship), checked);
              }}
            />
            <Label htmlFor="field-options-sym-multi" className="font-normal leading-tight">
              {isOneWay
                ? t('table:field.editor.allowLinkToDuplicateRecords')
                : t('table:field.editor.allowSymmetricFieldLinkMultipleRecords')}
            </Label>
          </div>
          <div className="border-1 flex flex-col items-end gap-2 rounded-md border bg-muted p-3 text-sm">
            <div className="flex w-full items-center justify-between">
              <p className="text-sm font-semibold">{t('table:field.editor.tips')}</p>
              <Link
                className="flex items-center text-xs hover:underline"
                href={t('table:field.editor.linkFieldKnowMoreLink')}
                target="_blank"
              >
                {t('table:field.editor.knowMore')}
                <ArrowUpRight className="size-4" />
              </Link>
            </div>

            <p className="w-full text-[13px]">
              <Trans
                ns="table"
                i18nKey="field.editor.linkTipMessage"
                components={{ b: <b />, span: <span />, br: <br /> }}
                values={{
                  relationship: translation[relationship],
                  linkType:
                    tableId === foreignTableId
                      ? t('table:field.editor.inSelfLink')
                      : t('table:field.editor.betweenTwoTables'),
                }}
              />
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
