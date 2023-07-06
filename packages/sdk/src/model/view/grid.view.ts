import { GridViewCore } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { ViewOperations } from './view';

export class GridView extends Mixin(GridViewCore, ViewOperations) {}
