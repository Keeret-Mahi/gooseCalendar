# GSJ Courses Audit Notes

Date: 2026-04-02

Scope:
- Reran the parser across all outlines in `sample_outlines/course_based_outlines/gsj_courses`
- Rechecked the generated audit with the tighter office-hours and missed-date lens used on the later batch passes
- Regenerated `sample_outlines/course_based_outlines/gsj_courses-audit.json`

## Result

No confirmed parser misses were surfaced in this rerun.

The regenerated audit contains:
- `9` outlines audited
- `0` flagged / `reviewNeeded` outlines

## Notes

- This rerun did not surface any new office-hours extraction misses.
- A true source-vs-parser comparison on the remaining course-based folders surfaced one real GSJ miss:
  - `Winter 2024_ Introduction to Gender and Social Justice_ The Global South.html`
    - the final PebblePad line contained both availability and due dates in prose, but only the due-side behavior was being recovered cleanly
    - improved the prose parser so availability/due pairs create:
      - `Final Assignment Available` on `2024-04-05`
      - `Final Assignment` on `2024-04-12`
    - also corrected the label so the final PebblePad work no longer falls back to `Journal Prompts`
- After the focused comparison rerun, the remaining GSJ folder contributed `0` unmatched source-date lines.

## Validation

Command rerun:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/gsj_courses
```

Status:
- `sample_outlines/course_based_outlines/gsj_courses-audit.json` regenerated successfully
