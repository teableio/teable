import { CreatedByFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class CreatedByField extends Mixin(CreatedByFieldCore, Field) {}
