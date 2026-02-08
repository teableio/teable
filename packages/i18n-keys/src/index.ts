export const tableI18nKeys = {
  field: {
    default: {
      singleLineText: {
        title: 'field.default.singleLineText.title',
      },
      longText: {
        title: 'field.default.longText.title',
      },
      number: {
        title: 'field.default.number.title',
      },
      rating: {
        title: 'field.default.rating.title',
      },
      singleSelect: {
        title: 'field.default.singleSelect.title',
      },
      multipleSelect: {
        title: 'field.default.multipleSelect.title',
      },
      checkbox: {
        title: 'field.default.checkbox.title',
      },
      attachment: {
        title: 'field.default.attachment.title',
      },
      user: {
        title: 'field.default.user.title',
      },
      date: {
        title: 'field.default.date.title',
      },
      createdTime: {
        title: 'field.default.createdTime.title',
      },
      lastModifiedTime: {
        title: 'field.default.lastModifiedTime.title',
      },
      createdBy: {
        title: 'field.default.createdBy.title',
      },
      lastModifiedBy: {
        title: 'field.default.lastModifiedBy.title',
      },
      autoNumber: {
        title: 'field.default.autoNumber.title',
      },
      button: {
        title: 'field.default.button.title',
      },
      formula: {
        title: 'field.default.formula.title',
      },
      lookup: {
        title: 'field.default.lookup.title',
      },
      conditionalLookup: {
        title: 'field.default.conditionalLookup.title',
      },
      rollup: {
        title: 'field.default.rollup.title',
        rollup: 'field.default.rollup.rollup',
      },
      conditionalRollup: {
        title: 'field.default.conditionalRollup.title',
      },
    },
  },
} as const;

export type TableI18nKey =
  | 'field.default.singleLineText.title'
  | 'field.default.longText.title'
  | 'field.default.number.title'
  | 'field.default.rating.title'
  | 'field.default.singleSelect.title'
  | 'field.default.multipleSelect.title'
  | 'field.default.checkbox.title'
  | 'field.default.attachment.title'
  | 'field.default.user.title'
  | 'field.default.date.title'
  | 'field.default.createdTime.title'
  | 'field.default.lastModifiedTime.title'
  | 'field.default.createdBy.title'
  | 'field.default.lastModifiedBy.title'
  | 'field.default.autoNumber.title'
  | 'field.default.button.title'
  | 'field.default.formula.title'
  | 'field.default.lookup.title'
  | 'field.default.conditionalLookup.title'
  | 'field.default.rollup.title'
  | 'field.default.rollup.rollup'
  | 'field.default.conditionalRollup.title';
