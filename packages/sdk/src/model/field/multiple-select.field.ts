import { MultipleSelectFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class MultipleSelectField extends Mixin(MultipleSelectFieldCore, Field) {}
