export function getUniqName(name: string, existNames: string[]) {
  if (!existNames.includes(name)) {
    return name;
  }

  let baseName = name;
  let num = 2;

  if (Number.isNaN(Number(name))) {
    const match = /^(.*)(\b\d+)$/.exec(name);

    if (match) {
      baseName = match[1].trim(); // The base part of the name, without the number
      num = Number.parseInt(match[2], 10); // The number at the end of the name
    }
  }

  // If the base name with the current number exists, increment the number until we find one that doesn't exist
  while (existNames.includes(`${baseName} ${num}`)) {
    num++;
  }

  return `${baseName} ${num}`;
}
