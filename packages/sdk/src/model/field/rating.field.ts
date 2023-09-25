import { RatingFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class RatingField extends Mixin(RatingFieldCore, Field) {}
