export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
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
