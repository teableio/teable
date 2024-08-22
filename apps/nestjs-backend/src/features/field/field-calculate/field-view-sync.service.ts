import { Injectable, Logger } from '@nestjs/common';
import { getValidFilterOperators, FieldType, ViewOpBuilder } from '@teable/core';
import type {
  IFilterSet,
  ISelectFieldOptionsRo,
  ISelectFieldOptions,
  IFilterItem,
  IFilter,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { isEqual, differenceBy, find } from 'lodash';
import { ViewService } from '../../view/view.service';
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
    private readonly prismaService: PrismaService
  ) {}

  async deleteViewRelativeByFields(tableId: string, fieldIds: string[]) {
    await this.viewService.deleteViewRelativeByFields(tableId, fieldIds);
  }

  async convertFieldRelative(tableId: string, newField: IFieldInstance, oldField: IFieldInstance) {
    const views = await this.prismaService.view.findMany({
      select: {
        filter: true,
        id: true,
        type: true,
      },
      where: { tableId: tableId },
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
        return {
          conjunction: filter.conjunction,
          filterSet: filter.filterSet.map(transformFilter),
        };
      } else {
        // target item
        if (filter.fieldId === fieldId) {
          const newValue = transformValue(filter.value);
          return {
            ...filter,
            value: filter.value !== null ? newValue : null,
            shouldDelete: newValue === null,
          } as IFilterItem & {
            shouldDelete: boolean;
          };
        }
        return {
          ...filter,
        };
      }
    };

    const deleteConvertEmptyFilterItem = (
      filter: IFilterSet | IFilterItem
    ): IFilterSet | IFilterItem => {
      if ('filterSet' in filter) {
        return {
          conjunction: filter.conjunction,
          filterSet: filter.filterSet
            .filter((item) => {
              if (!Array.isArray(item)) {
                return !(
                  item as IFilterItem & {
                    shouldDelete: boolean;
                  }
                ).shouldDelete;
              }
              return true;
            })
            .filter(transformFilter),
        };
      } else {
        return {
          ...filter,
        };
      }
    };

    return deleteConvertEmptyFilterItem(transformFilter(data)) as IFilterSet;
  }
}
