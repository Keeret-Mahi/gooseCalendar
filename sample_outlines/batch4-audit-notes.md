# Batch 4 Audit Notes

Date: 2026-03-27

Scope:
- Ran the parser across all outlines in `sample_outlines/batch4`
- Compared office-hours coverage and suspicious dated output directly against the source HTML outlines
- Fixed confirmed parser misses in `src/app/lib/parser.ts`
- Regenerated `sample_outlines/batch4-audit.json`

## Confirmed parser misses fixed

### `Digital Lives` incorrectly produced office hours from an appointment-only line
- Source outline:
  - `Office hours: By appointment, in-person (PAS 2215) or virtual (Teams).`
- Before the fix:
  - the parser created a false recurring office-hours event for `Dr. Kiera Obbard`
  - it inherited the lecture slot and location, which was incorrect
- Root cause:
  - once an office-hours heading was seen, the parser could still generate an office-hours seed even when the actual office-hours text only said `by appointment`
- Fix:
  - office-hours seeds are now dropped when the office-hours portion of the provenance text is appointment-only and does not contain a concrete recurring slot
- Result:
  - `Winter 2026_ Digital Lives.html` now has `Office Hours: 0`, which matches the source

### `Global Environment and Health` attributed all TA office hours to the wrong person
- Source outline:
  - TA/instructor names appear on one line
  - the concrete office-hours line appears immediately after
- Before the fix:
  - multiple office-hours rows were attributed to `Dr. Helena Shilomboleni`
- Root cause:
  - when a new office-hours block started, the parser only looked forward inside that block and could lose the identity line immediately above the office-hours details
- Fix:
  - when an office-hours block starts, the parser now carries forward a preceding identity line if it looks like a person/role/email row
- Result:
  - `Winter 2026_ Global Environment and Health.html` now produces 10 correctly attributed office-hours events, including the TA rows

### `Introduction to Geographic Information Systems (GIS)` produced a fake office-hours event from lab-schedule text
- Source outline:
  - real office hours:
    - `Office Hours: Wednesday, 12:30 to 2:00 p.m. (or by appointment)`
  - separate TA section:
    - `TA Lab Schedule & Office Hours:` followed by text saying those details are posted on LEARN
- Before the fix:
  - the parser created a bogus office-hours event labeled `Office Hours with lab schedule and`
- Root cause:
  - generic office-hours seeds could survive deduplication even when the parsed name was clearly still a placeholder/generic fragment
- Fix:
  - generic office-hours names are now rejected during dedupe rather than emitted as events
- Result:
  - `Winter 2026_ Introduction to Geographic Information Systems (GIS).html` now keeps only the real office-hours event:
    - `Office Hours with Su-Yin Tan`
    - Wednesday `12:30-14:00`
    - `EV3 3219`

## Office-hours cases reviewed and left unchanged

These were checked manually and are acceptable as non-events because the outline does not provide a concrete recurring office-hours slot in the HTML:

- `Winter 2025_ Rhetoric in Popular Culture`
  - source says `Office Hours: See Syllabus on LEARN`
- `Winter 2026_ Communications in Mathematics and Computer Science`
  - source says office-hours details are in the full syllabus on LEARN
- `Winter 2026_ Transforming Canadian Resource Management`
  - source says office hours are not formally set and should be arranged by email / drop-in
- `Winter 2026_ Introduction to Rhetorical Studies`
  - no concrete recurring office-hours schedule is given in the source HTML

## Remaining `reviewNeeded` items that are source-limited

These remain in the regenerated batch 4 audit, but they are acceptable because the outline does not provide concrete dated events for the parser to emit cleanly:

- `Winter 2026_ Climate Change Fundamentals`
  - `Quiz`
  - `Quizzes (Best 10 Out of 11)`
- `Winter 2026_ Phonetics`
  - `Module Tests (15% X 4)`

## Validation

Commands rerun after the fixes:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts batch4
npm run build
```

Status:
- `sample_outlines/batch4-audit.json` regenerated successfully
- office-hours coverage was rechecked manually across the batch
- production build passes
