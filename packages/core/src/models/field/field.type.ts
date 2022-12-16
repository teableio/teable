import type { INumberField } from './number.field';
import type { ISingleLineTextField } from './single-line-text.field';
import type { ISingleSelectField } from './single-select.field';

export type IField = ISingleLineTextField | INumberField | ISingleSelectField;
