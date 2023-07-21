import { SingleLineTextFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class SingleLineTextField extends Mixin(SingleLineTextFieldCore, Field) {}
