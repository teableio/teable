const delimiter = '\t';
const newline = '\n';
const windowsNewline = '\r\n';

// eslint-disable-next-line sonarjs/cognitive-complexity
export const parseClipboardText = (content: string) => {
  const _newline = content.includes(windowsNewline) ? windowsNewline : newline;
  // remove the last newline or windows newline
  if (content.endsWith(_newline)) {
    content = content.slice(0, -1 * _newline.length);
  }
  if (content.startsWith(_newline)) {
    content = content.slice(_newline.length);
  }
  if (!content.includes('"')) {
    return content.split(_newline).map((row) => row.split(delimiter));
  }

  const len = content.length;
  let cursor = 0;
  const tableData: string[][] = [];
  let row: string[] = [];
  let endOfRow = false;
  while (cursor < len) {
    let cell = '';
    let quoted = false;
    let endOfCell = false;
    if (content[cursor] === '"') {
      quoted = true;
    } else if (content[cursor] === delimiter) {
      endOfCell = true;
    } else if (content[cursor] === _newline) {
      endOfCell = true;
      endOfRow = true;
    } else {
      cell += content[cursor];
    }
    while (!endOfCell) {
      cursor++;
      // handle only one cell
      if (cursor >= len) {
        endOfCell = true;
        endOfRow = true;
        cell = quoted ? `"${cell}` : cell;
        break;
      }
      if (content[cursor] === '"' && quoted) {
        if (content[cursor + 1] === '"') {
          cell += '"';
          cursor++;
        } else if (cell.includes(delimiter) || cell.includes(_newline)) {
          quoted = false;
        } else {
          cell = `"${cell}"`;
          quoted = false;
        }
      } else if (content[cursor] === delimiter) {
        if (quoted) {
          cell += delimiter;
        } else {
          endOfCell = true;
          break;
        }
      } else if (
        content[cursor] === _newline ||
        `${content[cursor]}${content[cursor + 1]}` === _newline
      ) {
        if (quoted) {
          cell += _newline;
        } else {
          endOfCell = true;
          endOfRow = true;
        }
        if (`${content[cursor]}${content[cursor + 1]}` === _newline) {
          cursor++;
        }
      } else {
        cell += content[cursor];
      }
    }
    cursor++;
    row.push(cell);
    // Handling of the last column with no content, example: "text1"\t"text2"\t
    if (endOfCell && cursor >= len && content[cursor - 1] === '\t') {
      endOfRow = true;
      row.push('');
    }

    if (endOfRow) {
      tableData.push(row);
      row = [];
      endOfRow = false;
    }
  }
  return tableData;
};

export const stringifyClipboardText = (content: string[][]) => {
  return content
    .map((row) =>
      row
        .map((cell) =>
          cell.includes(delimiter) || cell.includes(newline)
            ? `"${cell.replace(/"/g, '""')}"`
            : cell
        )
        .join(delimiter)
    )
    .join(newline);
};
