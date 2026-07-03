import { describe, expect, it } from "vitest";
import { buildColumnText, formatRange, getWordDiffTokens, parseContextDiff } from "./contextDiff";
import { SAMPLE_CONTEXT_DIFF } from "./sampleDiff";

describe("parseContextDiff", () => {
  it("parses multiple files and hunks from a context diff", () => {
    const result = parseContextDiff(SAMPLE_CONTEXT_DIFF);

    expect(result.summary.files).toBe(2);
    expect(result.summary.hunks).toBe(3);
    expect(result.summary.rows).toBeGreaterThan(0);
    expect(result.files[0].displayName).toBe("docs/context-diff.md");
    expect(result.files[0].summary.modified).toBeGreaterThan(0);
  });

  it("builds one-sided column copies for a selected file", () => {
    const result = parseContextDiff(SAMPLE_CONTEXT_DIFF);
    const file = result.files[0];

    const oldColumn = buildColumnText(file, "old");
    const newColumn = buildColumnText(file, "new");

    expect(oldColumn).toContain("It highlights changed lines.");
    expect(newColumn).toContain("It highlights changed words inline.");
    expect(newColumn).toContain("Added note for reviewers.");
  });

  it("produces inline token diffs on demand for modified lines", () => {
    const tokens = getWordDiffTokens("Context diff is useful", "Context diff is still useful");

    expect(tokens.oldTokens.some((token) => token.kind === "removed")).toBe(false);
    expect(tokens.newTokens.some((token) => token.kind === "added" && token.text.includes("still"))).toBe(true);
  });

  it("formats ranges the way context diff headers do", () => {
    expect(formatRange({ start: 5, end: 5 })).toBe("5");
    expect(formatRange({ start: 8, end: 11 })).toBe("8,11");
  });
});
