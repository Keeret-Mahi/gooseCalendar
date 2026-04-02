# Batch 2 Audit Notes

Date: 2026-03-26

Scope:
- Ran the parser across all outlines in `sample_outlines/batch2`
- Compared suspicious audit output directly against the source HTML outlines
- Fixed confirmed parser misses in `src/app/lib/parser.ts`
- Regenerated `sample_outlines/batch2-audit.json`

## Confirmed parser misses fixed

### AFM 244 explicit quiz dates were classified as assignments
- Source contains concrete dated quiz rows in the `Assessments & Activities` table.
- Before the fix, the parser emitted:
  - `Weekly Quizzes` as an unresolved assessment summary
  - `Quizzes #1-9 @ In class` as an `Assignment`
- Root cause:
  - quiz/test/exam rows could drift back into the assignment family later in the normalization/compaction pipeline
- Fix:
  - added a normalization pass that reclassifies strong assessment cues (`quiz`, `midterm`, `term test`, `test`, `exam`, `knowledge check`) back to `Assessment` before compaction
- Result:
  - `Quizzes #1-9` now stays in `Assessments`
  - the unresolved `Weekly Quizzes` summary is shadowed and dropped

### AFM 382 quiz series were classified as assignments
- Source contains explicit dated `Quiz #1` through `Quiz #12` entries in the `Tentative Class Plan` table.
- Before the fix, the audit showed mixed assignment output such as:
  - `Quiz #11`
  - `Quiz #12`
  - `Weekly Quizzes #1-2`
  - `Weekly Quizzes #3-4`
  - `Quizzes #5-7`
  - `Weekly Quizzes #8-10`
- Root cause:
  - same misclassification path as AFM 244
- Fix:
  - same assessment-family normalization pass
- Result:
  - quiz rows now stay in `Assessments`
  - the dated quiz rows serialize correctly as assessment events

### BET 430 malformed `Term Term` label
- Source row is literally `Term Term | Mar 23rd | In-person | 5%`
- Before the fix, the parser emitted `Term Term`
- Root cause:
  - duplicate consecutive words in assessment labels were not being normalized
- Fix:
  - added duplicate-word cleanup to `normalizeAssessmentLabel`
- Result:
  - the label is now normalized to `Term`

### AFM 206 unnumbered quiz series collapsed to `Quizzes #0-0`
- Source uses unlabeled weekly quiz lines like `Wk0 Quiz due Sunday, Sept 7th ...`
- Before the fix, the recurring assessment compactor produced `Quizzes #0-0`
- Root cause:
  - missing quiz numbers were being converted from `""` to numeric `0`
- Fix:
  - changed recurring assessment numbering extraction to ignore missing numbers instead of coercing them to zero
- Result:
  - the series now compacts as `Quizzes #1-3`

## Remaining `reviewNeeded` items that are source-limited

These are still unresolved in batch 2, but they are acceptable because the outline itself does not provide concrete dates:

- `AFM 346 Quizzes`
  - source says quizzes happen starting in week 2 / every lecture, but does not provide dated quiz rows
- `AFM 291 LEARN Quizzes`
  - source says `Weekly (best 8 of 11)` without explicit quiz dates
- `AFM 132 Midterm Exam`
  - source says `See Course Schedule in LEARN`
- `AFM 132 Quizzes (10 Quizzes X 2% Each)`
  - source gives count/weight but not explicit dates
- `AFM 241 Weekly Quizzes`
  - source says quizzes run during a Friday LEARN window rather than listing concrete quiz dates
- `AFM 433 Midterm`
  - source says scheduled date is on QUEST / LEARN, not in the outline
- `AFM 433 Module Quizzes (Top 6 of 9 Will Count)`
  - source does not list concrete quiz dates in the outline
- `AFM 191 Quizzes`
  - source says `Weekly (best 8 of 11)` without explicit quiz dates
- `BET 430 Weekly Quizzes ( Top 7 of 9 Count)`
  - source says `Weekly` only, no concrete quiz dates

## Validation

Commands rerun after the fixes:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts batch2
npm run build
```

Status:
- `sample_outlines/batch2-audit.json` regenerated successfully
- production build passes

