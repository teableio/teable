import { ColorUtils, SingleSelectFieldCore } from '@teable/core';
import { keyBy } from 'lodash';
import colors from 'tailwindcss/colors';
import { Mixin } from 'ts-mixer';
import { Field } from './field';
import type { ISelectFieldDisplayChoice } from './multiple-select.field';

export class SingleSelectField extends Mixin(SingleSelectFieldCore, Field) {
  private _choiceMap: Record<string, ISelectFieldDisplayChoice> = {};

  get displayChoiceMap() {
    if (Object.keys(this._choiceMap).length === 0) {
      const displayedChoices = this.options.choices.map(({ id, name, color }) => {
        return {
          id,
          name,
          color: ColorUtils.shouldUseLightTextOnColor(color) ? colors.white : colors.black,
          backgroundColor: ColorUtils.getHexForColor(color),
        };
      });
      this._choiceMap = keyBy(displayedChoices, 'name');
    }
    return this._choiceMap;
  }
}
