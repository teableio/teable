import { SelectFieldCore } from '@teable/core';
import type { ISelectFieldDisplayChoice } from '../../../utils/select-color';
import { getDisplayChoiceMap } from '../../../utils/select-color';

export abstract class SelectFieldSdk extends SelectFieldCore {
  private _choiceMap: Record<string, ISelectFieldDisplayChoice> = {};
  private _choiceMapKey = '';

  get displayChoiceMap() {
    const choices = this.options?.choices ?? [];
    const choicesKey = JSON.stringify(choices.map(({ id, name, color }) => [id, name, color]));
    if (this._choiceMapKey !== choicesKey) {
      this._choiceMap = getDisplayChoiceMap(choices);
      this._choiceMapKey = choicesKey;
    }
    return this._choiceMap;
  }
}
