import { FormulaFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class FormulaField extends Mixin(FormulaFieldCore, FieldOperations) {}
