import { Injectable, Logger } from '@nestjs/common';
import { getValidFilterOperators, FieldType, ViewOpBuilder, FieldOpBuilder } from '@teable/core';
import type {
  IFilterSet,
  ISelectFieldOptionsRo,
  ISelectFieldOptions,
  IFilterItem,
  IFilter,
  IFilterValue,
  ILinkFieldOptions,
  IOtOperation,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { isEqual, differenceBy, find, isEmpty } from 'lodash';
import { ViewService } from '../../view/view.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';

/**
 * This service' purpose is to sync the relative data from field to view
 * such as filter, group, sort, columnMeta, etc.
 */
@Injectable()
export class FieldViewSyncService {
  private readonly logger = new Logger(FieldViewSyncService.name);

  constructor(
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService
  ) {}

  async deleteDependenciesByFieldIds(tableId: string, fieldIds: string[]) {
    await this.viewService.deleteViewRelativeByFields(tableId, fieldIds);
    await this.deleteLinkOptionsDependenciesByFieldIds(tableId, fieldIds);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async deleteLinkOptionsDependenciesByFieldIds(tableId: string, fieldIds: string[]) {
    const foreignFields = await this.getLinkForeignFields(tableId);
    const deletedFieldIdSet = new Set(fieldIds);

    for (const field of foreignFields) {
      const ops: IOtOperation[] = [];
      const { id: fieldId, tableId, options: rawOptions } = field;
      const options = rawOptions ? JSON.parse(rawOptions) : null;

      if (options == null) continue;

      const { filter, visibleFieldIds } = options as ILinkFieldOptions;
      const newOptions: ILinkFieldOptions = { ...options };
      let isOptionsChanged = false;

      if (visibleFieldIds?.length) {
        const newVisibleFieldIds = visibleFieldIds.filter((id) => !deletedFieldIdSet.has(id));
        if (!isEqual(newVisibleFieldIds, visibleFieldIds)) {
          newOptions.visibleFieldIds = newVisibleFieldIds?.length ? newVisibleFieldIds : null;
          isOptionsChanged = true;
        }
      }

      const filterString = JSON.stringify(filter);
      const filteredFieldIds = fieldIds.filter((id) => filterString?.includes(id));

      if (filter != null && filteredFieldIds.length) {
        let newFilter: IFilterSet | null = filter;
        filteredFieldIds.forEach((id) => {
          if (newFilter) {
            newFilter = this.viewService.getDeletedFilterByFieldId(newFilter, id);
          }
        });
        newOptions.filter = newFilter ? (newFilter?.filterSet?.length ? newFilter : null) : null;
        isOptionsChanged = true;
      }

      if (isOptionsChanged) {
        ops.push(
          FieldOpBuilder.editor.setFieldProperty.build({
            key: 'options',
            newValue: newOptions,
            oldValue: options,
          })
        );
      }

      if (ops.length) {
        await this.fieldService.batchUpdateFields(tableId, [{ fieldId, ops }]);
      }
    }
  }

  async deleteLinkOptionsDependenciesByViewId(tableId: string, viewId: string) {
    const foreignFields = await this.getLinkForeignFields(tableId);

    for (const field of foreignFields) {
      const { id: fieldId, tableId, options: rawOptions } = field;
      const options = rawOptions ? JSON.parse(rawOptions) : null;

      if (options == null) continue;

      const { filterByViewId } = options as ILinkFieldOptions;

      if (filterByViewId == null || filterByViewId !== viewId) continue;

      const ops = [
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'options',
          oldValue: options,
          newValue: { ...options, filterByViewId: null },
        }),
      ];
      await this.fieldService.batchUpdateFields(tableId, [{ fieldId, ops }]);
    }
  }

  async convertDependenciesByFieldIds(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    await this.convertViewDependenciesByFieldIds(tableId, newField, oldField);
    await this.convertLinkOptionsDependenciesByFieldIds(tableId, newField, oldField);
  }

  async convertLinkOptionsDependenciesByFieldIds(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    const convertedFieldId = newField.id;
    const foreignFields = await this.getLinkForeignFields(tableId);

    for (const field of foreignFields) {
      const { id: fieldId, tableId, options: rawOptions } = field;
      const options = rawOptions ? JSON.parse(rawOptions) : null;

      if (options == null) continue;

      const ops: IOtOperation[] = [];
      const { filter } = options as ILinkFieldOptions;

      if (filter == null || !JSON.stringify(filter).includes(convertedFieldId)) continue;

      const newFilter = this.getNewFilterByFieldChanges(filter, newField, oldField);
      ops.push(
        FieldOpBuilder.editor.setFieldProperty.build({
          key: 'options',
          oldValue: options,
          newValue: {
            ...options,
            filter: newFilter ? (newFilter?.filterSet?.length ? newFilter : null) : null,
          },
        })
      );

      await this.fieldService.batchUpdateFields(tableId, [{ fieldId, ops }]);
    }
  }

  async convertViewDependenciesByFieldIds(
    tableId: string,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    const views = await this.prismaService.txClient().view.findMany({
      select: {
        filter: true,
        id: true,
        type: true,
      },
      where: { tableId: tableId, deletedTime: null },
    });

    if (!views?.length) {
      return;
    }

    for (let i = 0; i < views.length; i++) {
      const filterString = views[i].filter;
      // empty filter or the field is not in filter, skip
      if (!filterString || !filterString?.includes(newField.id)) {
        continue;
      }
      const filter = JSON.parse(filterString) as NonNullable<IFilter>;

      const newFilter = this.getNewFilterByFieldChanges(filter, newField, oldField);

      const ops = ViewOpBuilder.editor.setViewProperty.build({
        key: 'filter',
        newValue: newFilter ? (newFilter?.filterSet?.length ? newFilter : null) : null,
        oldValue: filter,
      });

      await this.viewService.updateViewByOps(tableId, views[i].id, [ops]);
    }
  }

  async getLinkForeignFields(tableId: string) {
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: { tableId, type: FieldType.Link, deletedTime: null },
    });
    const foreignFieldIds = linkFields
      .map(
        ({ options }) =>
          ((options ? JSON.parse(options) : null) as ILinkFieldOptions)?.symmetricFieldId
      )
      .filter(Boolean) as string[];
    return await this.prismaService.txClient().field.findMany({
      where: { id: { in: foreignFieldIds }, type: FieldType.Link, deletedTime: null },
    });
  }

  getNewFilterByFieldChanges(
    originalFilter: IFilter,
    newField: IFieldInstance,
    oldField: IFieldInstance
  ) {
    if (!originalFilter) {
      return null as IFilter;
    }

    const fieldId = newField.id;
    const filter = { ...originalFilter };
    const oldOperators = getValidFilterOperators(oldField);
    const newOperators = getValidFilterOperators(newField);
    /**
     * there just two cases processed now
     * 1. select field type
     *    a.delete old options, delete filter item value is array, delete the item in array
     *    b.value is string, delete the item
     * 2. operators or cellValueType or isMultipleCellValue has been changed, delete the filter item
     * TODO there are more detail cases need to be processed to improve the experience of user
     */
    if (
      newField.type === oldField.type &&
      [FieldType.SingleSelect, FieldType.MultipleSelect].includes(newField.type) &&
      !isEqual(
        (oldField.options as ISelectFieldOptions).choices,
        (newField.options as ISelectFieldOptionsRo).choices
      )
    ) {
      const fieldId = newField.id;
      const oldOptions = (oldField.options as ISelectFieldOptions).choices;
      const newOptions = (newField.options as ISelectFieldOptionsRo).choices;

      const updateNameOptions = newOptions
        .filter((choice) => {
          if (!choice.id) return false;
          const originalChoice = find(oldOptions, ['id', choice.id]);
          return originalChoice && originalChoice.name !== choice.name;
        })
        .map((item) => {
          const { id, name } = item;
          return {
            id,
            oldName: oldOptions.find((option) => option?.id === id)?.name as string,
            newName: name,
          };
        });
      const deleteOptions = differenceBy(oldOptions, newOptions, 'id');
      if (!deleteOptions?.length && !updateNameOptions?.length) {
        return;
      }

      return this.getFilterBySelectTypeChanges(filter, fieldId, updateNameOptions, deleteOptions);
    }

    // judge the operator is same groups or cellValueType is same, otherwise delete the filter item
    if (
      (newField.type !== oldField.type && !isEqual(oldOperators, newOperators)) ||
      oldField.cellValueType !== newField.cellValueType ||
      oldField?.isMultipleCellValue !== newField?.isMultipleCellValue
    ) {
      return this.viewService.getDeletedFilterByFieldId(filter, fieldId);
    }

    // do nothing
    return filter;
  }

  getFilterBySelectTypeChanges(
    originData: IFilterSet,
    fieldId: string,
    updateNameOptions: { id?: string; oldName: string; newName: string }[],
    deleteOptions: ISelectFieldOptions['choices']
  ) {
    const data = { ...originData };
    const updateMap = new Map(updateNameOptions.map((opt) => [opt.oldName, opt.newName]));
    const deleteSet = new Set(deleteOptions.map((opt) => opt.name));

    const transformValue = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        const newValue = value.filter((v) => !deleteSet.has(v)).map((v) => updateMap.get(v) || v);
        return newValue.length > 0 ? newValue : null;
      } else if (typeof value === 'string') {
        if (deleteSet.has(value)) return null;
        return updateMap.get(value) || value;
      }
      return value;
    };

    const transformFilter = (filter: IFilterSet | IFilterItem): IFilterSet | IFilterItem => {
      if ('filterSet' in filter) {
        const newFilterSet = filter.filterSet.map(transformFilter);
        return {
          conjunction: filter.conjunction,
          filterSet: newFilterSet.filter((item) => !isEmpty(item)),
        };
      } else {
        // target item
        if (filter.fieldId === fieldId && filter.value !== null) {
          const newValue = transformValue(filter.value) as IFilterValue;
          return (newValue ? { ...filter, value: newValue } : {}) as IFilterItem;
        }
        return {
          ...filter,
        };
      }
    };

    return transformFilter(data) as IFilterSet;
  }
}
