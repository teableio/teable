import { MultipleSelectFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class MultipleSelectField extends Mixin(MultipleSelectFieldCore, FieldOperations) {}
