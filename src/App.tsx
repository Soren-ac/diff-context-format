import { startTransition, useEffect, useId, useRef, useState } from "react";
import {
  buildColumnText,
  formatRange,
  getWordDiffTokens,
  type DiffRow,
  type DiffToken,
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
const HUNK_BATCH_SIZE = 200;

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
  const [showSource, setShowSource] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const fileInputId = useId();
  const parseState = useContextDiffParser(source);
  const parsedData = parseState.data;

  useEffect(() => {
    if (!copyMessage) return;
    const timeout = window.setTimeout(() => setCopyMessage(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyMessage]);

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

  async function handleCopyColumn(side: "old" | "new") {
    if (!selectedFile) {
      setCopyMessage("No file selected");
      return;
    }
    const text = buildColumnText(selectedFile, side);
    if (!text) {
      setCopyMessage(`No ${side} column content to copy`);
      return;
    }
    try {
      await copyText(text);
      setCopyMessage(`Copied ${side} column`);
    } catch {
      setCopyMessage("Clipboard copy failed");
    }
  }

  return (
    <div className="app-container">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-title">Context Diff</span>
        </div>
        <div className="topbar-actions">
          <div className="status-indicator">
            <span className={`status-dot ${parseState.isBusy ? 'busy' : 'ready'}`} />
            {parseState.isBusy ? 'Parsing...' : 'Ready'}
          </div>
          <button className="btn btn-secondary" onClick={() => setShowSource(true)}>
            Edit Source
          </button>
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Files</span>
            {parsedData && (
              <span className="text-secondary" style={{ fontSize: '0.8rem' }}>
                {parsedData.summary.files} changed
              </span>
            )}
          </div>
          <div className="file-list">
            {parsedData?.files.map((file) => (
              <button
                key={file.id}
                className={`file-item ${selectedFile?.id === file.id ? 'active' : ''}`}
                onClick={() => setSelectedFileId(file.id)}
                title={file.displayName}
              >
                <div className="file-item-name">{splitDisplayPath(file.displayName).basename}</div>
                <div className="file-item-path">{splitDisplayPath(file.displayName).dir || '/'}</div>
                <div className="file-item-stats">
                  <span className="stat-add">+{file.summary.added}</span>
                  <span className="stat-del">-{file.summary.deleted}</span>
                  <span className="stat-mod">~{file.summary.modified}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="workspace">
          {showSource && (
            <div className="source-panel">
              <div className="source-header">
                <span className="sidebar-title">Patch Source</span>
                <div className="source-actions">
                  <label className="btn btn-secondary" htmlFor={fileInputId}>
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
                  <button className="btn btn-ghost" onClick={() => setSource("")}>Clear</button>
                  <button className="btn btn-ghost" onClick={() => setSource(SAMPLE_CONTEXT_DIFF)}>Sample</button>
                  <button className="btn btn-primary" onClick={() => setShowSource(false)}>Done</button>
                </div>
              </div>
              {parseState.error && (
                <div className="error-banner">Parse Error: {parseState.error}</div>
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

          {selectedFile ? (
            <>
              <div className="viewer-header">
                <div className="viewer-title">{selectedFile.displayName}</div>
                <div className="viewer-toolbar">
                  <div className="toolbar-group">
                    <div className="segmented-control">
                      <button
                        className={`segmented-btn ${viewMode === 'word' ? 'active' : ''}`}
                        onClick={() => setViewMode('word')}
                      >
                        Word
                      </button>
                      <button
                        className={`segmented-btn ${viewMode === 'line' ? 'active' : ''}`}
                        onClick={() => setViewMode('line')}
                      >
                        Line
                      </button>
                    </div>
                  </div>
                  <div className="toolbar-group">
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCopyColumn('old')}>
                      Copy Old
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCopyColumn('new')}>
                      Copy New
                    </button>
                  </div>
                </div>
              </div>

              <div className="diff-content">
                {selectedFile.hunks.map((hunk, index) => (
                  <LazyHunkCard
                    key={hunk.id}
                    hunk={hunk}
                    index={index}
                    viewMode={viewMode}
                    performanceMode={performanceMode}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span>No valid diff loaded</span>
              <button className="btn btn-primary" onClick={() => setShowSource(true)}>Provide Source</button>
            </div>
          )}
        </main>
      </div>
      {copyMessage && <div className="toast">{copyMessage}</div>}
    </div>
  );
}

function LazyHunkCard({
  hunk,
  index,
  viewMode,
  performanceMode,
}: {
  hunk: HunkDiff;
  index: number;
  viewMode: ViewMode;
  performanceMode: boolean;
}) {
  const useLazyMount = performanceMode && hunk.rows.length >= LAZY_HUNK_THRESHOLD;
  const isLargeHunk = performanceMode && hunk.rows.length >= LARGE_HUNK_ROW_THRESHOLD;
  const { sectionRef, isActivated } = useHunkActivation(!useLazyMount);
  const [visibleRows, setVisibleRows] = useState(
    isLargeHunk ? Math.min(HUNK_BATCH_SIZE, hunk.rows.length) : hunk.rows.length,
  );

  useEffect(() => {
    setVisibleRows(isLargeHunk ? Math.min(HUNK_BATCH_SIZE, hunk.rows.length) : hunk.rows.length);
  }, [hunk.id, hunk.rows.length, isLargeHunk]);

  const renderedRows = isLargeHunk ? hunk.rows.slice(0, visibleRows) : hunk.rows;
  const placeholderHeight = `${Math.min(420, 84 + hunk.rows.length * 8)}px`;

  return (
    <div ref={sectionRef as any} className="hunk-container" id={hunk.id}>
      <div className="hunk-header">
        <span>Hunk {index + 1}</span>
        <span>{formatRange(hunk.oldRange)} → {formatRange(hunk.newRange)}</span>
      </div>

      {isActivated ? (
        <div className="diff-table">
          {renderedRows.map((row, rowIndex) => (
            <DiffRowView key={`${hunk.id}-${rowIndex}`} row={row} viewMode={viewMode} />
          ))}
          {isLargeHunk && visibleRows < hunk.rows.length && (
            <div className="hunk-footer">
              <span>Showing {visibleRows} of {hunk.rows.length} rows</span>
              <div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setVisibleRows((c) => Math.min(c + HUNK_BATCH_SIZE, hunk.rows.length))}
                >
                  Load More
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="lazy-hunk-placeholder" style={{ minHeight: placeholderHeight }}>
          Loading hunk...
        </div>
      )}
    </div>
  );
}

function DiffRowView({ row, viewMode }: { row: DiffRow; viewMode: ViewMode }) {
  const tokenDiff = viewMode === "word" && row.kind === "modify" ? getWordDiffTokens(row.oldText, row.newText) : null;
  return (
    <div className="diff-row">
      <div className="diff-half">
        <DiffLine
          side="old"
          lineNumber={row.oldLineNumber}
          rowKind={row.kind}
          tokens={tokenDiff?.oldTokens ?? null}
          fallbackText={row.oldText}
          viewMode={viewMode}
        />
      </div>
      <div className="diff-half">
        <DiffLine
          side="new"
          lineNumber={row.newLineNumber}
          rowKind={row.kind}
          tokens={tokenDiff?.newTokens ?? null}
          fallbackText={row.newText}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}

function DiffLine({
  side,
  lineNumber,
  rowKind,
  tokens,
  fallbackText,
  viewMode,
}: {
  side: "old" | "new";
  lineNumber: number | null;
  rowKind: DiffRow["kind"];
  tokens: DiffToken[] | null;
  fallbackText: string;
  viewMode: ViewMode;
}) {
  const isBlank = lineNumber === null;
  const marker = getMarker(side, rowKind, isBlank);
  
  let lineClass = "line-ctx";
  if (isBlank) lineClass = "line-empty";
  else if (rowKind === "add") lineClass = side === "new" ? "line-add" : "line-ctx";
  else if (rowKind === "delete") lineClass = side === "old" ? "line-del" : "line-ctx";
  else if (rowKind === "modify") lineClass = side === "old" ? "line-mod-old" : "line-mod-new";

  return (
    <div className={`diff-line ${lineClass}`}>
      <div className="line-num">{lineNumber ?? ""}</div>
      <div className="line-marker">{marker}</div>
      <div className="line-content">
        {isBlank ? (
          " "
        ) : viewMode === "word" && rowKind === "modify" && tokens ? (
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

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Copy failed");
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
