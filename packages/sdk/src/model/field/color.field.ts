import { ColorFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class ColorField extends Mixin(ColorFieldCore, Field) {}
