import { ReferenceLookupFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class ReferenceLookupField extends Mixin(ReferenceLookupFieldCore, Field) {}
