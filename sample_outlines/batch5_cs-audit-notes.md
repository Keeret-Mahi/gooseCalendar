# Batch 5 CS Audit Notes

Date: 2026-03-27

Scope:
- Ran the parser across all outlines in `sample_outlines/batch5_cs`
- Compared suspicious output and office-hours coverage directly against the source HTML outlines
- Fixed confirmed parser misses in `src/app/lib/parser.ts`
- Regenerated `sample_outlines/batch5_cs-audit.json`

## Confirmed parser misses fixed

### `Compiler Construction` office hours were attributed to the wrong name
- Source outline:
  - `Instructor: Ondřej Lhoták, olhotak@uwaterloo.ca, DC 2520, office hours: Thursdays 11:30 -- 12:30 ...`
- Before the fix:
  - the parser produced a bad office-hours label from the role-prefixed line instead of `Ondřej Lhoták`
- Root cause:
  - the office-hours parser handled inline `Instructor: ... office hours: ...` lines too loosely and could keep only a fragment of the identity text
- Fix:
  - tightened inline office-hours name extraction for `Instructor:` / `Course Instructor:` lines and stripped role/email noise more aggressively
- Result:
  - `Winter 2026_ Compiler Construction.html` now produces `Office Hours with Ondřej Lhoták` in `DC 2520` on Thursdays `11:30-12:30`

### `Privacy, Cryptography, Network and Data Security` office hours were not attributed cleanly
- Source outline:
  - `Instructor: Florian Kerschbaum ... office hours: ...`
- Before the fix:
  - the office-hours event label was malformed rather than using the actual instructor name
- Root cause:
  - the inline role-prefixed office-hours path was not robust enough on longer identity lines
- Fix:
  - reused the stronger role-prefixed name parsing path for office-hours extraction
- Result:
  - `Winter 2026_ Privacy, Cryptography, Network and Data Security.html` now produces `Office Hours with Florian Kerschbaum`

### `Numerical Computation for Financial Modelling` office hours were parsed with a broken name
- Source outline:
  - instructor/office-hours text includes `Erik Hintz`
- Before the fix:
  - the parser produced malformed office-hours labels instead of the real instructor name
- Root cause:
  - cleanup for office-hours names did not remove all trailing metadata/junk from inline identity text
- Fix:
  - strengthened `sanitizeOfficeHourPersonName(...)` and generic-name rejection
- Result:
  - `Winter 2026_ Numerical Computation for Financial Modelling.html` now produces three correctly named office-hours events for `Erik Hintz`

### `Elementary Algorithm Design and Data Abstraction (Advanced Level)` produced generic office-hours junk
- Source outline:
  - office-hours details are present for the course staff
- Before the fix:
  - the parser could emit generic labels like `Office Hours with E-mail`
- Root cause:
  - generic office-hours names were not being rejected aggressively enough
- Fix:
  - expanded `isGenericOfficeHourName(...)` and related cleanup logic
- Result:
  - `Winter 2026_ Elementary Algorithm Design and Data Abstraction (Advanced Level).html` no longer emits generic office-hours junk labels

### `Introduction to Computer Graphics` TA office hours inherited the instructor’s office
- Source outline:
  - instructor office hours: `Fridays, in DC3520`
  - TA office hours:
    - `Matthew Avolio ..., office hours: Tuesday, 1-2PM.`
    - `Frank Fan ..., office hours: Wednesday, 1:30-2:30pm.`
  - note: `TAs’ office hours will be held in MC 3007.`
- Before the fix:
  - both TA office-hours events inherited `DC3520`
- Root cause:
  - name-only TA office-hours lines fell back to the active instructor location instead of the TA-group office location from the note below
- Fix:
  - when parsing bare-name office-hours lines in a TA context, prefer the section-level TA office-hours location before falling back to the instructor location
- Result:
  - `Winter 2026_ Introduction to Computer Graphics.html` now produces:
    - `Office Hours with Matthew Avolio @ MC 3007`
    - `Office Hours with Frank Fan @ MC 3007`

### `Introduction to Computers and Computer Systems` multi-day office hours collapsed to the wrong weekday
- Source outline:
  - `Tuesdays and Thursdays: 11:00 a.m. - 12:30 p.m.`
  - location: `MC6228`
- Before the fix:
  - the parser produced a single Monday office-hours event
- Root cause:
  - the structured office-hours table row was falling through to a looser path that distorted the weekday information
- Fix:
  - added an explicit structured-table fast path for rows with multiple weekday mentions plus one time range
  - removed nested table text from the line-based office-hours parser so table contents are not reparsed loosely
  - added a guard in office-hours deduplication so seeds that conflict with explicit weekday mentions in the source snippet are discarded
- Result:
  - `Winter 2026_ Introduction to Computers and Computer Systems.html` now produces two office-hours events for `Sandy Graham`:
    - Tuesday `11:00-12:30`
    - Thursday `11:00-12:30`
    - location `MC6228`

## Office-hours cases reviewed and left unchanged

These were checked manually and are acceptable as non-events because the outline does not provide a concrete recurring office-hours slot in the HTML:

- IA / TA group rows that only say `Posted on LEARN`
- appointment-only office-hours references without a concrete weekly time
- continuity-plan notes that say office hours move online only if in-person instruction is cancelled

## Remaining `reviewNeeded` items that are source-limited

The regenerated batch 5 audit still contains some `reviewNeeded` entries, but these are the source-limited ones we expect:

- generic quiz groups such as:
  - `Quizzes (1% Quiz a, 3% Each Quizzes B-H)`
  - `Quizzes (5 in Total)`
  - `Weekly Quizzes`
  - `Module Quizzes`
- undated midterm placeholders such as:
  - `Midterms (2)`
  - `Midterm Exam`
  - `Midterm`
- source rows where the outline gives a category or count but not a concrete event date in the HTML

## Validation

Commands rerun after the fixes:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts batch5_cs
npm run build
```

Status:
- `sample_outlines/batch5_cs-audit.json` regenerated successfully
- office-hours coverage was rechecked manually for the confirmed misses above
- batch 5 no longer shows the known office-hours labeling/location/day bugs from the earlier audit
