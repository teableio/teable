import { describe, expect, it } from 'vitest';

import { ButtonLabel } from './ButtonLabel';
import { ButtonMaxCount } from './ButtonMaxCount';
import { ButtonResetCount } from './ButtonResetCount';
import { ButtonWorkflow } from './ButtonWorkflow';
import { CheckboxDefaultValue } from './CheckboxDefaultValue';
import { DateDefaultValue } from './DateDefaultValue';
import { FieldColor } from './FieldColor';
import { FieldComputed } from './FieldComputed';
import { NumberDefaultValue } from './NumberDefaultValue';
import { RatingColor } from './RatingColor';
import { RatingIcon } from './RatingIcon';
import { RatingMax } from './RatingMax';
import { SelectAutoNewOptions } from './SelectAutoNewOptions';
import { SelectDefaultValue } from './SelectDefaultValue';
import { SelectOption } from './SelectOption';
import { SelectOptionId } from './SelectOptionId';
import { SelectOptionName } from './SelectOptionName';
import { validateSelectOptions } from './SelectOptions';
import { TextDefaultValue } from './TextDefaultValue';
import { TimeZone } from './TimeZone';
import { UserDefaultValue } from './UserDefaultValue';
import { UserId } from './UserId';
import { UserMultiplicity } from './UserMultiplicity';
import { UserNotification } from './UserNotification';

describe('SelectOptionName/Id', () => {
  it('validates names and ids', () => {
    const name = SelectOptionName.create('Option');
    const otherName = SelectOptionName.create('Option');
    const differentName = SelectOptionName.create('Other');
    expect([name, otherName, differentName].every((r) => r.isOk())).toBe(true);
    if (name.isErr() || otherName.isErr() || differentName.isErr()) return;
    expect(name.value.equals(otherName.value)).toBe(true);
    expect(name.value.equals(differentName.value)).toBe(false);
    expect(SelectOptionName.create('').isErr()).toBe(true);

    const idResult = SelectOptionId.generate();
    expect(idResult.isOk()).toBe(true);
    if (idResult.isErr()) return;
    expect(idResult.value.toString()).toMatch(/^cho/);
    const sameId = SelectOptionId.create(idResult.value.toString());
    expect(sameId.isOk()).toBe(true);
    if (sameId.isErr()) return;
    expect(idResult.value.equals(sameId.value)).toBe(true);
    expect(SelectOptionId.create('').isErr()).toBe(true);
  });
});

