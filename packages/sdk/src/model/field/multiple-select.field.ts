import { MultipleSelectFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';
import { SelectFieldSdk } from './mixin/select.field';

export class MultipleSelectField extends Mixin(SelectFieldSdk, MultipleSelectFieldCore, Field) {}
