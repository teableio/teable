import { CheckboxFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class CheckboxField extends Mixin(CheckboxFieldCore, FieldOperations) {}
