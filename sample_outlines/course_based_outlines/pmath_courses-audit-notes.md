# PMATH Courses Audit Notes

Date: 2026-04-02

Scope:
- Reran the parser across all outlines in `sample_outlines/course_based_outlines/pmath_courses`
- Rechecked the generated audit with the tighter office-hours and missed-date lens used on the later batch passes
- Regenerated `sample_outlines/course_based_outlines/pmath_courses-audit.json`

## Result

No confirmed parser misses were surfaced in this rerun.

The regenerated audit contains:
- `15` outlines audited
- `0` flagged / `reviewNeeded` outlines

## Notes

- This rerun did not surface any new office-hours misses.
- No explicit dated assignment / assessment misses surfaced in the regenerated PMATH audit.

## Validation

Command rerun:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/pmath_courses
```

Status:
- `sample_outlines/course_based_outlines/pmath_courses-audit.json` regenerated successfully
