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

  it("supports deletion-only hunks when the new side omits repeated context lines", () => {
    const input = `*** docs/context-diff.md\t2026-07-03 09:15:00
--- docs/context-diff.md\t2026-07-03 09:18:00
***************
*** 1,7 ****
  # Context Diff
  This viewer compares classic patches.
- INFO: number
-
  It keeps surrounding context nearby.
  Removed sentence for the old version.
  Stable line at the end.
--- 1,8 ----
`;

    const result = parseContextDiff(input);
    const file = result.files[0];

    expect(file.summary.deleted).toBe(2);
    expect(file.summary.context).toBe(5);
    expect(file.summary.added).toBe(0);
    expect(file.summary.modified).toBe(0);
    expect(file.hunks[0]?.newRange).toEqual({ start: 1, end: 5 });
    expect(buildColumnText(file, "new")).toContain("This viewer compares classic patches.");
    expect(buildColumnText(file, "new")).not.toContain("INFO: number");
  });
});
