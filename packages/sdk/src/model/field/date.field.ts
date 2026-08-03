import { DateFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class DateField extends Mixin(DateFieldCore, Field) {}
