import { SingleSelectFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class SingleSelectField extends Mixin(SingleSelectFieldCore, Field) {}
