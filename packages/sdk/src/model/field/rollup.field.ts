import { RollupFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class RollupField extends Mixin(RollupFieldCore, FieldOperations) {}
