# Fall 2024 GEOE-MATBUS Audit Notes

Date: 2026-04-11

## Scope

- Root: `all_outlines_2024_to_2026/2024/Fall 2024`
- Subjects audited in this slice:
  - `GEOE`
  - `GEOG`
  - `GER`
  - `GSJ`
  - `HEALTH`
  - `HIST`
  - `HLTH`
  - `HRM`
  - `HRTS`
  - `INDEV`
  - `INTEG`
  - `ITAL`
  - `ITALST`
  - `KIN`
  - `LAT`
  - `LS`
  - `MATBUS`

## Outputs

- Comparison JSON: `all_outlines_2024_to_2026/audits/fall-2024-geoe-matbus-date-comparison.json`
- Audit JSON: `all_outlines_2024_to_2026/audits/fall-2024-geoe-matbus-audit.json`

## Summary

- Total files: `103`
- Flagged files: `39`
- Files with unmatched source dates: `21`
- Files with office-hours mismatch: `11`
- Files with suspicious event names: `17`
- Total unmatched source-date entries: `62`
- Total suspicious-name entries: `22`

## Audit Cleanup Applied In This Pass

This pass tightened the audit checker one step further to suppress recurring fraction-style false positives:

- ignored rubric lines like `1/2 = ...`
- ignored `Module 9/10`-style labels

This reduced unmatched-date noise inside the slice without changing parser output.

## High-Confidence Date Misses

These still look like real parser misses rather than audit noise:

- `GEOG/GEOG 102/1249__n9v96g__Global Environmental Systems_ Processes and Change.html`
  - Missed `Photo-blog #3 due F Nov 29`

- `GEOG/GEOG 203/1249__n9s3en__Environment and Development in a Global Perspective.html`
  - Missed:
    - `T1` due `Oct 6`
    - `T2` due `Nov 15`
    - `T3` due `Dec 4`

- `GEOG/GEOG 205/1249__n77mb3__Principles of Geomorphology.html`
  - Missed five Sunday deadlines:
    - `Oct 6`
    - `Oct 27`
    - `Nov 3`
    - `Nov 17`
    - `Nov 24`

- `GEOG/GEOG 294/1249__npzbj4__Approaches to Research in Physical Geography.html`
  - Missed a large sequence of project / lab deadlines:
    - groupwork contract `Sep 20`
    - due `Oct 1`
    - upload draft `Sep 30`
    - submit review `Oct 4`
    - lab activity due `Oct 22`
    - due `Nov 1`
    - lab due `Nov 8`
    - final proposal due `Dec 3`

- `GEOG/GEOG 310/1249__ncgsw4__GEOG 310 GEODESY _ SURVEYING_ Fall 2024 Course Outline.html`
  - Missed lab due dates:
    - Lab 1 `Oct 9`
    - Lab 2 `Oct 30`
    - Lab 5 `Nov 20`
    - Lab 6 `Nov 27`
    - Lab 7 `Dec 4`

- `GEOG/GEOG 316/1249__nmhmhm__GEOG 316 Multivariate Statistics_ Fall 2024 Course Outline.html`
  - Missed lab due dates:
    - Lab 1 due `Sep 18`
    - Lab 2 due `Sep 25`
    - Lab 4 due `Oct 30`
    - Lab 6 due `Nov 27`

- `GEOG/GEOG 371/1249__nbjgpu__Advanced Remote Sensing Techniques.html`
  - Missed:
    - `MLP1` due `Sep 18`
    - `MLP2` due `Sep 25`
    - `MLP3` due `Nov 20`
    - `MLP4` due `Nov 27`

- `GEOG/GEOG 391/1249__nz4ney__Field Research.html`
  - Missed:
    - research statement / sampling design due `Sep 27`
    - revised sampling design due `Oct 21`
    - field data summary due `Nov 11`
  - This file still also contains rubric-style fraction noise in the source text

- `GSJ/GSJ 101/1249__n9b3e2__Introduction to Gender and Social Justice_ the Global North.html`
  - Missed self-assessment due `Dec 13`
  - Both unmatched lines point to the same due date

- `HLTH/HLTH 480/1249__n6mgaa__Competencies in Health.html`
  - Missed real portfolio / ePortfolio deadlines:
    - reflection portfolio due `Dec 3`
    - final career ePortfolio due `Dec 6`

- `HLTH/HLTH 480/1249__n9nm52__Competencies in Health.html`
  - Missed real portfolio / ePortfolio deadlines:
    - reflection portfolio due `Dec 5` or `Dec 6` depending on the duplicated source wording
    - final career ePortfolio due `Dec 9`

- `INDEV/INDEV 200/1249__n5zjd7__The Political Economy of Development.html`
  - Missed all staged milestone deadlines:
    - pre-step `Sep 27`
    - step 1 `Oct 11`
    - step 2 `Nov 15`
    - step 3 `Dec 6`

- `INTEG/INTEG 120/1249__ny4mej__The Art and Science of Learning.html`
  - Missed final assignments cutoff `Dec 10`

- `KIN/KIN 104/1249__n9ynua__Fundamentals of Kinesiology.html`
  - Missed:
    - Midterm 1 `Oct 4`
    - Midterm 2 `Nov 8`

- `KIN/KIN 308/1249__n7czfq__Cardiovascular and Pulmonary Physiology.html`
  - Missed assignment due `Nov 15 at 5pm`

