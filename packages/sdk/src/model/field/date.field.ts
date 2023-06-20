import { DateFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class DateField extends Mixin(DateFieldCore, FieldOperations) {}
