# Batch 1 + Batch 2 Unique Audit Notes

Date: 2026-04-03

Scope:
- Compared the exact-filename outlines that appear in `sample_outlines/batch1` and `sample_outlines/batch2` but do not appear in `batch3`, `batch4`, `batch5_cs`, or `course_based_outlines`
- Re-ran the tightened missed-date check and tightened office-hours check on that unique set
- Verified the remaining parser misses directly against the source HTML
- Regenerated `sample_outlines/batch1-batch2-unique-date-comparison.json`

## Confirmed parser misses fixed

### `Advanced Finite Element Methods` dropped one office-hours day
- Source outline:
  - `Office Hours: Tuesdays and Thursdays from 12:30 to 13:30`
  - location `E7-3408`
- Before the fix:
  - only one office-hours day survived the normalization pipeline
- Root cause:
  - office-hours cleanup could misread the leading `Tuesdays and` text as a person-name fragment and trim away the first weekday before the recurring event was created
- Fix:
  - office-hours leading-name stripping now refuses to treat weekday text or `and`-joined weekday phrases as instructor names
- Result:
  - `Winter 2026_ Advanced Finite Element Methods.html` now produces:
    - Tuesday `12:30-13:30`
    - Thursday `12:30-13:30`
    - location `E7-3408`

### `Foundations of Entrepreneurial Practice` lost the second day of each term-test window
- Source outline:
  - `Term Test #1: Thursday, March 5, 2026 at 6:00 PM to Friday, March 6, 2026 at 6:00 PM`
  - `Term Test #2: Wednesday, April 1 at 6:00 PM to Thursday, April 2 at 6:00 PM`
- Before the fix:
  - only `2026-03-05` and `2026-04-01` were retained
- Root cause:
  - split assessment-table entries like `#1` / `#2` were not recognized as availability windows because the window check only looked for words like `term test` inside the split prefix
  - the per-entry assessment path also needed to preserve `endDate` consistently once a window was found
- Fix:
  - assessment-table entry resolution now preserves per-entry `endDate`
  - repeated split entries now evaluate availability-window keywords using both the split prefix and the row label context
  - the split entry date-resolution path was tightened so explicit two-date windows survive even when the generic parser tries to collapse them
- Result:
  - `Winter 2026_ Foundations of Entrepreneurial Practice.html` now produces:
    - `BET 100 Midterm #1` due `2026-03-06`
      - note: `Available from 2026-03-05`
    - `BET 100 Midterm #2` due `2026-04-02`
      - note: `Available from 2026-04-01`

## Comparison checker cleanup

### `Calculus 2 for Honours Mathematics` false-positive exception dates removed
- Source outline:
  - weekly Mobius assignment prose includes a Week 1 exception window
- Before the fix:
  - the focused source-vs-parser comparison still flagged the exception dates as if they were missed standalone assignment dates
- Root cause:
  - the ancillary-line filter for the `Week n ... Week n+1 (exception: ...)` Mobius pattern was too strict and failed to match this exact sentence shape
- Fix:
  - corrected the ancillary-line matcher so weekly Mobius exception prose no longer counts as a missed explicit assignment date
- Result:
  - the focused comparison no longer flags `Spring 2025_ Calculus 2 for Honours Mathematics.html`

## Remaining `reviewNeeded` items

None in the regenerated unique comparison.

## Validation

Commands rerun after the fixes:

```bash
./node_modules/esbuild/bin/esbuild src/app/lib/parser.ts --bundle --platform=node --format=cjs --outfile=tmp-parser-bundle.cjs
node scripts/run-unique-batch12-date-comparison.cjs
npm run build
```

Status:
- `sample_outlines/batch1-batch2-unique-date-comparison.json` regenerated successfully
- the regenerated focused comparison now reports `61` outlines checked and `0` flagged files
- `npm run build` passes
