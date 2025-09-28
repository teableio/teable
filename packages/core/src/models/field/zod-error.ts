import { isString } from 'lodash';
import { fromZodError } from 'zod-validation-error';
import { FieldAIActionType, getAiConfigSchema, type IFieldAIConfig } from './ai-config';
import { FieldType } from './constant';
import type {
  IFormulaFieldOptions,
  ILinkFieldOptions,
  IRollupFieldOptions,
  ISelectFieldOptions,
} from './derivate';
import {
  commonOptionsSchema,
  getOptionsSchema,
  type IFieldOptionsRo,
  type ILookupOptionsRo,
} from './field.schema';

interface IFieldValidateData {
  message: string;
  path?: string[];
  i18nKey: string;
  context?: Record<string, string>;
}

interface IValidateFieldOptionProps {
  type: FieldType;
  isLookup?: boolean;
  options?: IFieldOptionsRo;
  aiConfig?: IFieldAIConfig | null;
  lookupOptions?: ILookupOptionsRo;
}

const validateLookupOptions = (data: IValidateFieldOptionProps) => {
  const { isLookup, lookupOptions, type, options } = data;
  const res: IFieldValidateData[] = [];

  const isRollup = type === FieldType.Rollup;
  if (lookupOptions && !isLookup && !isRollup) {
    res.push({
      message:
        'lookupOptions is not allowed when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.lookup.lookupOptionsNotAllowed',
    });
  }

  const isLookupOrRollup = isLookup || isRollup;
  if (isLookupOrRollup && !lookupOptions) {
    res.push({
      message: 'lookupOptions is required when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.lookup.lookupOptionsRequired',
    });
    return res;
  }

  if (isLookupOrRollup && !isString(lookupOptions?.foreignTableId)) {
    res.push({
      path: ['lookupOptions'],
      message:
        'foreignTableId is required when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.link.foreignTableIdRequired',
    });
  }

  if (isLookupOrRollup && !isString(lookupOptions?.linkFieldId)) {
    res.push({
      path: ['lookupOptions'],
      message: 'linkFieldId is required when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.link.linkFieldIdRequired',
    });
  }

  if (isLookupOrRollup && !isString(lookupOptions?.lookupFieldId)) {
    res.push({
      path: ['lookupOptions'],
      message: 'lookupFieldId is required when isLookup attribute is true or field type is rollup.',
      i18nKey: 'sdk:editor.lookup.lookupFieldIdRequired',
    });
  }

  if (options) {
    const result = commonOptionsSchema.safeParse(options);
    if (!result.success) {
      res.push({
        path: ['options'],
        message: `RefineOptionsInLookupError: ${fromZodError(result.error).message}`,
        i18nKey: 'sdk:editor.lookup.refineOptionsError',
        context: {
          message: fromZodError(result.error).message,
        },
      });
    }
  }

  return res;
};

const validateOptions = (data: IValidateFieldOptionProps) => {
  const res: IFieldValidateData[] = [];
  const { type, options, isLookup } = data;

  if (!options || isLookup) {
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

  const isSelect = type === FieldType.SingleSelect || type === FieldType.MultipleSelect;
  if (
    isSelect &&
    (options as ISelectFieldOptions)?.choices.some(
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
  const result = schema && schema.safeParse(options);
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
  const { type, aiConfig } = data;
  const validateLookupOptionsRes = validateLookupOptions(data);
  const validateOptionsRes = validateOptions(data);
  const validateAIConfigRes = validateAIConfig({ aiConfig, type });
  return [...validateLookupOptionsRes, ...validateOptionsRes, ...validateAIConfigRes];
};
