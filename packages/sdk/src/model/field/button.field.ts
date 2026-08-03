import { ButtonFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class ButtonField extends Mixin(ButtonFieldCore, Field) {}
