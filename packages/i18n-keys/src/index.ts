/**
 * User-facing error message keys in the frontend `sdk` locale namespace
 * (common-i18n `sdk.json`). A v2 error attaches one of these (plus its
 * interpolation context) as `localization` at the site where the error is
 * created; every layer up to HTTP passes it through untouched.
 */
export const sdkErrorI18nKeys = {
  custom: {
    recordFieldValueNotNull: 'httpErrors.custom.recordFieldValueNotNull',
    recordFieldValueDuplicate: 'httpErrors.custom.recordFieldValueDuplicate',
    recordDeleteBlockedByRequiredLink: 'httpErrors.custom.recordDeleteBlockedByRequiredLink',
    recordDeleteBlockedByRequiredLinkGeneric:
      'httpErrors.custom.recordDeleteBlockedByRequiredLinkGeneric',
    recordDeleteBlockedByLink: 'httpErrors.custom.recordDeleteBlockedByLink',
    linkBatchDuplicate: 'httpErrors.custom.linkBatchDuplicate',
    linkOneManyDuplicate: 'httpErrors.custom.linkOneManyDuplicate',
    linkOneOneDuplicate: 'httpErrors.custom.linkOneOneDuplicate',
    fieldMaxColumnLimit: 'httpErrors.custom.fieldMaxColumnLimit',
    fieldRequiredExistingValues: 'httpErrors.custom.fieldRequiredExistingValues',
    fieldUniqueExistingValues: 'httpErrors.custom.fieldUniqueExistingValues',
  },
  user: {
    notFound: 'httpErrors.user.notFound',
  },
  limit: {
    fieldOptionsMaxBytes: 'httpErrors.limit.fieldOptionsMaxBytes',
    selectChoicesMax: 'httpErrors.limit.selectChoicesMax',
    selectChoiceNameMaxLength: 'httpErrors.limit.selectChoiceNameMaxLength',
    selectDefaultValuesMax: 'httpErrors.limit.selectDefaultValuesMax',
    cellValueMaxBytes: 'httpErrors.limit.cellValueMaxBytes',
    recordFieldsMaxBytes: 'httpErrors.limit.recordFieldsMaxBytes',
    recordsPerMutationMax: 'httpErrors.limit.recordsPerMutationMax',
    computedCellValueMaxBytes: 'httpErrors.limit.computedCellValueMaxBytes',
    formulaMaxLength: 'httpErrors.limit.formulaMaxLength',
    tablesPerBaseMax: 'httpErrors.limit.tablesPerBaseMax',
    fieldsPerTableMax: 'httpErrors.limit.fieldsPerTableMax',
    rowsPerTableMax: 'httpErrors.limit.rowsPerTableMax',
    viewsPerTableMax: 'httpErrors.limit.viewsPerTableMax',
    createTableFieldsMax: 'httpErrors.limit.createTableFieldsMax',
    createTableViewsMax: 'httpErrors.limit.createTableViewsMax',
    createTableRecordsMax: 'httpErrors.limit.createTableRecordsMax',
    viewFilterItemsMax: 'httpErrors.limit.viewFilterItemsMax',
    viewFilterDepthMax: 'httpErrors.limit.viewFilterDepthMax',
    viewSortItemsMax: 'httpErrors.limit.viewSortItemsMax',
    viewGroupItemsMax: 'httpErrors.limit.viewGroupItemsMax',
    viewOptionsMaxBytes: 'httpErrors.limit.viewOptionsMaxBytes',
    nameMaxLength: 'httpErrors.limit.nameMaxLength',
    descriptionMaxLength: 'httpErrors.limit.descriptionMaxLength',
  },
} as const;

export type SdkErrorI18nKey =
  | 'httpErrors.custom.recordFieldValueNotNull'
  | 'httpErrors.user.notFound'
  | 'httpErrors.custom.recordFieldValueDuplicate'
  | 'httpErrors.custom.recordDeleteBlockedByRequiredLink'
  | 'httpErrors.custom.recordDeleteBlockedByRequiredLinkGeneric'
  | 'httpErrors.custom.recordDeleteBlockedByLink'
  | 'httpErrors.custom.linkBatchDuplicate'
  | 'httpErrors.custom.linkOneManyDuplicate'
  | 'httpErrors.custom.linkOneOneDuplicate'
  | 'httpErrors.custom.fieldMaxColumnLimit'
  | 'httpErrors.custom.fieldRequiredExistingValues'
  | 'httpErrors.custom.fieldUniqueExistingValues'
  | 'httpErrors.limit.fieldOptionsMaxBytes'
  | 'httpErrors.limit.selectChoicesMax'
  | 'httpErrors.limit.selectChoiceNameMaxLength'
  | 'httpErrors.limit.selectDefaultValuesMax'
  | 'httpErrors.limit.cellValueMaxBytes'
  | 'httpErrors.limit.recordFieldsMaxBytes'
  | 'httpErrors.limit.recordsPerMutationMax'
  | 'httpErrors.limit.computedCellValueMaxBytes'
  | 'httpErrors.limit.formulaMaxLength'
  | 'httpErrors.limit.tablesPerBaseMax'
  | 'httpErrors.limit.fieldsPerTableMax'
  | 'httpErrors.limit.rowsPerTableMax'
  | 'httpErrors.limit.viewsPerTableMax'
  | 'httpErrors.limit.createTableFieldsMax'
  | 'httpErrors.limit.createTableViewsMax'
  | 'httpErrors.limit.createTableRecordsMax'
  | 'httpErrors.limit.viewFilterItemsMax'
  | 'httpErrors.limit.viewFilterDepthMax'
  | 'httpErrors.limit.viewSortItemsMax'
  | 'httpErrors.limit.viewGroupItemsMax'
  | 'httpErrors.limit.viewOptionsMaxBytes'
  | 'httpErrors.limit.nameMaxLength'
  | 'httpErrors.limit.descriptionMaxLength';

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
