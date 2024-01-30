import { NumberFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class NumberField extends Mixin(NumberFieldCore, Field) {}