describe('SelectOption', () => {
  it('creates options and maps to dto', () => {
    const result = SelectOption.create({ name: 'Todo', color: 'blue' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const dto = result.value.toDto();
    expect(dto.name).toBe('Todo');
    expect(dto.color).toBe('blue');
  });

  it('compares options by value', () => {
    const one = SelectOption.create({ id: 'cho12345678', name: 'Todo', color: 'blue' });
    const two = SelectOption.create({ id: 'cho12345678', name: 'Todo', color: 'blue' });
    const other = SelectOption.create({ id: 'cho87654321', name: 'Done', color: 'green' });
    expect([one, two, other].every((r) => r.isOk())).toBe(true);
    if (one.isErr() || two.isErr() || other.isErr()) return;
    expect(one.value.equals(two.value)).toBe(true);
    expect(one.value.equals(other.value)).toBe(false);
  });
});

describe('SelectDefaultValue', () => {
  it('handles single and multiple values', () => {
    const single = SelectDefaultValue.create('Todo');
    const multiple = SelectDefaultValue.create(['Todo', 'Done']);
    expect(single.isOk()).toBe(true);
    expect(multiple.isOk()).toBe(true);
    if (single.isErr() || multiple.isErr()) return;
    expect(single.value.isMultiple()).toBe(false);
    expect(multiple.value.isMultiple()).toBe(true);
    expect(single.value.toDto()).toBe('Todo');
    expect(multiple.value.toDto()).toEqual(['Todo', 'Done']);
    expect(single.value.equals(single.value)).toBe(true);
    expect(multiple.value.equals(multiple.value)).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(SelectDefaultValue.create(1).isErr()).toBe(true);
  });
});

describe('SelectAutoNewOptions', () => {
  it('supports allow/prevent and boolean values', () => {
    const allow = SelectAutoNewOptions.allow();
    const prevent = SelectAutoNewOptions.prevent();
    const created = SelectAutoNewOptions.create(true);
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    expect(allow.equals(prevent)).toBe(false);
    expect(prevent.equals(created.value)).toBe(true);
    expect(SelectAutoNewOptions.create('nope').isErr()).toBe(true);
    expect(SelectAutoNewOptions.allow().toBoolean()).toBe(false);
    expect(SelectAutoNewOptions.prevent().toBoolean()).toBe(true);
  });
});

describe('FieldComputed', () => {
  it('supports computed/manual and boolean values', () => {
    const computed = FieldComputed.computed();
    const manual = FieldComputed.manual();
    const created = FieldComputed.create(true);
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    expect(computed.equals(manual)).toBe(false);
    expect(computed.equals(created.value)).toBe(true);
    expect(FieldComputed.create('nope').isErr()).toBe(true);
    expect(computed.toBoolean()).toBe(true);
    expect(manual.toBoolean()).toBe(false);
  });
});

describe('SelectOptions', () => {
  it('validates uniqueness and default values', () => {
    const optionOne = SelectOption.create({ name: 'Todo', color: 'blue' });
    const optionTwo = SelectOption.create({ name: 'Done', color: 'green' });
    const duplicate = SelectOption.create({ name: 'Todo', color: 'blue' });
    const defaultValue = SelectDefaultValue.create('Todo');
    expect([optionOne, optionTwo, duplicate, defaultValue].every((r) => r.isOk())).toBe(true);
    if (optionOne.isErr() || optionTwo.isErr() || duplicate.isErr() || defaultValue.isErr()) return;

    const uniqueResult = validateSelectOptions(
      [optionOne.value, optionTwo.value],
      defaultValue.value
    );
    expect(uniqueResult.isOk()).toBe(true);

    const duplicateResult = validateSelectOptions([optionOne.value, duplicate.value]);
    expect(duplicateResult.isErr()).toBe(true);

    const invalidDefault = SelectDefaultValue.create('Missing');
    expect(invalidDefault.isOk()).toBe(true);
    if (invalidDefault.isErr()) return;
    const invalidResult = validateSelectOptions([optionOne.value], invalidDefault.value);
    expect(invalidResult.isErr()).toBe(true);
  });
});

describe('FieldColor', () => {
  it('validates and compares colors', () => {
    const color = FieldColor.create('blue');
    const other = FieldColor.create('blue');
    expect([color, other].every((r) => r.isOk())).toBe(true);
    if (color.isErr() || other.isErr()) return;
    expect(color.value.equals(other.value)).toBe(true);
    expect(FieldColor.from('teal').toString()).toBe('teal');
    expect(FieldColor.create('invalid').isErr()).toBe(true);
  });
});

describe('Button types', () => {
  it('validates labels, counts, reset, and workflow', () => {
    const label = ButtonLabel.create('Run');
    const count = ButtonMaxCount.create(3);
    const reset = ButtonResetCount.create(true);
    const workflow = ButtonWorkflow.create({
      id: 'wfl12345678901234',
      name: 'Deploy',
      isActive: true,
    });
    expect([label, count, reset, workflow].every((r) => r.isOk())).toBe(true);
    if (label.isErr() || count.isErr() || reset.isErr() || workflow.isErr()) return;

    expect(label.value.toString()).toBe('Run');
    expect(ButtonLabel.default().toString()).toBe('Button');
    expect(label.value.equals(ButtonLabel.default())).toBe(false);
    expect(count.value.toNumber()).toBe(3);
    expect(count.value.equals(count.value)).toBe(true);
    expect(reset.value.toBoolean()).toBe(true);
    expect(reset.value.equals(reset.value)).toBe(true);
    expect(workflow.value?.toDto()).toEqual({
      id: 'wfl12345678901234',
      name: 'Deploy',
      isActive: true,
    });
    expect(workflow.value?.equals(workflow.value)).toBe(true);
  });

  it('rejects invalid workflows and labels', () => {
    expect(ButtonLabel.create(1).isErr()).toBe(true);
    expect(ButtonWorkflow.create({ id: 'bad' }).isErr()).toBe(true);
    const emptyWorkflow = ButtonWorkflow.create(null);
    expect(emptyWorkflow.isOk()).toBe(true);
  });
});

describe('Defaults and rating values', () => {
  it('validates default values', () => {
    const text = TextDefaultValue.create(' hello ');
    const number = NumberDefaultValue.create(5);
    const checkbox = CheckboxDefaultValue.create(false);
    const date = DateDefaultValue.create('now');
    expect([text, number, checkbox, date].every((r) => r.isOk())).toBe(true);
    if (text.isErr() || number.isErr() || checkbox.isErr() || date.isErr()) return;
    expect(text.value.toString()).toBe('hello');
    expect(text.value.equals(text.value)).toBe(true);
    expect(number.value.toNumber()).toBe(5);
    expect(number.value.equals(number.value)).toBe(true);
    expect(checkbox.value.toBoolean()).toBe(false);
    expect(checkbox.value.equals(checkbox.value)).toBe(true);
    expect(date.value.toString()).toBe('now');
    expect(date.value.equals(date.value)).toBe(true);
    expect(NumberDefaultValue.create('bad').isErr()).toBe(true);
  });

  it('validates rating values', () => {
    const max = RatingMax.create(5);
    const icon = RatingIcon.create('star');
    const color = RatingColor.create('yellowBright');
    expect([max, icon, color].every((r) => r.isOk())).toBe(true);
    if (max.isErr() || icon.isErr() || color.isErr()) return;
    expect(max.value.toNumber()).toBe(5);
    expect(max.value.equals(max.value)).toBe(true);
    expect(icon.value.toString()).toBe('star');
    expect(icon.value.equals(icon.value)).toBe(true);
    expect(color.value.toString()).toBe('yellowBright');
    expect(color.value.equals(color.value)).toBe(true);
  });
});

describe('User values', () => {
  it('validates user ids and defaults', () => {
    const me = UserId.create('me');
    const user = UserId.create('usr123');
    const multiple = UserMultiplicity.multiple();
    const single = UserMultiplicity.single();
    const notify = UserNotification.create(true);
    const defaults = UserDefaultValue.create(['me', 'usr123']);
    expect([me, user, notify, defaults].every((r) => r.isOk())).toBe(true);
    if (me.isErr() || user.isErr() || notify.isErr() || defaults.isErr()) return;

    expect(me.value.isMe()).toBe(true);
    expect(user.value.isMe()).toBe(false);
    expect(me.value.equals(user.value)).toBe(false);
    expect(multiple.toBoolean()).toBe(true);
    expect(single.toBoolean()).toBe(false);
    expect(multiple.equals(UserMultiplicity.multiple())).toBe(true);
    expect(notify.value.toBoolean()).toBe(true);
    expect(notify.value.equals(notify.value)).toBe(true);
    expect(defaults.value.isMultiple()).toBe(true);
    expect(defaults.value.toDto()).toEqual(['me', 'usr123']);
    expect(defaults.value.equals(defaults.value)).toBe(true);
  });
});

describe('TimeZone', () => {
  it('validates time zones', () => {
    expect(TimeZone.create('utc').isOk()).toBe(true);
    expect(TimeZone.utc().toString()).toBe('utc');
    expect(TimeZone.create('Bad/Zone').isErr()).toBe(true);
  });
});
