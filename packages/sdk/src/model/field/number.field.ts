import { NumberFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class NumberField extends Mixin(NumberFieldCore, FieldOperations) {}
