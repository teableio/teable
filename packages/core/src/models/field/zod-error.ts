/* eslint-disable sonarjs/no-duplicate-string */
import { isString } from 'lodash';
import { fromZodError } from 'zod-validation-error';
import { extractFieldIdsFromFilter } from '../view/filter/filter';
import { FieldAIActionType, getAiConfigSchema, type IFieldAIConfig } from './ai-config';
import { FieldType } from './constant';
import type {
  IConditionalRollupFieldOptions,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  IRollupFieldOptions,
  ISelectFieldOptions,
} from './derivate';
import type { IFieldMetaVo, IFieldOptionsRo } from './field-unions.schema';
import { getOptionsSchema } from './field.schema';
import { isLinkLookupOptions, type ILookupOptionsRo } from './lookup-options-base.schema';

interface IFieldValidateData {
  message: string;
  path?: string[];
  i18nKey: string;
  context?: Record<string, string>;
}

interface IValidateFieldOptionProps {
  type: FieldType;
  isLookup?: boolean;
  isConditionalLookup?: boolean;
  options?: IFieldOptionsRo;
  aiConfig?: IFieldAIConfig | null;
  lookupOptions?: ILookupOptionsRo;
  meta?: IFieldMetaVo;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
const validateLookupOptions = (data: IValidateFieldOptionProps) => {
  const { isLookup, isConditionalLookup, lookupOptions, type, options } = data;
  const res: IFieldValidateData[] = [];

  const isRollup = type === FieldType.Rollup;
  const needsStandardLookupOptions = (isLookup && !isConditionalLookup) || isRollup;
  const needsConditionalLookupOptions = Boolean(isConditionalLookup);
  const allowsLookupOptions = needsStandardLookupOptions || needsConditionalLookupOptions;

  if (lookupOptions && !allowsLookupOptions) {
    res.push({
      message:
        'lookupOptions is not allowed when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.lookup.lookupOptionsNotAllowed',
    });
  }

  if (needsStandardLookupOptions && !lookupOptions) {
    res.push({
      message: 'lookupOptions is required when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.lookup.lookupOptionsRequired',
    });
  }

  if (needsConditionalLookupOptions && !lookupOptions) {
    res.push({
      message: 'lookupOptions is required when lookup is marked as conditional.',
      i18nKey: 'sdk:editor.lookup.lookupOptionsRequired',
    });
  }

  if (!lookupOptions) {
    return res;
  }

  if (needsStandardLookupOptions) {
    if (!isLinkLookupOptions(lookupOptions)) {
      res.push({
        path: ['lookupOptions'],
        message: 'linkFieldId is required when isLookup attribute is true or field type is rollup.',
        i18nKey: 'sdk:editor.link.linkFieldIdRequired',
      });
    } else {
      if (!isString(lookupOptions.foreignTableId)) {
        res.push({
          path: ['lookupOptions'],
          message:
            'foreignTableId is required when isLookup attribute is true or field type is rollup.',
          i18nKey: 'sdk:editor.link.foreignTableIdRequired',
        });
      }

      if (!isString(lookupOptions.linkFieldId)) {
        res.push({
          path: ['lookupOptions'],
          message:
            'linkFieldId is required when isLookup attribute is true or field type is rollup.',
          i18nKey: 'sdk:editor.link.linkFieldIdRequired',
        });
      }

      if (!isString(lookupOptions.lookupFieldId)) {
        res.push({
          path: ['lookupOptions'],
          message:
            'lookupFieldId is required when isLookup attribute is true or field type is rollup.',
          i18nKey: 'sdk:editor.lookup.lookupFieldIdRequired',
        });
      }
    }
  }

  if (needsConditionalLookupOptions) {
    if (isLinkLookupOptions(lookupOptions)) {
      res.push({
        path: ['lookupOptions'],
        message: 'linkFieldId is not allowed when lookup is marked as conditional.',
        i18nKey: 'sdk:editor.lookup.lookupOptionsNotAllowed',
      });
    } else {
      if (!isString(lookupOptions.foreignTableId)) {
        res.push({
          path: ['lookupOptions'],
          message: 'foreignTableId is required when lookup is marked as conditional.',
          i18nKey: 'sdk:editor.link.foreignTableIdRequired',
        });
      }

      if (!isString(lookupOptions.lookupFieldId)) {
        res.push({
          path: ['lookupOptions'],
          message: 'lookupFieldId is required when lookup is marked as conditional.',
          i18nKey: 'sdk:editor.lookup.lookupFieldIdRequired',
        });
      }

      const filterFieldIds = extractFieldIdsFromFilter(lookupOptions.filter);
      if (!lookupOptions.filter || filterFieldIds.length === 0) {
        res.push({
          path: ['lookupOptions', 'filter'],
          message: 'filter is required when lookup is marked as conditional.',
          i18nKey: 'sdk:editor.conditionalLookup.filterRequired',
        });
      }
    }
  }

  return res;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
const validateOptions = (data: IValidateFieldOptionProps) => {
  const { type, options, isLookup } = data;
  const res: IFieldValidateData[] = [];

  if (isLookup) {
    return res;
  }

  if (type === FieldType.Link && !isString((options as ILinkFieldOptions)?.foreignTableId)) {
    res.push({
      path: ['options'],
      message: 'foreignTableId is required when type is link',
      i18nKey: 'sdk:editor.link.foreignTableIdRequired',
    });
  }

  if (type === FieldType.Rollup && !isString((options as IRollupFieldOptions)?.expression)) {
    res.push({
      path: ['options'],
      message: 'expression is required when type is rollup',
      i18nKey: 'sdk:editor.rollup.expressionRequired',
    });
  }

  if (type === FieldType.Formula && !isString((options as IFormulaFieldOptions)?.expression)) {
    res.push({
      path: ['options'],
      message: 'expression is required when type is formula',
      i18nKey: 'sdk:editor.formula.expressionRequired',
    });
  }

  if (type === FieldType.ConditionalRollup) {
    const filter = (options as IConditionalRollupFieldOptions)?.filter;
    const hasFilterConditions = !!filter && extractFieldIdsFromFilter(filter).length > 0;

    if (!hasFilterConditions) {
      res.push({
        path: ['options'],
        message: 'filter is required when type is conditionalRollup',
        i18nKey: 'sdk:editor.conditionalRollup.filterRequired',
      });
    }
  }

  const isSelect = type === FieldType.SingleSelect || type === FieldType.MultipleSelect;
  if (
    isSelect &&
    (options as ISelectFieldOptions)?.choices?.some(
      (choice) => !isString(choice.name) || choice.name.trim() === ''
    )
  ) {
    res.push({
      path: ['options'],
      message: 'choice name is not empty when type is singleSelect or multipleSelect',
      i18nKey: 'sdk:editor.select.choicesNameRequired',
    });
  }

  const schema = getOptionsSchema(type);
  const shouldValidateSchema = schema && options !== undefined;
  const result = shouldValidateSchema ? schema.safeParse(options) : undefined;
  if (result && !result.success) {
    res.push({
      path: ['options'],
      message: `RefineOptionsError: ${fromZodError(result.error).message}`,
      i18nKey: 'sdk:editor.error.refineOptionsError',
      context: {
        message: fromZodError(result.error).message,
      },
    });
  }

  return res;
};

const validateAIConfig = (data: IValidateFieldOptionProps) => {
  const { aiConfig, type } = data;
  const res: IFieldValidateData[] = [];
  if (!aiConfig) {
    return res;
  }
  const hasModelKey = isString(aiConfig.modelKey);
  if (!hasModelKey) {
    res.push({
      path: ['aiConfig'],
      message: 'modelKey is required when aiConfig is not null',
      i18nKey: 'sdk:editor.aiConfig.modelKeyRequired',
    });
  }

  const { type: aiConfigType } = aiConfig;
  switch (aiConfigType) {
    case FieldAIActionType.Extraction:
    case FieldAIActionType.Summary:
    case FieldAIActionType.Improvement:
    case FieldAIActionType.Classification:
    case FieldAIActionType.Tag:
    case FieldAIActionType.ImageGeneration:
    case FieldAIActionType.Rating: {
      if (!isString(aiConfig.sourceFieldId)) {
        res.push({
          path: ['aiConfig'],
          message: `sourceFieldId is required when aiConfig type is ${aiConfigType}`,
          i18nKey: 'sdk:editor.aiConfig.sourceFieldIdRequired',
        });
      }
      break;
    }
    case FieldAIActionType.Translation:
      if (!isString(aiConfig.sourceFieldId)) {
        res.push({
          path: ['aiConfig'],
          message: `sourceFieldId is required when aiConfig type is ${aiConfigType}`,
          i18nKey: 'sdk:editor.aiConfig.sourceFieldIdRequired',
        });
      }
      if (!isString(aiConfig.targetLanguage)) {
        res.push({
          path: ['aiConfig'],
          message: `targetLanguage is required when aiConfig type is ${aiConfigType}`,
          i18nKey: 'sdk:editor.aiConfig.targetLanguageRequired',
        });
      }
      break;
    case FieldAIActionType.Customization: {
      if (!isString(aiConfig.prompt)) {
        res.push({
          path: ['aiConfig'],
          message: `prompt is required when aiConfig type is ${aiConfigType}`,
          i18nKey: 'sdk:editor.aiConfig.promptRequired',
        });
      }
      break;
    }
    default:
      res.push({
        path: ['aiConfig'],
        message: `aiConfig type: ${aiConfigType} is not supported`,
        i18nKey: 'sdk:editor.aiConfig.typeNotSupported',
        context: {
          type: aiConfigType,
        },
      });
      break;
  }

  const aiConfigSchema = getAiConfigSchema(type);
  const result = aiConfigSchema.safeParse(aiConfig);
  if (!result.success) {
    res.push({
      path: ['aiConfig'],
      message: `RefineAICofigError: ${fromZodError(result.error).message}`,
      i18nKey: 'sdk:editor.error.refineAICofigError',
      context: {
        message: fromZodError(result.error).message,
      },
    });
  }

  return res;
};

export const validateFieldOptions = (data: IValidateFieldOptionProps): IFieldValidateData[] => {
  const validateLookupOptionsRes = validateLookupOptions(data);
  const validateOptionsRes = validateOptions(data);
  const validateAIConfigRes = validateAIConfig(data);
  return [...validateLookupOptionsRes, ...validateOptionsRes, ...validateAIConfigRes];
};
