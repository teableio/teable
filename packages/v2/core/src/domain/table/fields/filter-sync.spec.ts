import { describe, expect, it } from 'vitest';

import { DbFieldName } from './DbFieldName';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import {
  buildFieldFilterSyncPlan,
  hasFieldFilterSyncPlanChanges,
  hasFieldReferenceInFilter,
  hasSelectOptionValueChanges,
  syncFilterByFieldChanges,
} from './filter-sync';
import { SelectOption } from './types/SelectOption';
import { SingleLineTextField } from './types/SingleLineTextField';
import { SingleSelectField } from './types/SingleSelectField';
import { UpdateSingleSelectOptionsSpec } from '../specs/field-updates/UpdateSingleSelectOptionsSpec';
import { TableUpdateFieldTypeSpec } from '../specs/TableUpdateFieldTypeSpec';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

describe('filter-sync', () => {
  it('builds sync plan from select option update and type conversion specs', () => {
    const statusFieldId = createFieldId('a');
    const statusName = FieldName.create('Status')._unsafeUnwrap();
    const oldActive = SelectOption.create({
      id: 'cho_active',
      name: 'Active',
      color: 'green',
    })._unsafeUnwrap();
    const oldClosed = SelectOption.create({
      id: 'cho_closed',
      name: 'Closed',
      color: 'red',
    })._unsafeUnwrap();
    const renamedActive = SelectOption.create({
      id: 'cho_active',
      name: 'Active Plus',
      color: 'green',
    })._unsafeUnwrap();

    const oldField = SingleSelectField.create({
      id: statusFieldId,
      name: statusName,
      options: [oldActive, oldClosed],
    })._unsafeUnwrap();
    const convertedField = SingleLineTextField.create({
      id: statusFieldId,
      name: statusName,
    })._unsafeUnwrap();

    const updateOptionsSpec = UpdateSingleSelectOptionsSpec.create(
      statusFieldId,
      DbFieldName.rehydrate('status')._unsafeUnwrap(),
      [oldActive, oldClosed],
      [renamedActive]
    );
    const conversionSpec = TableUpdateFieldTypeSpec.create(oldField, convertedField);

    const plan = buildFieldFilterSyncPlan(oldField, [updateOptionsSpec, conversionSpec]);
    expect(plan.removeReferencedFilterItems).toBe(true);
    expect(plan.renamedSelectOptionValues.get('Active')).toBe('Active Plus');
    expect(plan.removedSelectOptionValues.has('Closed')).toBe(true);
    expect(hasFieldFilterSyncPlanChanges(plan)).toBe(true);
    expect(hasSelectOptionValueChanges(plan)).toBe(true);
  });

  it('syncs filter item values for renamed and removed select options', () => {
    const statusFieldId = createFieldId('b');
    const otherFieldId = createFieldId('c');

    const next = syncFilterByFieldChanges(
      {
        conjunction: 'and',
        filterSet: [
          { fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' },
          {
            fieldId: statusFieldId.toString(),
            operator: 'isAnyOf',
            value: ['Pending', 'Active'],
          },
          { fieldId: otherFieldId.toString(), operator: 'is', value: 'Keep' },
        ],
      },
      statusFieldId,
      {
        removeReferencedFilterItems: false,
        renamedSelectOptionValues: new Map([['Active', 'Active Plus']]),
        removedSelectOptionValues: new Set(['Pending']),
      }
    ) as {
      filterSet: Array<{ fieldId: string; value?: unknown }>;
    };

    expect(next.filterSet[0]?.value).toBe('Active Plus');
    expect(next.filterSet[1]?.value).toEqual(['Active Plus']);
    expect(next.filterSet[2]?.value).toBe('Keep');
    expect(hasFieldReferenceInFilter(next, statusFieldId)).toBe(true);
  });

  it('removes referenced filter items when dependency is type converted', () => {
    const statusFieldId = createFieldId('d');
    const titleFieldId = createFieldId('e');
    const filter = {
      conjunction: 'and',
      filterSet: [
        { fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' },
        { fieldId: titleFieldId.toString(), operator: 'isNotEmpty' },
      ],
    };

    const next = syncFilterByFieldChanges(filter, statusFieldId, {
      removeReferencedFilterItems: true,
      renamedSelectOptionValues: new Map(),
      removedSelectOptionValues: new Set(),
    }) as { filterSet: Array<{ fieldId: string }> };

    expect(next.filterSet).toHaveLength(1);
    expect(next.filterSet[0]?.fieldId).toBe(titleFieldId.toString());

    const allRemoved = syncFilterByFieldChanges(
      {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
      },
      statusFieldId,
      {
        removeReferencedFilterItems: true,
        renamedSelectOptionValues: new Map(),
        removedSelectOptionValues: new Set(),
      }
    );
    expect(allRemoved).toBeNull();
  });
});
