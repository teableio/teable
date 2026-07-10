import type { ISelectFieldChoice, ISelectFieldOptions } from '@teable/core';
import { ColorUtils, generateChoiceId } from '@teable/core';

/**
 * Optimistically append a select choice to local field options.
 *
 * temporaryPaste typecast creates the choice server-side and publishes a field
 * ShareDB op, but the HTTP response does not return updated options. Editors
 * call updateCell immediately after temporaryPaste; without this local append,
 * validateCellValue treats the new name as unknown and the tag flashes away.
 */
export function ensureSelectChoice(
  options: ISelectFieldOptions | undefined | null,
  name: string
): ISelectFieldChoice | undefined {
  const trimmedName = name.trim();
  if (!options || !trimmedName) {
    return undefined;
  }

  const choices = options.choices ?? (options.choices = []);
  const existing = choices.find((choice) => choice.name === trimmedName);
  if (existing) {
    return existing;
  }

  const choice: ISelectFieldChoice = {
    id: generateChoiceId(),
    name: trimmedName,
    color: ColorUtils.randomColor(choices.map((item) => item.color))[0],
  };
  choices.push(choice);
  return choice;
}
