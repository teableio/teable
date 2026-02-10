import { describe, expect, it } from 'vitest';

import { ButtonLabel } from './ButtonLabel';
import { ButtonMaxCount } from './ButtonMaxCount';
import { ButtonResetCount } from './ButtonResetCount';
import { ButtonWorkflow } from './ButtonWorkflow';
import { CheckboxDefaultValue } from './CheckboxDefaultValue';
import { DateDefaultValue } from './DateDefaultValue';
import { FieldColor } from './FieldColor';
import { FieldComputed } from './FieldComputed';
import { FieldNotNull } from './FieldNotNull';
import { FieldUnique } from './FieldUnique';
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
    expect(name._unsafeUnwrap().equals(otherName._unsafeUnwrap())).toBe(true);
    expect(name._unsafeUnwrap().equals(differentName._unsafeUnwrap())).toBe(false);
    SelectOptionName.create('')._unsafeUnwrapErr();

    const idResult = SelectOptionId.generate();
    idResult._unsafeUnwrap();

    expect(idResult._unsafeUnwrap().toString()).toMatch(/^cho/);
    const sameId = SelectOptionId.create(idResult._unsafeUnwrap().toString());
    sameId._unsafeUnwrap();

    expect(idResult._unsafeUnwrap().equals(sameId._unsafeUnwrap())).toBe(true);
    SelectOptionId.create('')._unsafeUnwrapErr();
  });
});

describe('SelectOption', () => {
  it('creates options and maps to dto', () => {
    const result = SelectOption.create({ name: 'Todo', color: 'blue' });
    result._unsafeUnwrap();

    const dto = result._unsafeUnwrap().toDto();
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
    expect(one._unsafeUnwrap().equals(two._unsafeUnwrap())).toBe(true);
    expect(one._unsafeUnwrap().equals(other._unsafeUnwrap())).toBe(false);
  });
});

describe('SelectDefaultValue', () => {
  it('handles single and multiple values', () => {
    const single = SelectDefaultValue.create('Todo');
    const multiple = SelectDefaultValue.create(['Todo', 'Done']);
    expect(single._unsafeUnwrap().isMultiple()).toBe(false);
    expect(multiple._unsafeUnwrap().isMultiple()).toBe(true);
    expect(single._unsafeUnwrap().toDto()).toBe('Todo');
    expect(multiple._unsafeUnwrap().toDto()).toEqual(['Todo', 'Done']);
    expect(single._unsafeUnwrap().equals(single._unsafeUnwrap())).toBe(true);
    expect(multiple._unsafeUnwrap().equals(multiple._unsafeUnwrap())).toBe(true);
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
    expect(prevent.equals(created._unsafeUnwrap())).toBe(true);
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
    expect(computed.equals(created._unsafeUnwrap())).toBe(true);
    FieldComputed.create('nope')._unsafeUnwrapErr();
    expect(computed.toBoolean()).toBe(true);
    expect(manual.toBoolean()).toBe(false);
  });
});

describe('FieldNotNull', () => {
  it('supports required/optional and boolean values', () => {
    const required = FieldNotNull.required();
    const optional = FieldNotNull.optional();
    const created = FieldNotNull.create(true);
    created._unsafeUnwrap();

    expect(required.equals(optional)).toBe(false);
    expect(required.equals(created._unsafeUnwrap())).toBe(true);
    FieldNotNull.create('nope')._unsafeUnwrapErr();
    expect(required.toBoolean()).toBe(true);
    expect(optional.toBoolean()).toBe(false);
  });
});

describe('FieldUnique', () => {
  it('supports enabled/disabled and boolean values', () => {
    const enabled = FieldUnique.enabled();
    const disabled = FieldUnique.disabled();
    const created = FieldUnique.create(true);
    created._unsafeUnwrap();

    expect(enabled.equals(disabled)).toBe(false);
    expect(enabled.equals(created._unsafeUnwrap())).toBe(true);
    FieldUnique.create('nope')._unsafeUnwrapErr();
    expect(enabled.toBoolean()).toBe(true);
    expect(disabled.toBoolean()).toBe(false);
  });
});

