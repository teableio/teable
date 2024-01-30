import { CreatedTimeFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class CreatedTimeField extends Mixin(CreatedTimeFieldCore, Field) {}
