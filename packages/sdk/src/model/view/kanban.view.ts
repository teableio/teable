import { KanbanViewCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { View } from './view';

export class KanbanView extends Mixin(KanbanViewCore, View) {}
