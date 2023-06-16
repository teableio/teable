import { SingleLineTextFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class SingleLineTextField extends Mixin(SingleLineTextFieldCore, FieldOperations) {}
