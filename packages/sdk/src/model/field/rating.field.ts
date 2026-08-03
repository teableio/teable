import { RatingFieldCore } from '@teable/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class RatingField extends Mixin(RatingFieldCore, Field) {}
