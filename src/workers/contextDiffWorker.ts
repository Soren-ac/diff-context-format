import { parseContextDiff } from "../lib/contextDiff";

type ParseRequest = {
  id: number;
  source: string;
};

type ParseResponse =
  | {
      id: number;
      ok: true;
      data: ReturnType<typeof parseContextDiff>;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, source } = event.data;

  try {
    const data = parseContextDiff(source);
    const message: ParseResponse = {
      id,
      ok: true,
      data,
    };
    self.postMessage(message);
  } catch (error) {
    const message: ParseResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown parsing error.",
    };
    self.postMessage(message);
  }
};

export {};
