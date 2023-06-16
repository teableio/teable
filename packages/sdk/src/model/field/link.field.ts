import { LinkFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class LinkField extends Mixin(LinkFieldCore, FieldOperations) {}
