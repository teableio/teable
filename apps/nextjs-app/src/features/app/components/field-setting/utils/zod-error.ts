import type { ZodError } from 'zod';

export const formatAiConfigError = (error: ZodError): string => {
  const errorString = JSON.stringify(error.errors);

  if (errorString.includes('"sourceFieldId"')) {
    return 'Source field is required';
  }
  if (errorString.includes('"targetLanguage"')) {
    return 'Target language is required';
  }
  if (errorString.includes('"prompt"')) {
    return 'Prompt is required';
  }
  if (errorString.includes('"modelKey"')) {
    return 'Model key is required';
  }
  return 'AI configuration error';
};
