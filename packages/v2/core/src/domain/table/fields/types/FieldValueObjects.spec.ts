import { describe, expect, it } from 'vitest';

import { ButtonLabel } from './ButtonLabel';
import { ButtonMaxCount } from './ButtonMaxCount';
import { ButtonResetCount } from './ButtonResetCount';
import { ButtonWorkflow } from './ButtonWorkflow';
import { CheckboxDefaultValue } from './CheckboxDefaultValue';
import { DateDefaultValue } from './DateDefaultValue';
import { FieldColor } from './FieldColor';
import { FieldComputed } from './FieldComputed';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LinkFieldMeta } from './LinkFieldMeta';
import { LinkRelationship } from './LinkRelationship';
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
    [name, otherName, differentName].forEach((r) => r._unsafeUnwrap());
    name._unsafeUnwrap();
    otherName._unsafeUnwrap();
    differentName._unsafeUnwrap();
    expect(name.value.equals(otherName.value)).toBe(true);
    expect(name.value.equals(differentName.value)).toBe(false);
    SelectOptionName.create('')._unsafeUnwrapErr();

    const idResult = SelectOptionId.generate();
    idResult._unsafeUnwrap();

    expect(idResult._unsafeUnwrap().toString()).toMatch(/^cho/);
    const sameId = SelectOptionId.create(idResult._unsafeUnwrap().toString());
    sameId._unsafeUnwrap();

    expect(idResult._unsafeUnwrap().equals(sameId.value)).toBe(true);
    SelectOptionId.create('')._unsafeUnwrapErr();
  });
});

describe('SelectOption', () => {
  it('creates options and maps to dto', () => {
    const result = SelectOption.create({ name: 'Todo', color: 'blue' });
    result._unsafeUnwrap();

    const dto = result.value.toDto();
    expect(dto.name).toBe('Todo');
    expect(dto.color).toBe('blue');
  });

  it('compares options by value', () => {
    const one = SelectOption.create({ id: 'cho12345678', name: 'Todo', color: 'blue' });
    const two = SelectOption.create({ id: 'cho12345678', name: 'Todo', color: 'blue' });
    const other = SelectOption.create({ id: 'cho87654321', name: 'Done', color: 'green' });
    [one, two, other].forEach((r) => r._unsafeUnwrap());
    one._unsafeUnwrap();
    two._unsafeUnwrap();
    other._unsafeUnwrap();
    expect(one.value.equals(two.value)).toBe(true);
    expect(one.value.equals(other.value)).toBe(false);
  });
});

describe('SelectDefaultValue', () => {
  it('handles single and multiple values', () => {
    const single = SelectDefaultValue.create('Todo');
    const multiple = SelectDefaultValue.create(['Todo', 'Done']);
    single._unsafeUnwrap();
    multiple._unsafeUnwrap();
    single._unsafeUnwrap();
    multiple._unsafeUnwrap();
    expect(single.value.isMultiple()).toBe(false);
    expect(multiple.value.isMultiple()).toBe(true);
    expect(single.value.toDto()).toBe('Todo');
    expect(multiple.value.toDto()).toEqual(['Todo', 'Done']);
    expect(single.value.equals(single.value)).toBe(true);
    expect(multiple.value.equals(multiple.value)).toBe(true);
  });

  it('rejects invalid values', () => {
    SelectDefaultValue.create(1)._unsafeUnwrapErr();
  });
});

describe('SelectAutoNewOptions', () => {
  it('supports allow/prevent and boolean values', () => {
    const allow = SelectAutoNewOptions.allow();
    const prevent = SelectAutoNewOptions.prevent();
    const created = SelectAutoNewOptions.create(true);
    created._unsafeUnwrap();

    expect(allow.equals(prevent)).toBe(false);
    expect(prevent.equals(created.value)).toBe(true);
    SelectAutoNewOptions.create('nope')._unsafeUnwrapErr();
    expect(SelectAutoNewOptions.allow().toBoolean()).toBe(false);
    expect(SelectAutoNewOptions.prevent().toBoolean()).toBe(true);
  });
});

describe('FieldComputed', () => {
  it('supports computed/manual and boolean values', () => {
    const computed = FieldComputed.computed();
    const manual = FieldComputed.manual();
    const created = FieldComputed.create(true);
    created._unsafeUnwrap();

    expect(computed.equals(manual)).toBe(false);
    expect(computed.equals(created.value)).toBe(true);
    FieldComputed.create('nope')._unsafeUnwrapErr();
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
    [optionOne, optionTwo, duplicate, defaultValue].forEach((r) => r._unsafeUnwrap());
    optionOne._unsafeUnwrap();
    optionTwo._unsafeUnwrap();
    duplicate._unsafeUnwrap();
    defaultValue._unsafeUnwrap();

    const uniqueResult = validateSelectOptions(
      [optionOne.value, optionTwo.value],
      defaultValue.value
    );
    uniqueResult._unsafeUnwrap();

    const duplicateResult = validateSelectOptions([optionOne.value, duplicate.value]);
    duplicateResult._unsafeUnwrapErr();

    const invalidDefault = SelectDefaultValue.create('Missing');
    invalidDefault._unsafeUnwrap();

    const invalidResult = validateSelectOptions([optionOne.value], invalidDefault.value);
    invalidResult._unsafeUnwrapErr();
  });
});

