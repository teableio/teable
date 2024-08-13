import { LastModifiedByFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class LastModifiedByField extends Mixin(LastModifiedByFieldCore, Field) {}
