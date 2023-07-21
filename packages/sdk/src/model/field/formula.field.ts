import { FormulaFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class FormulaField extends Mixin(FormulaFieldCore, Field) {}
