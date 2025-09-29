import { ConditionalRollupFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class ConditionalRollupField extends Mixin(ConditionalRollupFieldCore, Field) {}
