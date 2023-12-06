let uuid = 0;

export const genFileId = () => {
  uuid += 1;
  return uuid;
};
