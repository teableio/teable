export const selectOnChange = (changeVal: string, oldValue: string[], isMultiple?: boolean) => {
  if (oldValue.includes(changeVal)) {
    return oldValue.filter((v) => v !== changeVal);
  }
  if (isMultiple) {
    return oldValue.concat(changeVal);
  }
  return [changeVal];
};
