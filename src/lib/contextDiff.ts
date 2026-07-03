export type ViewMode = "word" | "line";

export interface RangeInfo {
  start: number;
  end: number;
}

export interface SectionLine {
  text: string;
  lineNumber: number | null;
}

export interface DiffToken {
  text: string;
  kind: "unchanged" | "added" | "removed";
}

export interface DiffRow {
  kind: "context" | "delete" | "add" | "modify";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldText: string;
  newText: string;
}

export interface HunkDiff {
  id: string;
  oldRange: RangeInfo;
  newRange: RangeInfo;
  rows: DiffRow[];
}

export interface FileSummary {
  added: number;
  deleted: number;
  modified: number;
  context: number;
  rows: number;
  maxHunkRows: number;
}

export interface FileDiff {
  id: string;
  displayName: string;
  oldLabel: string;
  newLabel: string;
  hunks: HunkDiff[];
  summary: FileSummary;
}

export interface DiffSummary extends FileSummary {
  files: number;
  hunks: number;
}

export interface ParsedContextDiff {
  files: FileDiff[];
  summary: DiffSummary;
}

const HUNK_DIVIDER = "***************";
const OLD_RANGE_RE = /^\*\*\* (\d+)(?:,(\d+))? \*\*\*\*$/;
const NEW_RANGE_RE = /^--- (\d+)(?:,(\d+))? ----$/;
const wordDiffCache = new Map<string, { oldTokens: DiffToken[]; newTokens: DiffToken[] }>();

export function parseContextDiff(input: string): ParsedContextDiff {
  const normalized = input.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const files: FileDiff[] = [];
  let index = 0;
  let fileCounter = 0;

  while (index < lines.length) {
    const current = lines[index];

    if (!current.startsWith("*** ") || OLD_RANGE_RE.test(current)) {
      index += 1;
      continue;
    }

    const next = lines[index + 1];
    if (!next?.startsWith("--- ") || NEW_RANGE_RE.test(next)) {
      index += 1;
      continue;
    }

    const oldLabel = current.slice(4).trim();
    const newLabel = next.slice(4).trim();
    index += 2;

    const hunks: HunkDiff[] = [];
    let hunkCounter = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (line.startsWith("*** ") && !OLD_RANGE_RE.test(line) && lines[index + 1]?.startsWith("--- ")) {
        break;
      }

      if (line !== HUNK_DIVIDER) {
        index += 1;
        continue;
      }

      const oldRangeLine = lines[index + 1];
      const newRangeLineIndex = findNewRangeLine(lines, index + 2);

      if (!oldRangeLine || !OLD_RANGE_RE.test(oldRangeLine)) {
        throw new Error(`Invalid old hunk header near line ${index + 2}.`);
      }

      if (newRangeLineIndex === -1) {
        throw new Error(`Missing new hunk header after line ${index + 2}.`);
      }

      const newRangeLine = lines[newRangeLineIndex];
      if (!newRangeLine || !NEW_RANGE_RE.test(newRangeLine)) {
        throw new Error(`Invalid new hunk header near line ${newRangeLineIndex + 1}.`);
      }

      const oldRange = parseRange(oldRangeLine, OLD_RANGE_RE);
      const newRange = parseRange(newRangeLine, NEW_RANGE_RE);
      const oldSection = lines.slice(index + 2, newRangeLineIndex);
      const newSectionEnd = findNextBoundary(lines, newRangeLineIndex + 1);
      const newSection = lines.slice(newRangeLineIndex + 1, newSectionEnd);
      const rows = alignSections(oldSection, newSection, oldRange.start, newRange.start);

      hunks.push({
        id: `file-${fileCounter}-hunk-${hunkCounter}`,
        oldRange,
        newRange,
        rows,
      });

      hunkCounter += 1;
      index = newSectionEnd;
    }

    if (hunks.length > 0) {
      files.push({
        id: `file-${fileCounter}`,
        displayName: deriveDisplayName(oldLabel, newLabel),
        oldLabel,
        newLabel,
        hunks,
        summary: summarizeFile(hunks),
      });
      fileCounter += 1;
    }
  }

  return {
    files,
    summary: summarizeAll(files),
  };
}

export function getWordDiffTokens(oldText: string, newText: string): {
  oldTokens: DiffToken[];
  newTokens: DiffToken[];
} {
  const cacheKey = `${oldText}\u0000${newText}`;
  const cached = wordDiffCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = diffWordTokens(oldText, newText);

  if (wordDiffCache.size > 6000) {
    wordDiffCache.clear();
  }

  wordDiffCache.set(cacheKey, result);
  return result;
}

