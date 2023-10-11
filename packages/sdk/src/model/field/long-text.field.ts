import { LongTextFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class LongTextField extends Mixin(LongTextFieldCore, Field) {}
