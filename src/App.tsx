import { startTransition, useEffect, useId, useRef, useState } from "react";
import {
  formatRange,
  getWordDiffTokens,
  stripLabelMetadata,
  type DiffRow,
  type FileDiff,
  type HunkDiff,
  type ParsedContextDiff,
  type ViewMode,
} from "./lib/contextDiff";
import { SAMPLE_CONTEXT_DIFF } from "./lib/sampleDiff";

const LARGE_PATCH_SOURCE_THRESHOLD = 180_000;
const LARGE_PATCH_ROW_THRESHOLD = 2_200;
const LARGE_FILE_ROW_THRESHOLD = 1_200;
const LARGE_HUNK_ROW_THRESHOLD = 260;
const LAZY_HUNK_THRESHOLD = 90;
const FILE_PREVIEW_ROW_LIMIT = 1000;

type ParseState = {
  data: ParsedContextDiff | null;
  error: string | null;
  isBusy: boolean;
};

type WorkerResponse =
  | { id: number; ok: true; data: ParsedContextDiff }
  | { id: number; ok: false; error: string };

export default function App() {
  const [source, setSource] = useState(SAMPLE_CONTEXT_DIFF);
  const [viewMode, setViewMode] = useState<ViewMode>("word");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const fileInputId = useId();
  const parseState = useContextDiffParser(source);
  const parsedData = parseState.data;

  useEffect(() => {
    const available = parsedData?.files ?? [];
    if (available.length === 0) {
      if (selectedFileId !== null) setSelectedFileId(null);
      return;
    }
    if (!selectedFileId || !available.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(available[0].id);
    }
  }, [parsedData, selectedFileId]);

  const selectedFile =
    parsedData && selectedFileId
      ? parsedData.files.find((file) => file.id === selectedFileId) ?? parsedData.files[0]
      : parsedData?.files[0] ?? null;
  const performanceMode = shouldUseLargePatchMode(source, parsedData, selectedFile);
  const isShowingSample = source === SAMPLE_CONTEXT_DIFF;
  const selectedOldPath = selectedFile ? stripLabelMetadata(selectedFile.oldLabel) : "";
  const selectedNewPath = selectedFile ? stripLabelMetadata(selectedFile.newLabel) : "";
  const filePreview = selectedFile
    ? buildFilePreview(selectedFile, expandedFiles[selectedFile.id] === true)
    : null;

  return (
    <div className="app-container">
      <header className="topbar">
        <div className="topbar-brand">
          <svg className="topbar-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <span className="topbar-title">Patch Viewer</span>
        </div>
        <div className="topbar-actions">
          <div className="status-indicator">
            <span className={`status-dot ${parseState.isBusy ? 'busy' : 'ready'}`} />
            <span className="status-text">{parseState.isBusy ? 'Parsing...' : 'Ready'}</span>
          </div>
          <button
            className={`btn ${isShowingSample && !showSource ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? 'View Diff' : 'Edit Source'}
          </button>
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Changed Files</span>
            {parsedData && (
              <span className="sidebar-subtitle">
                {parsedData.summary.files} {parsedData.summary.files === 1 ? 'file' : 'files'}
              </span>
            )}
          </div>
          <div className="file-list">
            {parsedData?.files.map((file) => {
              const display = splitDisplayPath(file.displayName);
              return (
                <button
                  key={file.id}
                  className={`file-item ${selectedFile?.id === file.id ? 'active' : ''}`}
                  onClick={() => setSelectedFileId(file.id)}
                  title={file.displayName}
                >
                  <div className="file-item-header">
                    <span className="file-item-name">{display.basename}</span>
                    <div className="file-item-stats">
                      {file.summary.added > 0 && <span className="stat-add">+{file.summary.added}</span>}
                      {file.summary.deleted > 0 && <span className="stat-del">-{file.summary.deleted}</span>}
                      {file.summary.modified > 0 && <span className="stat-mod">~{file.summary.modified}</span>}
                    </div>
                  </div>
                  <div className="file-item-path">{display.dir ? display.dir + '/' : '/'}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="workspace">
          {showSource && (
            <div className="source-panel">
              <div className="source-header">
                <div className="source-heading">
                  <h2 className="source-title">Patch Source</h2>
                  <p className="source-lead">Paste a context diff or upload a .patch file.</p>
                </div>
                <div className="source-actions">
                  <label className="btn btn-secondary" htmlFor={fileInputId}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    Upload File
                  </label>
                  <input
                    id={fileInputId}
                    className="visually-hidden"
                    type="file"
                    accept=".diff,.patch,.txt"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void file.text().then((text) => startTransition(() => setSource(text)));
                      event.target.value = "";
                    }}
                  />
                  <div className="action-divider" />
                  <button className="btn btn-ghost" onClick={() => setSource("")}>Clear</button>
                  <button className="btn btn-ghost" onClick={() => setSource(SAMPLE_CONTEXT_DIFF)}>Sample</button>
                  <button className="btn btn-primary" onClick={() => setShowSource(false)}>View Diff</button>
                </div>
              </div>
              {parseState.error && (
                <div className="error-banner">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  Parse Error: {parseState.error}
                </div>
              )}
              <textarea
                className="source-textarea"
                spellCheck={false}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Paste context diff here..."
              />
            </div>
          )}

          {!showSource && isShowingSample ? (
            <div className="source-entry-banner">
              <div className="source-entry-banner__content">
                <span className="source-entry-banner__label">Demo Mode</span>
                <div className="source-entry-banner__title">Viewing bundled sample diff</div>
                <div className="source-entry-banner__body">
                  Open the source panel to paste your own context-format patch or upload a file.
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => setShowSource(true)}>
                Edit Source
              </button>
            </div>
          ) : null}

          {selectedFile ? (
            <div className="viewer-container">
              <div className="viewer-header">
                <div className="viewer-heading">
                  <h1 className="viewer-title">{selectedFile.displayName}</h1>
                  <p className="viewer-subtitle">Select text directly inside a column to copy it.</p>
                </div>
                <div className="viewer-toolbar">
                  <div className="segmented-control">
                    <button
                      className={`segmented-btn ${viewMode === 'word' ? 'active' : ''}`}
                      onClick={() => setViewMode('word')}
                    >
                      Word Diff
                    </button>
                    <button
                      className={`segmented-btn ${viewMode === 'line' ? 'active' : ''}`}
                      onClick={() => setViewMode('line')}
                    >
                      Line Diff
                    </button>
                  </div>
                </div>
              </div>

              <div className="diff-content">
                {filePreview?.isCollapsed ? (
                  <div className="file-preview-banner">
                    <div className="file-preview-banner__text">
                      <strong>Previewing {filePreview.visibleRows} rows</strong> out of {selectedFile.summary.rows}. {filePreview.hiddenRows} rows folded.
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        setExpandedFiles((current) => ({
                          ...current,
                          [selectedFile.id]: true,
                        }))
                      }
                    >
                      Expand All
                    </button>
                  </div>
                ) : selectedFile.summary.rows > FILE_PREVIEW_ROW_LIMIT ? (
                  <div className="file-preview-banner file-preview-banner--expanded">
                    <div className="file-preview-banner__text">Showing all {selectedFile.summary.rows} rows.</div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setExpandedFiles((current) => ({
                          ...current,
                          [selectedFile.id]: false,
                        }))
                      }
                    >
                      Collapse Large File
                    </button>
                  </div>
                ) : null}
                
                <div className="hunks-wrapper">
                  {filePreview?.hunks.map(({ hunk, rows, isPartial }) => (
                    <LazyHunkCard
                      key={hunk.id}
                      hunk={hunk}
                      rows={rows}
                      viewMode={viewMode}
                      performanceMode={performanceMode}
                      isPartialPreview={isPartial}
                      oldPath={selectedOldPath}
                      newPath={selectedNewPath}
                    />
                  ))}
                </div>

                {filePreview?.isCollapsed ? (
                  <div className="collapsed-tail-panel">
                    <div className="collapsed-tail-panel__content">
                      <h3 className="collapsed-tail-panel__title">Remaining rows hidden</h3>
                      <p className="collapsed-tail-panel__body">
                        Large files are previewed for performance.
                      </p>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        setExpandedFiles((current) => ({
                          ...current,
                          [selectedFile.id]: true,
                        }))
                      }
                    >
                      Load Remaining Diff
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
              </div>
              <h3 className="empty-state-title">No Valid Patch Loaded</h3>
              <p className="empty-state-text">Paste a context diff or upload a patch file to begin.</p>
              <button className="btn btn-primary" onClick={() => setShowSource(true)}>Open Source Panel</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LazyHunkCard({
  hunk,
  rows,
  viewMode,
  performanceMode,
  isPartialPreview,
  oldPath,
  newPath,
}: {
  hunk: HunkDiff;
  rows: DiffRow[];
  viewMode: ViewMode;
  performanceMode: boolean;
  isPartialPreview: boolean;
  oldPath: string;
  newPath: string;
}) {
  const totalRows = rows.length;
  const useLazyMount = performanceMode && totalRows >= LAZY_HUNK_THRESHOLD;
  const { sectionRef, isActivated } = useHunkActivation(!useLazyMount);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const renderedRows = rows;
  const placeholderHeight = `${Math.min(420, 84 + totalRows * 8)}px`;

  useEffect(() => {
    setIsCollapsed(false);
  }, [oldPath, newPath, hunk.oldRange.start, hunk.oldRange.end, hunk.newRange.start, hunk.newRange.end]);

  const handleHeaderToggle = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
      return;
    }
    setIsCollapsed((current) => !current);
  };

  return (
    <div ref={sectionRef as any} className="hunk-container" id={hunk.id}>
      {isActivated ? (
        <>
          <div
            className={`hunk-sticky-header ${isCollapsed ? "hunk-sticky-header--collapsed" : ""}`}
            role="button"
            tabIndex={0}
            aria-expanded={!isCollapsed}
            onClick={handleHeaderToggle}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleHeaderToggle();
              }
            }}
          >
            <div className="hunk-header-side hunk-header-side--old">
              <div className="hunk-header-top">
                <span className="hunk-header-badge hunk-header-badge--old">Old</span>
                <span className="hunk-header-range">{formatRange(hunk.oldRange)}</span>
              </div>
              <div className="hunk-header-path" title={oldPath}>{oldPath}</div>
            </div>

            <div className="hunk-header-side hunk-header-side--new">
              <div className="hunk-header-top">
                <div className="hunk-header-top-group">
                  <span className="hunk-header-badge hunk-header-badge--new">New</span>
                  <span className="hunk-header-range">{formatRange(hunk.newRange)}</span>
                </div>
                <span className="hunk-header-toggle" aria-hidden="true">
                  {isCollapsed ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                  )}
                </span>
              </div>
              <div className="hunk-header-path" title={newPath}>{newPath}</div>
            </div>
          </div>
          {!isCollapsed ? (
            <div className="diff-table">
              <div className="diff-grid" onCopyCapture={handleGridCopy}>
                {renderedRows.map((row, rowIndex) => (
                  <DiffCell
                    key={`${hunk.id}-old-${rowIndex}`}
                    side="old"
                    row={row}
                    rowIndex={rowIndex + 1}
                    viewMode={viewMode}
                  />
                ))}
                {renderedRows.map((row, rowIndex) => (
                  <DiffCell
                    key={`${hunk.id}-new-${rowIndex}`}
                    side="new"
                    row={row}
                    rowIndex={rowIndex + 1}
                    viewMode={viewMode}
                  />
                ))}
              </div>
              {isPartialPreview ? (
                <div className="hunk-footer hunk-footer--preview-cut">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <span>This hunk continues below the 1000-row preview limit.</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="lazy-hunk-placeholder" style={{ minHeight: placeholderHeight }}>
          <div className="loading-spinner"></div>
          Loading hunk content...
        </div>
      )}
    </div>
  );
}

function DiffCell({
  side,
  row,
  rowIndex,
  viewMode,
}: {
  side: "old" | "new";
  row: DiffRow;
  rowIndex: number;
  viewMode: ViewMode;
}) {
  const lineNumber = side === "old" ? row.oldLineNumber : row.newLineNumber;
  const fallbackText = side === "old" ? row.oldText : row.newText;
  const isBlank = lineNumber === null;
  const marker = getMarker(side, row.kind, isBlank);
  const tokenDiff = viewMode === "word" && row.kind === "modify" ? getWordDiffTokens(row.oldText, row.newText) : null;
  const tokens = side === "old" ? tokenDiff?.oldTokens ?? null : tokenDiff?.newTokens ?? null;

  let lineClass = "line-ctx";
  if (isBlank) lineClass = "line-empty";
  else if (row.kind === "add") lineClass = side === "new" ? "line-add" : "line-ctx";
  else if (row.kind === "delete") lineClass = side === "old" ? "line-del" : "line-ctx";
  else if (row.kind === "modify") lineClass = side === "old" ? "line-mod-old" : "line-mod-new";

  return (
    <div
      className={`diff-line ${lineClass} diff-line--${side}`}
      data-side={side}
      data-blank={isBlank ? "true" : "false"}
      style={{
        gridColumn: side === "old" ? "1" : "2",
        gridRow: `${rowIndex}`,
      }}
    >
      <div className="line-num" aria-hidden="true">{lineNumber ?? ""}</div>
      <div className="line-marker" aria-hidden="true">{marker}</div>
      <div className="line-content">
        {isBlank ? (
          " "
        ) : viewMode === "word" && row.kind === "modify" && tokens ? (
          tokens.map((token, index) => (
            <span key={index} className={token.kind === 'added' ? 'token-add' : token.kind === 'removed' ? 'token-del' : ''}>
              {token.text}
            </span>
          ))
        ) : (
          fallbackText
        )}
      </div>
    </div>
  );
}

function getMarker(side: "old" | "new", kind: DiffRow["kind"], isBlank: boolean): string {
  if (isBlank || kind === "context") return " ";
  if (kind === "modify") return "!";
  if (kind === "delete") return side === "old" ? "-" : " ";
  if (kind === "add") return side === "new" ? "+" : " ";
  return " ";
}

function handleGridCopy(event: React.ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);
  const grid = event.currentTarget;
  const startLine = closestDiffLine(range.startContainer, grid);
  const endLine = closestDiffLine(range.endContainer, grid);

  if (!startLine || !endLine) {
    return;
  }

  const selectedSide = startLine.dataset.side;
  if (!selectedSide || endLine.dataset.side !== selectedSide) {
    return;
  }

  const lines = Array.from(
    grid.querySelectorAll<HTMLElement>(`.diff-line--${selectedSide}`),
  );
  const textLines = lines.flatMap((line) => {
    if (!range.intersectsNode(line)) {
      return [];
    }

    if (line.dataset.blank === "true") {
      return [];
    }

    const content = line.querySelector<HTMLElement>(".line-content");
    if (!content) {
      return [];
    }

    const selectedText = extractSelectedTextFromLine(range, line, content);
    return [selectedText];
  });

  const hasVisibleText = textLines.some((line) => line.length > 0);
  if (textLines.length === 0 || !hasVisibleText) {
    return;
  }

  event.preventDefault();
  event.clipboardData.setData("text/plain", textLines.join("\n"));
}

function closestDiffLine(node: Node, grid: HTMLElement): HTMLElement | null {
  let current: Node | null = node;

  while (current) {
    if (
      current instanceof HTMLElement &&
      current.classList.contains("diff-line") &&
      grid.contains(current)
    ) {
      return current;
    }

    current = current.parentNode;
  }

  return null;
}

function extractSelectedTextFromLine(
  sourceRange: Range,
  line: HTMLElement,
  content: HTMLElement,
): string {
  const startsInLine = line.contains(sourceRange.startContainer);
  const endsInLine = line.contains(sourceRange.endContainer);

  if (startsInLine && endsInLine) {
    return sourceRange.toString();
  }

  const clippedRange = document.createRange();

  if (startsInLine) {
    clippedRange.setStart(sourceRange.startContainer, sourceRange.startOffset);
    clippedRange.setEnd(content, content.childNodes.length);
    return clippedRange.toString();
  }

  if (endsInLine) {
    clippedRange.setStart(content, 0);
    clippedRange.setEnd(sourceRange.endContainer, sourceRange.endOffset);
    return clippedRange.toString();
  }

  return content.textContent ?? "";
}

function buildFilePreview(file: FileDiff, isExpanded: boolean): {
  hunks: Array<{
    hunk: HunkDiff;
    rows: DiffRow[];
    isPartial: boolean;
  }>;
  visibleRows: number;
  hiddenRows: number;
  isCollapsed: boolean;
} {
  if (isExpanded || file.summary.rows <= FILE_PREVIEW_ROW_LIMIT) {
    return {
      hunks: file.hunks.map((hunk) => ({
        hunk,
        rows: hunk.rows,
        isPartial: false,
      })),
      visibleRows: file.summary.rows,
      hiddenRows: 0,
      isCollapsed: false,
    };
  }

  let remaining = FILE_PREVIEW_ROW_LIMIT;
  const hunks: Array<{
    hunk: HunkDiff;
    rows: DiffRow[];
    isPartial: boolean;
  }> = [];

  for (const hunk of file.hunks) {
    if (remaining <= 0) {
      break;
    }

    const take = Math.min(remaining, hunk.rows.length);
    hunks.push({
      hunk,
      rows: hunk.rows.slice(0, take),
      isPartial: take < hunk.rows.length,
    });
    remaining -= take;
  }

  const visibleRows = FILE_PREVIEW_ROW_LIMIT - remaining;

  return {
    hunks,
    visibleRows,
    hiddenRows: Math.max(0, file.summary.rows - visibleRows),
    isCollapsed: visibleRows < file.summary.rows,
  };
}

function useContextDiffParser(source: string): ParseState {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [workerReady, setWorkerReady] = useState(false);
  const [state, setState] = useState<ParseState>({ data: null, error: null, isBusy: true });

  useEffect(() => {
    const worker = new Worker(new URL("./workers/contextDiffWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setWorkerReady(true);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== requestIdRef.current) return;
      startTransition(() => {
        if (message.ok) {
          setState({ data: message.data, error: null, isBusy: false });
        } else {
          setState((prev) => ({ data: prev.data, error: message.error, isBusy: false }));
        }
      });
    };
    return () => {
      setWorkerReady(false);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerReady || !workerRef.current) return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setState((prev) => ({ ...prev, error: null, isBusy: true }));
    const timeout = window.setTimeout(
      () => workerRef.current?.postMessage({ id: requestId, source }),
      source.length > LARGE_PATCH_SOURCE_THRESHOLD ? 180 : 90,
    );
    return () => window.clearTimeout(timeout);
  }, [source, workerReady]);

  return state;
}

function useHunkActivation(alwaysActive: boolean) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isActivated, setIsActivated] = useState(alwaysActive);
  useEffect(() => {
    if (alwaysActive) { setIsActivated(true); return; }
    setIsActivated(false);
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsActivated(true);
          observer.disconnect();
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [alwaysActive]);
  return { sectionRef, isActivated };
}

function shouldUseLargePatchMode(source: string, data: ParsedContextDiff | null, selectedFile: FileDiff | null): boolean {
  if (source.length > LARGE_PATCH_SOURCE_THRESHOLD) return true;
  if (!data) return false;
  if (data.summary.rows > LARGE_PATCH_ROW_THRESHOLD || data.summary.maxHunkRows > LARGE_HUNK_ROW_THRESHOLD * 2) return true;
  if (selectedFile && selectedFile.summary.rows > LARGE_FILE_ROW_THRESHOLD) return true;
  return false;
}

function splitDisplayPath(path: string): { basename: string; extension: string; dir: string } {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const basename = parts.pop() ?? normalized;
  const dotIndex = basename.lastIndexOf(".");
  return {
    basename: dotIndex > 0 ? basename.slice(0, dotIndex) : basename,
    extension: dotIndex > 0 ? basename.slice(dotIndex) : "",
    dir: parts.join("/"),
  };
}