export function buildColumnText(file: FileDiff, side: "old" | "new"): string {
  const chunks = file.hunks
    .map((hunk) =>
      hunk.rows
        .map((row) => {
          if (side === "old") {
            return row.oldLineNumber === null ? null : row.oldText;
          }

          return row.newLineNumber === null ? null : row.newText;
        })
        .filter((line): line is string => line !== null)
        .join("\n"),
    )
    .filter((section) => section.length > 0);

  return chunks.join("\n\n");
}

export function formatRange(range: RangeInfo): string {
  if (range.start === range.end) {
    return `${range.start}`;
  }

  return `${range.start},${range.end}`;
}

function findNewRangeLine(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (NEW_RANGE_RE.test(lines[index])) {
      return index;
    }

    if (lines[index] === HUNK_DIVIDER) {
      return -1;
    }
  }

  return -1;
}

function findNextBoundary(lines: string[], startIndex: number): number {
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const next = lines[index + 1];

    if (line === HUNK_DIVIDER) {
      return index;
    }

    if (line.startsWith("*** ") && !OLD_RANGE_RE.test(line) && next?.startsWith("--- ") && !NEW_RANGE_RE.test(next)) {
      return index;
    }

    index += 1;
  }

  return lines.length;
}

function parseRange(line: string, matcher: RegExp): RangeInfo {
  const match = line.match(matcher);
  if (!match) {
    throw new Error(`Could not parse range: ${line}`);
  }

  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);

  return { start, end };
}

function alignSections(
  oldSection: string[],
  newSection: string[],
  oldStart: number,
  newStart: number,
): DiffRow[] {
  const oldLines = buildLogicalSection(oldSection, oldStart, "old");
  const newLines = buildLogicalSection(newSection, newStart, "new");
  const operations = diffLineSequences(oldLines, newLines);
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < operations.length) {
    const operation = operations[index];

    if (operation.kind === "equal") {
      rows.push({
        kind: "context",
        oldLineNumber: operation.oldLine.lineNumber,
        newLineNumber: operation.newLine.lineNumber,
        oldText: operation.oldLine.text,
        newText: operation.newLine.text,
      });
      index += 1;
      continue;
    }

    const deletes: SectionLine[] = [];
    const adds: SectionLine[] = [];

    while (index < operations.length && operations[index].kind !== "equal") {
      const current = operations[index];
      if (current.kind === "delete") {
        deletes.push(current.oldLine);
      }
      if (current.kind === "add") {
        adds.push(current.newLine);
      }
      index += 1;
    }

    const pairCount = Math.min(deletes.length, adds.length);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const oldLine = deletes[pairIndex];
      const newLine = adds[pairIndex];

      rows.push({
        kind: "modify",
        oldLineNumber: oldLine.lineNumber,
        newLineNumber: newLine.lineNumber,
        oldText: oldLine.text,
        newText: newLine.text,
      });
    }

    for (let deleteIndex = pairCount; deleteIndex < deletes.length; deleteIndex += 1) {
      const oldLine = deletes[deleteIndex];
      rows.push({
        kind: "delete",
        oldLineNumber: oldLine.lineNumber,
        newLineNumber: null,
        oldText: oldLine.text,
        newText: "",
      });
    }

    for (let addIndex = pairCount; addIndex < adds.length; addIndex += 1) {
      const newLine = adds[addIndex];
      rows.push({
        kind: "add",
        oldLineNumber: null,
        newLineNumber: newLine.lineNumber,
        oldText: "",
        newText: newLine.text,
      });
    }
  }

  return rows;
}

function buildLogicalSection(
  section: string[],
  startLine: number,
  side: "old" | "new",
): SectionLine[] {
  const result: SectionLine[] = [];
  let lineNumber = startLine;

  for (const rawLine of section) {
    if (!rawLine.length) {
      continue;
    }

    if (rawLine.startsWith("\\ ")) {
      continue;
    }

    const marker = rawLine[0] as " " | "!" | "+" | "-";
    const text = rawLine.length > 1 && rawLine[1] === " " ? rawLine.slice(2) : rawLine.slice(1);

    if (side === "old" && (marker === " " || marker === "!" || marker === "-")) {
      result.push({
        text,
        lineNumber: lineNumber > 0 ? lineNumber : null,
      });
      lineNumber += 1;
    }

    if (side === "new" && (marker === " " || marker === "!" || marker === "+")) {
      result.push({
        text,
        lineNumber: lineNumber > 0 ? lineNumber : null,
      });
      lineNumber += 1;
    }
  }

  return result;
}

type EqualOperation = {
  kind: "equal";
  oldLine: SectionLine;
  newLine: SectionLine;
};

type DeleteOperation = {
  kind: "delete";
  oldLine: SectionLine;
};

