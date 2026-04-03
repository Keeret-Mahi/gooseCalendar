# ECON Courses Audit Notes

Date: 2026-04-02

Scope:
- Reran the parser across all outlines in `sample_outlines/course_based_outlines/econ_courses`
- Rechecked the generated audit with the tighter office-hours and missed-date lens used on the later batch passes
- Regenerated `sample_outlines/course_based_outlines/econ_courses-audit.json`

## Result

No confirmed parser misses were surfaced in this rerun.

The regenerated audit contains:
- `10` outlines audited
- `0` flagged / `reviewNeeded` outlines

## Notes

- This pass included both:
  - missed-date checking for assignments, assessments, and other explicit dated items
  - tightened office-hours expectations for concrete recurring slots
- A true source-vs-parser comparison on the remaining course-based folders surfaced one real ECON miss:
  - `Winter 2024_ Applied Macroeconometrics I.html`
    - the dated `Component | Value` rows were being missed because the table does not use a standard schedule header
    - added a document-wide dated weight-table recovery path for cases where the parser otherwise finds no dated assessments
    - this now recovers:
      - `Midterm` on `2024-03-18`
      - `Term Project` on `2024-04-10`
- After the focused comparison rerun, the remaining ECON folder contributed `0` unmatched source-date lines.

## Validation

Command rerun:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/econ_courses
```

Status:
- `sample_outlines/course_based_outlines/econ_courses-audit.json` regenerated successfully
