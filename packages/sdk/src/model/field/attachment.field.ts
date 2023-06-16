import { AttachmentFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { FieldOperations } from './field';

export class AttachmentField extends Mixin(AttachmentFieldCore, FieldOperations) {}
