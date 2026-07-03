# Context Diff Explorer

A static React + Vite viewer for classic `diff -c` / context-format patches. It parses context diff input, shows changed files and hunks, and supports both line-level and word-level highlighting with word diff enabled by default.

## Local development

```bash
npm install
npm run dev
```

If your shell exports `NODE_ENV=production`, install with:

```bash
npm install --include=dev
```

## Build for your current deployment flow

```bash
npm run build
cd dist
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Features

- Paste raw context diff text or upload a `.diff`, `.patch`, or `.txt` file
- Left-side file navigator with hunk counts, row counts, and middle-ellipsis path handling for long filenames
- Side-by-side old/new view for each hunk
- `Word Diff` and `Line Diff` toggle, with `Word Diff` selected by default
- Copy only the current file's `Old` column or `New` column with one click
- Large patch mode: parsing in a Web Worker, lazy offscreen hunk mounting, and batched row rendering for oversized hunks
- Static build output in `dist/`, ready for Nginx, Caddy, or Python's simple HTTP server
