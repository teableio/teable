import { KanbanViewCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { ViewOperations } from './view';

export class KanbanView extends Mixin(KanbanViewCore, ViewOperations) {}
