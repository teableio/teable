import { UserFieldCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class UserField extends Mixin(UserFieldCore, Field) {}
