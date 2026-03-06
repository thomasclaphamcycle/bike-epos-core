# React Frontend Usage

## Run

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Backend should be running on `http://localhost:3000`.

## POS (M76)

Route: `/pos`

Keyboard and scanner flow:

- `/` focuses the search input.
- Barcode scans ending with `Enter` auto-add exact matches.
- `Enter` adds the top search result.
- `ArrowUp` / `ArrowDown` selects basket lines.
- `+` / `-` adjusts quantity on selected line.
- `Delete` / `Backspace` removes selected line.
- `Ctrl+Enter` opens completion confirmation.

The page keeps search focused after add/remove/qty changes and shows a **Last scanned** indicator.
