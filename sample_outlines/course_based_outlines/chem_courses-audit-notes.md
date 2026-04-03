# Chemistry Courses Audit Notes

Date: 2026-04-02

Scope:
- Ran the parser across all outlines in `sample_outlines/course_based_outlines/chem_courses`
- Compared office-hours coverage and obvious dated-event coverage directly against the source HTML outlines
- Tightened chemistry-specific office-hours handling in `src/app/lib/parser.ts`
- Regenerated `sample_outlines/course_based_outlines/chem_courses-audit.json`

## Confirmed parser misses fixed

### CHEM 262L / CHEM 267L mixed-room office hours were incomplete
- Source outline shape:
  - `Tue/Wed 3–5 PM in ESC-104, Thu 1–3 PM in ESC-102A and Fri 9–11 AM in ESC-104`
- Before the fix:
  - the parser was not reliably expanding that sentence into all four concrete office-hours events
- Root cause:
  - the old office-hours clustering logic handled one grouped day/time block well, but chemistry lab outlines put multiple day/time/location segments into one sentence
- Fix:
  - added richer structured office-hours segment extraction so one sentence can yield multiple day/time/location slots
- Result:
  - both lab outlines now correctly produce:
    - Tuesday `15:00-17:00` in `ESC-104`
    - Wednesday `15:00-17:00` in `ESC-104`
    - Thursday `13:00-15:00` in `ESC-102A`
    - Friday `09:00-11:00` in `ESC-104`

### Hybrid office-hours lines now prefer the physical office over generic online text
- Source outline shape:
  - chemistry office-hours lines that mention both a room and Teams/online in the same snippet
- Before the fix:
  - once a generic `Online` location got attached to a slot, dedupe kept it even when a more specific physical office was also present
- Root cause:
  - office-hours dedupe preferred the first valid location it saw, even when a later seed carried a better room value
- Fix:
  - updated office-hours dedupe to prefer a real physical location over `Online` when both describe the same day/time slot
- Result:
  - chemistry hybrid office-hours entries now keep the room when one is explicitly given

### CHEM 120 now expands both weekdays from the instructional-team office-hours line
- File:
  - `Winter 2026_ General Chemistry 1.html`
- Source outline:
  - `Office hours will be held each Tuesday and Wednesday from 4-5 PM, in a hybrid manner, in my office, C2 272, and online via TEAMS.`
- Before the fix:
  - the structured instructional-team parser recognized this as an office-hours line, but only the Wednesday slot survived into the final events
- Root cause:
  - `parseStructuredOfficeHourLines(...)` only eagerly converted direct office-hours lines when they used the older `Office hours:` style
  - lines like `Office hours will be held each Tuesday and Wednesday from...` were treated as office-hours context, but not turned into structured seeds at that stage
- Fix:
  - added a direct structured-line extraction branch for office-hours cue lines that already contain weekday/time information, even when they do not use the colon form
- Result:
  - two office-hours events:
    - Tuesday `16:00-17:00`
    - Wednesday `16:00-17:00`
  - both with location `C2 272`

## Source-limited items reviewed and left unchanged

These still appear as `reviewNeeded`, but they are acceptable because the outline itself does not provide a concrete exportable date:

- `CHEM 335L`
  - `Written Exam (Mandatory)` points to `Please see class plan`
- `CHEM 224L`
  - `Practical Lab Exam` says `Last week of class`
  - `Pre Lab Quizzes` says `Weekly; must be completed by 1:30pm day of experiment`
- `CHEM 125L`
  - `Practical Lab Exam` says `last two weeks of term`
- `CHEM 233L`
  - `Pre-Lab Quizzes` says `Wednesday weekly`
- `CHEM 370`
  - `MID-Term Exam` only provides weight, not a concrete date
- `CHEM 237L`
  - `Quizzes` says `Due before lab`
- `CHEM 340`
  - `Practice Exercise Quizzes` says `Refer to the CHEM 340 Course Schedule`
- `CHEM 383`
  - `Midterms` says `TBD`
  - `Quizzes (10)` says `each Monday during class`, which is recurrence guidance rather than explicit dated rows
- `CHEM 221`
  - `Tutorial Quizzes` only provides weight
- `CHEM 265`
  - `Term Tests` entries provide total counts/weights but no concrete dates
- `CHEM 265L`
  - `Practical Lab Exam` / `Preliminary Lab Quizzes` provide weights only
- `CHEM 262L` / `CHEM 267L`
  - `Pre-Laboratory Quizzes` provide weights only
- `CHEM 360L`
  - `Practical Lab Exam` provides weight only

## Validation

Commands rerun after the chemistry pass:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts course_based_outlines/chem_courses
npm run build
```

Status:
- `sample_outlines/course_based_outlines/chem_courses-audit.json` regenerated successfully
- chemistry office-hours coverage is materially better after the lab/hybrid fixes
- `CHEM 120` now parses both weekday office-hours slots correctly
- production build passes
