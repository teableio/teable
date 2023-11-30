import { LastModifiedTimeFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class LastModifiedTimeField extends Mixin(LastModifiedTimeFieldCore, Field) {}
