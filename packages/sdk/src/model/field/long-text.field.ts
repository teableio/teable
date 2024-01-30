import { LongTextFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class LongTextField extends Mixin(LongTextFieldCore, Field) {}
