export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

export const parseCsv = (input: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (input[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field");
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
};

const escapeCsvCell = (value: string) => {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
};

export const toCsv = <T>(rows: T[], columns: CsvColumn<T>[]) => {
  const headerLine = columns.map((column) => escapeCsvCell(column.header)).join(",");

  if (rows.length === 0) {
    return `${headerLine}\n`;
  }

  const bodyLines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = column.value(row);
        const value = raw === null || raw === undefined ? "" : String(raw);
        return escapeCsvCell(value);
      })
      .join(","),
  );

  return [headerLine, ...bodyLines].join("\n");
};
