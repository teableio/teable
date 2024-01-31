import { SingleSelectFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class SingleSelectField extends Mixin(SingleSelectFieldCore, Field) {}
