import { FieldSupplementService } from '../../src/features/field/field-calculate/field-supplement.service';

/** Poison only retired admission entries after fixtures; keep the real host policy and API live. */
export const disableLegacyFieldAdmission = (): (() => void) => {
  const prototype = FieldSupplementService.prototype;
  const entries = [
    'isCrossSpaceTarget',
    'assertSameSpaceLinkTarget',
    'getForeignTableId',
    'isCrossSpaceField',
    'assertNoNewCrossSpaceField',
    'assertNewForeignTableAllowed',
    'assertForeignTableReadable',
  ];
  const descriptors = entries.map((entry) => Object.getOwnPropertyDescriptor(prototype, entry));
  for (const entry of entries) {
    Object.defineProperty(prototype, entry, {
      configurable: true,
      value: () => {
        throw new Error(`Retired FieldSupplement admission entry called: ${entry}`);
      },
    });
  }
  return () => {
    entries.forEach((entry, index) => {
      const descriptor = descriptors[index];
      if (descriptor) {
        Object.defineProperty(prototype, entry, descriptor);
      } else {
        Reflect.deleteProperty(prototype, entry);
      }
    });
  };
};
