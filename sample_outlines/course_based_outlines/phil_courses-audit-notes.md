# PHIL Courses Audit Notes

Date: 2026-04-02

Scope:
- Reran the parser across all outlines in `sample_outlines/course_based_outlines/phil_courses`
- Rechecked the generated audit with the tighter office-hours and missed-date lens used on the later batch passes
- Regenerated `sample_outlines/course_based_outlines/phil_courses-audit.json`

## Result

No confirmed parser misses were surfaced in this rerun.

The regenerated audit contains:
- `3` outlines audited
- `0` flagged / `reviewNeeded` outlines

## Notes

- This pass did not surface any new real office-hours misses.
- A true source-vs-parser comparison on the remaining course-based folders surfaced one real PHIL miss:
  - `Winter 2026_ Special Topics.html`
    - the `request an alternative to Turnitin` deadline lived in a policy-style section that the regular prose pass was not scanning
    - the policy-noise filter was also swallowing the explicit request-by date
    - fixed by allowing explicit Turnitin-alternative request deadlines through and capturing:
      - `Turnitin Alternative Request` on `2026-01-23`
- The focused comparison also excluded two comparison-only false positives from counting as misses:
  - grading-rubric fraction lines like `Background (3/14)` that are marks, not dates
  - grade-release / interim-grade prose that is not a calendar action item
- After the focused comparison rerun, the remaining PHIL folder contributed `0` unmatched source-date lines.

## Validation

Command rerun:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/phil_courses
```

Status:
- `sample_outlines/course_based_outlines/phil_courses-audit.json` regenerated successfully