type AddOperation = {
  kind: "add";
  newLine: SectionLine;
};

type DiffOperation = EqualOperation | DeleteOperation | AddOperation;

function diffLineSequences(oldLines: SectionLine[], newLines: SectionLine[]): DiffOperation[] {
  const table = buildLcsTable(
    oldLines.map((line) => line.text),
    newLines.map((line) => line.text),
  );
  const operations: DiffOperation[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex].text === newLines[newIndex].text) {
      operations.push({
        kind: "equal",
        oldLine: oldLines[oldIndex],
        newLine: newLines[newIndex],
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      operations.push({
        kind: "delete",
        oldLine: oldLines[oldIndex],
      });
      oldIndex += 1;
      continue;
    }

    operations.push({
      kind: "add",
      newLine: newLines[newIndex],
    });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    operations.push({
      kind: "delete",
      oldLine: oldLines[oldIndex],
    });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    operations.push({
      kind: "add",
      newLine: newLines[newIndex],
    });
    newIndex += 1;
  }

  return operations;
}

function diffWordTokens(oldText: string, newText: string): {
  oldTokens: DiffToken[];
  newTokens: DiffToken[];
} {
  const oldTokens = tokenizeWords(oldText);
  const newTokens = tokenizeWords(newText);
  const table = buildLcsTable(oldTokens, newTokens);
  const oldResult: DiffToken[] = [];
  const newResult: DiffToken[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldTokens.length && newIndex < newTokens.length) {
    if (oldTokens[oldIndex] === newTokens[newIndex]) {
      oldResult.push({ text: oldTokens[oldIndex], kind: "unchanged" });
      newResult.push({ text: newTokens[newIndex], kind: "unchanged" });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      oldResult.push({ text: oldTokens[oldIndex], kind: "removed" });
      oldIndex += 1;
      continue;
    }

    newResult.push({ text: newTokens[newIndex], kind: "added" });
    newIndex += 1;
  }

  while (oldIndex < oldTokens.length) {
    oldResult.push({ text: oldTokens[oldIndex], kind: "removed" });
    oldIndex += 1;
  }

  while (newIndex < newTokens.length) {
    newResult.push({ text: newTokens[newIndex], kind: "added" });
    newIndex += 1;
  }

  return { oldTokens: oldResult, newTokens: newResult };
}

function tokenizeWords(text: string): string[] {
  const matches = text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g);
  return matches ?? [text];
}

function buildLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () =>
    Array.from<number>({ length: right.length + 1 }).fill(0),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (left[leftIndex] === right[rightIndex]) {
        table[leftIndex][rightIndex] = table[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        table[leftIndex][rightIndex] = Math.max(
          table[leftIndex + 1][rightIndex],
          table[leftIndex][rightIndex + 1],
        );
      }
    }
  }

  return table;
}

function summarizeFile(hunks: HunkDiff[]): FileSummary {
  const summary: FileSummary = {
    added: 0,
    deleted: 0,
    modified: 0,
    context: 0,
    rows: 0,
    maxHunkRows: 0,
  };

  for (const hunk of hunks) {
    summary.rows += hunk.rows.length;
    summary.maxHunkRows = Math.max(summary.maxHunkRows, hunk.rows.length);

    for (const row of hunk.rows) {
      if (row.kind === "add") {
        summary.added += 1;
      }
      if (row.kind === "delete") {
        summary.deleted += 1;
      }
      if (row.kind === "modify") {
        summary.modified += 1;
      }
      if (row.kind === "context") {
        summary.context += 1;
      }
    }
  }

  return summary;
}

function summarizeAll(files: FileDiff[]): DiffSummary {
  const summary: DiffSummary = {
    files: files.length,
    hunks: 0,
    added: 0,
    deleted: 0,
    modified: 0,
    context: 0,
    rows: 0,
    maxHunkRows: 0,
  };

  for (const file of files) {
    summary.hunks += file.hunks.length;
    summary.added += file.summary.added;
    summary.deleted += file.summary.deleted;
    summary.modified += file.summary.modified;
    summary.context += file.summary.context;
    summary.rows += file.summary.rows;
    summary.maxHunkRows = Math.max(summary.maxHunkRows, file.summary.maxHunkRows);
  }

  return summary;
}

function deriveDisplayName(oldLabel: string, newLabel: string): string {
  const oldName = stripMetadata(oldLabel);
  const newName = stripMetadata(newLabel);

  if (newName && newName !== "/dev/null") {
    return newName;
  }

  if (oldName) {
    return oldName;
  }

  return newLabel || oldLabel || "Unnamed file";
}

function stripMetadata(label: string): string {
  return label.split("\t")[0]?.trim() ?? label.trim();
}
