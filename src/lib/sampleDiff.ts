export const SAMPLE_CONTEXT_DIFF = `*** docs/context-diff.md\t2026-07-03 09:15:00
--- docs/context-diff.md\t2026-07-03 09:18:00
***************
*** 1,7 ****
  # Context Diff
  This viewer compares classic patches.
! It highlights changed lines.
  It keeps surrounding context nearby.
- Removed sentence for the old version.
  Stable line at the end.
--- 1,8 ----
  # Context Diff
  This viewer compares classic patches.
! It highlights changed words inline.
  It keeps surrounding context nearby.
+ Added note for reviewers.
  Stable line at the end.
+ Footer note for deployment.
***************
*** 11,14 ****
  ## Notes
- Use unified diff when compact output matters.
! Context diff is old but still useful.
--- 12,16 ----
  ## Notes
+ Use context diff when legacy tooling expects it.
! Context diff is old, but it is still useful for audits.

*** src/parser.js\t2026-07-03 09:20:00
--- src/parser.js\t2026-07-03 09:23:00
***************
*** 20,26 ****
    return files.map((file) => ({
      name: file.name,
!     changed: file.changed,
      hunks: file.hunks,
-     compact: true,
    }));
--- 20,27 ----
    return files.map((file) => ({
      name: file.name,
!     changed: file.changedCount,
      hunks: file.hunks,
+     format: "context",
      compact: true,
    }));
`;