describe('SelectOptions', () => {
  it('validates uniqueness and default values', () => {
    const optionOne = SelectOption.create({ name: 'Todo', color: 'blue' });
    const optionTwo = SelectOption.create({ name: 'Done', color: 'green' });
    const duplicate = SelectOption.create({ name: 'Todo', color: 'blue' });
    const defaultValue = SelectDefaultValue.create('Todo');

    const uniqueResult = validateSelectOptions(
      [optionOne._unsafeUnwrap(), optionTwo._unsafeUnwrap()],
      defaultValue._unsafeUnwrap()
    );
    uniqueResult._unsafeUnwrap();

    const duplicateResult = validateSelectOptions([
      optionOne._unsafeUnwrap(),
      duplicate._unsafeUnwrap(),
    ]);
    duplicateResult._unsafeUnwrapErr();

    const invalidDefault = SelectDefaultValue.create('Missing');
    invalidDefault._unsafeUnwrap();

    const invalidResult = validateSelectOptions(
      [optionOne._unsafeUnwrap()],
      invalidDefault._unsafeUnwrap()
    );
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
    expect(color._unsafeUnwrap().equals(other._unsafeUnwrap())).toBe(true);
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

    expect(label._unsafeUnwrap().toString()).toBe('Run');
    expect(ButtonLabel.default().toString()).toBe('Button');
    expect(label._unsafeUnwrap().equals(ButtonLabel.default())).toBe(false);
    expect(count._unsafeUnwrap().toNumber()).toBe(3);
    expect(count._unsafeUnwrap().equals(count._unsafeUnwrap())).toBe(true);
    expect(reset._unsafeUnwrap().toBoolean()).toBe(true);
    expect(reset._unsafeUnwrap().equals(reset._unsafeUnwrap())).toBe(true);
    const workflowValue = workflow._unsafeUnwrap();
    expect(workflowValue?.toDto()).toEqual({
      id: 'wfl12345678901234',
      name: 'Deploy',
      isActive: true,
    });
    expect(workflowValue).toBeDefined();
    if (!workflowValue) return;
    expect(workflowValue.equals(workflowValue)).toBe(true);
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
    expect(text._unsafeUnwrap().toString()).toBe('hello');
    expect(text._unsafeUnwrap().equals(text._unsafeUnwrap())).toBe(true);
    expect(number._unsafeUnwrap().toNumber()).toBe(5);
    expect(number._unsafeUnwrap().equals(number._unsafeUnwrap())).toBe(true);
    expect(checkbox._unsafeUnwrap().toBoolean()).toBe(false);
    expect(checkbox._unsafeUnwrap().equals(checkbox._unsafeUnwrap())).toBe(true);
    expect(date._unsafeUnwrap().toString()).toBe('now');
    expect(date._unsafeUnwrap().equals(date._unsafeUnwrap())).toBe(true);
    NumberDefaultValue.create('bad')._unsafeUnwrapErr();
  });

  it('validates rating values', () => {
    const max = RatingMax.create(5);
    const icon = RatingIcon.create('star');
    const color = RatingColor.create('yellowBright');
    expect(max._unsafeUnwrap().toNumber()).toBe(5);
    expect(max._unsafeUnwrap().equals(max._unsafeUnwrap())).toBe(true);
    expect(icon._unsafeUnwrap().toString()).toBe('star');
    expect(icon._unsafeUnwrap().equals(icon._unsafeUnwrap())).toBe(true);
    expect(color._unsafeUnwrap().toString()).toBe('yellowBright');
    expect(color._unsafeUnwrap().equals(color._unsafeUnwrap())).toBe(true);
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

    expect(me._unsafeUnwrap().isMe()).toBe(true);
    expect(user._unsafeUnwrap().isMe()).toBe(false);
    expect(me._unsafeUnwrap().equals(user._unsafeUnwrap())).toBe(false);
    expect(multiple.toBoolean()).toBe(true);
    expect(single.toBoolean()).toBe(false);
    expect(multiple.equals(UserMultiplicity.multiple())).toBe(true);
    expect(notify._unsafeUnwrap().toBoolean()).toBe(true);
    expect(notify._unsafeUnwrap().equals(notify._unsafeUnwrap())).toBe(true);
    expect(defaults._unsafeUnwrap().isMultiple()).toBe(true);
    expect(defaults._unsafeUnwrap().toDto()).toEqual(['me', 'usr123']);
    expect(defaults._unsafeUnwrap().equals(defaults._unsafeUnwrap())).toBe(true);
  });
});

describe('Link field values', () => {
  it('validates relationships and meta', () => {
    const relationship = LinkRelationship.create('oneMany');
    const reverse = LinkRelationship.manyOne();
    const meta = LinkFieldMeta.create({ hasOrderColumn: true });
    const emptyMeta = LinkFieldMeta.create(undefined);
    expect(relationship._unsafeUnwrap().isMultipleValue()).toBe(true);
    expect(relationship._unsafeUnwrap().reverse().equals(reverse)).toBe(true);
    const metaValue = meta._unsafeUnwrap();
    expect(metaValue?.hasOrderColumn()).toBe(true);
    expect(metaValue).toBeDefined();
    if (!metaValue) return;
    expect(metaValue.equals(metaValue)).toBe(true);
    expect(emptyMeta._unsafeUnwrap()).toBeUndefined();
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

  it('accepts Etc/GMT timezone format', () => {
    // Etc/GMT-8 is UTC+8 (China Standard Time)
    expect(TimeZone.create('Etc/GMT-8')._unsafeUnwrap().toString()).toBe('Etc/GMT-8');
    expect(TimeZone.create('Etc/GMT+8')._unsafeUnwrap().toString()).toBe('Etc/GMT+8');
    expect(TimeZone.create('Etc/UTC')._unsafeUnwrap().toString()).toBe('Etc/UTC');
  });

  it('provides detailed error message for invalid timezone', () => {
    const result = TimeZone.create('Invalid/Zone');
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.message).toBe('Invalid TimeZone: Invalid/Zone');
    expect(error.details?.value).toBe('Invalid/Zone');
  });
});
