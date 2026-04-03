# KIN Courses Audit Notes

Date: 2026-04-02

Scope:
- Ran the parser across all outlines in `sample_outlines/course_based_outlines/kin_courses`
- Compared suspicious output and office-hours coverage directly against the source HTML outlines
- Fixed confirmed parser misses in `src/app/lib/parser.ts`
- Regenerated `sample_outlines/course_based_outlines/kin_courses-audit.json`

## Confirmed parser misses fixed

### `Clinical Exercise Physiology` left a numbering gap in term tests
- Source outline:
  - `Term Test 1: October 21`
  - `Term Test 2: December 2`
- Before the fix:
  - the parser produced `Midterm #1` and `Midterm #3`
- Root cause:
  - late-stage label normalization could preserve an earlier numbering gap after the table rows had already been merged down to the two real dated tests
- Fix:
  - added a final midterm relabel pass after assessment normalization so dated midterm/test events in the same course are always renumbered sequentially by date
- Result:
  - `Fall 2025_ Clinical Exercise Physiology.html` now produces:
    - `Midterm #1` on `2025-10-21`
    - `Midterm #2` on `2025-12-02`

### `Micronutrient Metabolism` preferred `Online` over the real office location
- Source outline:
  - office-hours text included both an online reference and a physical room
  - real room: `BMH 1101`
- Before the fix:
  - the office-hours event location could be reduced to `Online`
- Root cause:
  - office-hours location resolution was still too willing to keep a generic online location when the same snippet also contained a real office room
- Fix:
  - office-hours location selection now prefers a real physical room over `Online` when both describe the same slot
- Result:
  - `Fall 2025_ Micronutrient Metabolism.html` now produces:
    - `Office Hours with Dr. Robin E. Duncan`
    - Tuesday `10:00-11:00`
    - location `BMH 1101`

### `Low Back Disorders` missed instructor office hours entirely
- Source outline:
  - `Instructor's Office Hours`
  - `Fridays 2:30-3:30 in BMH 3036A`
- Before the fix:
  - no office-hours event was created
- Root cause:
  - the standard office-hours paths were losing the explicit instructional-team office-hours block when the source mixed heading text, descriptive prose, and the actual day/time line inside the same HTML block
- Fix:
  - added a last-resort instructional-team office-hours recovery path that reads explicit `Instructor's Office Hours` HTML blocks directly and converts concrete weekday/time lines into office-hours events when the normal pipeline produced none
- Result:
  - `Winter 2026_ Low Back Disorders.html` now produces:
    - `Office Hours with Tyson Beach`
    - Friday `14:30-15:30`
    - location `BMH 3036A`

## Office-hours cases reviewed and left unchanged

These were checked manually and are acceptable as non-events because the outline does not provide a concrete recurring office-hours slot in the HTML:

- appointment-only office-hours references
- generic support/contact sections without a dated weekly slot
- rows that direct students to LEARN or another booking system for office-hours details

## Remaining `reviewNeeded` items

None in the regenerated `kin_courses` audit.

## Validation

Commands rerun after the fixes:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/kin_courses
npm run build
```

Status:
- `sample_outlines/course_based_outlines/kin_courses-audit.json` regenerated successfully
- office-hours coverage was rechecked manually for the confirmed misses above
- the regenerated kin audit no longer shows the known office-hours / term-test issues from the earlier pass