describe('FieldColor', () => {
  it('validates and compares colors', () => {
    const color = FieldColor.create('blue');
    const other = FieldColor.create('blue');
    [color, other].forEach((r) => r._unsafeUnwrap());
    color._unsafeUnwrap();
    other._unsafeUnwrap();
    expect(color.value.equals(other.value)).toBe(true);
    expect(FieldColor.from('teal').toString()).toBe('teal');
    FieldColor.create('invalid')._unsafeUnwrapErr();
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
    [label, count, reset, workflow].forEach((r) => r._unsafeUnwrap());
    label._unsafeUnwrap();
    count._unsafeUnwrap();
    reset._unsafeUnwrap();
    workflow._unsafeUnwrap();

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
    ButtonLabel.create(1)._unsafeUnwrapErr();
    ButtonWorkflow.create({ id: 'bad' })._unsafeUnwrapErr();
    const emptyWorkflow = ButtonWorkflow.create(null);
    emptyWorkflow._unsafeUnwrap();
  });
});

describe('Defaults and rating values', () => {
  it('validates default values', () => {
    const text = TextDefaultValue.create(' hello ');
    const number = NumberDefaultValue.create(5);
    const checkbox = CheckboxDefaultValue.create(false);
    const date = DateDefaultValue.create('now');
    [text, number, checkbox, date].forEach((r) => r._unsafeUnwrap());
    text._unsafeUnwrap();
    number._unsafeUnwrap();
    checkbox._unsafeUnwrap();
    date._unsafeUnwrap();
    expect(text.value.toString()).toBe('hello');
    expect(text.value.equals(text.value)).toBe(true);
    expect(number.value.toNumber()).toBe(5);
    expect(number.value.equals(number.value)).toBe(true);
    expect(checkbox.value.toBoolean()).toBe(false);
    expect(checkbox.value.equals(checkbox.value)).toBe(true);
    expect(date.value.toString()).toBe('now');
    expect(date.value.equals(date.value)).toBe(true);
    NumberDefaultValue.create('bad')._unsafeUnwrapErr();
  });

  it('validates rating values', () => {
    const max = RatingMax.create(5);
    const icon = RatingIcon.create('star');
    const color = RatingColor.create('yellowBright');
    [max, icon, color].forEach((r) => r._unsafeUnwrap());
    max._unsafeUnwrap();
    icon._unsafeUnwrap();
    color._unsafeUnwrap();
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
    [me, user, notify, defaults].forEach((r) => r._unsafeUnwrap());
    me._unsafeUnwrap();
    user._unsafeUnwrap();
    notify._unsafeUnwrap();
    defaults._unsafeUnwrap();

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

describe('Link field values', () => {
  it('validates relationships and meta', () => {
    const relationship = LinkRelationship.create('oneMany');
    const reverse = LinkRelationship.manyOne();
    const meta = LinkFieldMeta.create({ hasOrderColumn: true });
    const emptyMeta = LinkFieldMeta.create(undefined);
    [relationship, meta, emptyMeta].forEach((r) => r._unsafeUnwrap());
    relationship._unsafeUnwrap();
    meta._unsafeUnwrap();
    emptyMeta._unsafeUnwrap();
    expect(relationship.value.isMultipleValue()).toBe(true);
    expect(relationship.value.reverse().equals(reverse)).toBe(true);
    expect(meta.value?.hasOrderColumn()).toBe(true);
    expect(meta.value?.equals(meta.value)).toBe(true);
    expect(emptyMeta.value).toBeUndefined();
  });

  it('validates link config', () => {
    const configResult = LinkFieldConfig.create({
      baseId: `bse${'a'.repeat(16)}`,
      relationship: LinkRelationship.oneMany().toString(),
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: `fld${'c'.repeat(16)}`,
      isOneWay: true,
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_field',
      symmetricFieldId: `fld${'d'.repeat(16)}`,
      filterByViewId: `viw${'e'.repeat(16)}`,
      visibleFieldIds: [`fld${'c'.repeat(16)}`, `fld${'d'.repeat(16)}`],
    });

    configResult._unsafeUnwrap();

    const config = configResult._unsafeUnwrap();
    expect(config.baseId()?.toString()).toBe(`bse${'a'.repeat(16)}`);
    expect(config.relationship().equals(LinkRelationship.oneMany())).toBe(true);
    expect(config.isOneWay()).toBe(true);
    expect(config.isMultipleValue()).toBe(true);
    const orderResult = config.orderColumnName();
    orderResult._unsafeUnwrap();

    expect(orderResult._unsafeUnwrap()).toBe('__id_order');
    const dtoResult = config.toDto();
    dtoResult._unsafeUnwrap();

    expect(dtoResult._unsafeUnwrap().foreignTableId).toBe(`tbl${'b'.repeat(16)}`);
  });
});

describe('TimeZone', () => {
  it('validates time zones', () => {
    TimeZone.create('utc')._unsafeUnwrap();
    expect(TimeZone.utc().toString()).toBe('utc');
    TimeZone.create('Bad/Zone')._unsafeUnwrapErr();
  });
});
