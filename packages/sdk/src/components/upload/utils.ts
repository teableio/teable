export const calculateVisibleItems = (fullName: string, maxLength: number = 20) => {
  const gap = Math.floor(maxLength / 4);
  const start = gap * 2;
  const end = gap;
  const arr = fullName.split('.');
  const extension = arr.pop();
  const name = arr.join('.');
  const visibleName =
    name.length > start ? `${name.slice(0, start)}...${name.slice(name.length - end)}` : name;
  return `${visibleName}.${extension}`;
};