- `LS/LS 271/1249__nrg72y__Conflict Resolution.html`
  - Missed conflict summary due `Sep 20`
  - Duplicated source wording points to the same date twice

## Likely Administrative / Ambiguous / Cross-Term Hits

These still appeared in the unmatched-date checker, but they are not all parser failures that should become standard calendar items:

- `HIST/HIST 250/1249__ng86xd__What is History_ An Introduction to Historical Thinking.html`
  - AI paper / critique due `Dec 15`
  - Real deliverable, but it is unusually late and packed into one long prose block

- `KIN/KIN 104L/1249__n8awda__Fundamentals of Kinesiology Laboratory.html`
  - Practical exam runs during normal lab windows over `Nov 25-29`
  - This is a date range with individualized sub-times, not a single resolved event

- `KIN/KIN 343/1249__nz369x__Micronutrient Metabolism.html`
  - Daylight Savings Time notice on `Nov 3`
  - Administrative notice, not a calendar event

- `KIN/KIN 354/1249__n4nq8v__Psychology of Physical Activity.html`
  - Self-evaluation completion window `Nov 25` to `Dec 2`
  - This is a submission window rather than a single due timestamp

- `KIN/KIN 357/1249__n8vetn__Motor Learning and Neuroplasticity.html`
  - Lecture recording availability window `Sep 4` to `Dec 20`
  - Administrative access range, not a normal event

## Office-Hours Misses

These are the files still failing the tightened office-hours check.

### Clear office-hours misses

- `GEOE/GEOE 354/1249__n5j6hv__Geotechnical Engineering 2.html`
  - Missed three office-hour blocks:
    - Tuesday
    - Friday
    - Monday

- `GEOG/GEOG 205/1249__n77mb3__Principles of Geomorphology.html`
  - Missed `Monday’s 10:00 - 12:00`

- `HIST/HIST 110/1249__n7cx58__A History of the Western World 1.html`
  - Missed Tuesday and Thursday `2:30-4:00 p.m.`

- `ITALST/ITALST 291/1249__nn83cw__Italian Culture and Civilization 1.html`
  - Missed Monday and Wednesday `11:30 AM - 12:30 PM`

- `KIN/KIN 354/1249__n4nq8v__Psychology of Physical Activity.html`
  - Missed student hours on:
    - Thursday
    - Tuesday

- `KIN/KIN 453/1249__n43evb__Applied Sport Psychology.html`
  - Missed `Wednesdays @ 10-11am`

- `KIN/KIN 470/1249__njkrpk__Biomechanics of Injury_ Mechanisms_ Prevention_ and Rehabilitation.html`
  - Missed `Thursdays 3:00 - 4:00 PM`

### Partial office-hours extraction

- `GEOG/GEOG 310/1249__ncgsw4__GEOG 310 GEODESY _ SURVEYING_ Fall 2024 Course Outline.html`
  - Parser captured only one of:
    - Monday instructor office hours
    - Thursday TA office hours

- `GEOG/GEOG 371/1249__nbjgpu__Advanced Remote Sensing Techniques.html`
  - Parser captured only one of:
    - Monday `10:30 am - 12:30 pm`
    - Friday `10:00 - 11:00 am`

- `GEOG/GEOG 391/1249__nz4ney__Field Research.html`
  - Parser captured only one event while source text includes:
    - Tuesday `1:00-2:15`
    - Tuesday `11:00-12:00`
    - Wednesday `2:00-3:00`

- `HEALTH/HEALTH 107/1249__n7tz3s__Sociology of Activity_ Health_ and Well-Being.html`
  - Missed student hours on:
    - Monday
    - Tuesday

## Naming Audit Status

Remaining suspicious-name warnings are mostly generic labels:

- Suspicious-name files: `17`
- Suspicious-name entries: `22`
- Remaining reason types:
  - `generic_assessment_label`: `21`
  - `generic_assignment_label`: `1`

Most heavily flagged naming files in this slice:

- `GEOG/GEOG 203/1249__n9s3en__Environment and Development in a Global Perspective.html`
  - plain `Test`
  - plain `Midterm`

- `GEOG/GEOG 404/1249__n8uu6u__Soil Ecosystem Dynamics.html`
  - plain `Assignment`
  - plain `Midterm`

- `ITALST/ITALST 100/1249__n7rubc__Understanding Modern Italy.html`
  - plain `Quiz`
  - plain `Test`

- `KIN/KIN 343/1249__nz369x__Micronutrient Metabolism.html`
  - repeated plain `Quiz` labels

- `LS/LS 271/1249__nrg72y__Conflict Resolution.html`
  - plain `Midterm`
  - plain `Quiz`

## Main Parser Targets Exposed By This Slice

If we use this slice to drive the next parser pass, the most valuable targets are:

1. Compact due-line parsing for labs and staged geography assignments
   - `GEOG 203`
   - `GEOG 205`
   - `GEOG 294`
   - `GEOG 310`
   - `GEOG 316`
   - `GEOG 371`

2. Better extraction from repeated / duplicated portfolio prose
   - `HLTH 480` variants

3. Student-hours parsing in longer narrative paragraphs
   - `HEALTH 107`
   - `KIN 354`
   - `KIN 453`
   - `KIN 470`

4. Multi-person office-hours blocks with instructor + TA / CA combinations
   - `GEOE 354`
   - `GEOG 310`
   - `GEOG 391`
