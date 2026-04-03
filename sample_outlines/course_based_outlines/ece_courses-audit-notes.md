# ECE Courses Audit Notes

Date: 2026-04-02

Scope:
- Reran the parser across all outlines in `sample_outlines/course_based_outlines/ece_courses`
- Rechecked the generated audit with the tighter office-hours and missed-date lens used on the later batch passes
- Regenerated `sample_outlines/course_based_outlines/ece_courses-audit.json`

## Result

No confirmed parser misses were surfaced in this rerun.

The regenerated audit contains:
- `31` outlines audited
- `0` flagged / `reviewNeeded` outlines

## Notes

- This pass specifically included the tighter office-hours expectations we used on the later audits:
  - concrete recurring office-hours slots should be emitted
  - appointment-only / LEARN-only office-hours references should remain non-events
- A true source-vs-parser comparison on the remaining course-based folders surfaced one real ECE miss:
  - `Winter 2026_ Digital Hardware Systems.html`
    - instructional-team office hours were only partially materializing from the inline roster block
    - fixed by letting the specialized instructional-team office-hours parser win over the generic prose fallback for the same section
    - the missing Tuesday `11:30 am - 12:30 pm` dates for Marwan Mekhemer at `E2-2356A` are now present
- After the focused comparison rerun, the remaining ECE folder contributed `0` unmatched source-date lines.

## Validation

Command rerun:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/ece_courses
```

Status:
- `sample_outlines/course_based_outlines/ece_courses-audit.json` regenerated successfully
