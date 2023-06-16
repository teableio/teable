import { SingleSelectFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class SingleSelectField extends Mixin(SingleSelectFieldCore, FieldOperations) {}
