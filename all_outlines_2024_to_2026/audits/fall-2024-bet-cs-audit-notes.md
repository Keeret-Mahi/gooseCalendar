# Fall 2024 BET-CS Audit Notes

Date: 2026-04-11

## Scope

- Root: `all_outlines_2024_to_2026/2024/Fall 2024`
- Subjects audited in this slice:
  - `BET`
  - `BIOL`
  - `BME`
  - `CHE`
  - `CHEM`
  - `CI`
  - `CIVE`
  - `CLAS`
  - `CMW`
  - `CO`
  - `COMM`
  - `CROAT`
  - `CS`

## Outputs

- Comparison JSON: `all_outlines_2024_to_2026/audits/fall-2024-bet-cs-date-comparison.json`
- Audit JSON: `all_outlines_2024_to_2026/audits/fall-2024-bet-cs-audit.json`

## Summary

- Total files: `207`
- Flagged files after audit-noise cleanup: `89`
- Files with unmatched source dates: `19`
- Files with office-hours mismatch: `24`
- Files with suspicious event names: `61`
- Total unmatched source-date entries: `34`
- Total suspicious-name entries: `70`

## Audit Cleanup Applied In This Pass

This pass also tightened the audit checker itself so the notes are less noisy:

- Suppressed section-label false positives like `Lab LAB 001`, `Lecture LEC 001`, etc.
- Ignored obvious non-date fraction noise like `6.7/10`, `1/2*`, `1/6 of`, and `Labs 5/6`
- Ignored inline URL dates such as ebook links containing archival timestamps

This dropped the slice from `118` flagged files to `89` flagged files without changing parser output.

## High-Confidence Date Misses

These still look like real parser misses rather than audit noise:

- `BET/BET 320/1249__ng9e5k__Entrepreneurial Strategy.html`
  - Missed `Due December 3: Group project feedback`
  - Also contains a stale July 22 line from another term, so this file is mixed

- `BET/BET 430/1249__n5cf5r__Sales Fundamentals.html`
  - Missed `Sales Playbook ... due Nov 22`

- `BIOL/BIOL 354/1249__nwqnkm__Environmental Toxicology.html`
  - Missed `Tox Talk Group Contract` due `Friday September 20 at 11:59 PM`

- `BME/BME 362/1249__nrc5gx__Biomedical Engineering Design Workshop 1.html`
  - Missed three due dates:
    - `2024-09-20`
    - `2024-09-27`
    - `2024-10-11`

- `CHE/CHE 241/1249__nrtvxv__Materials Science and Engineering.html`
  - Missed group self-enrollment deadline `Sep 13`
  - Missed presentation slides upload deadline `Nov 25`

- `CHE/CHE 450/1249__nvme6z__Technical Work-Term Report.html`
  - Missed full staged report workflow:
    - initial submission `Sep 16`
    - peer-review distribution `Sep 17`
    - peer reviews due `Sep 23`
    - feedback release `Sep 24`
    - final submission `Sep 30`

- `CHE/CHE 482/1249__n57zbu__Group Design Project.html`
  - Missed `Due Oct 25th: Video & initial literature review`
  - Missed `Due Nov 22: Updated literature review`

- `CHEM/CHEM 220/1249__n6ega6__Intro Analytical Chemistry.html`
  - Missed seven recurring Crowdmark submission deadlines:
    - `Sep 14`
    - `Sep 21`
    - `Oct 5`
    - `Oct 12`
    - `Nov 2`
    - `Nov 16`
    - `Nov 30`

- `CHEM/CHEM 333/1249__ncs6hc__Metabolism 1.html`
  - Missed poster final-presentation due date `Nov 19`
  - The `Nov 20` live-presentation start mention appears to be partially recognized already

- `CHEM/CHEM 494B/1249__npqngn__Research Project.html`
  - Missed seminar date `Nov 18`
  - Final report due `Dec 6` appears to have been captured already

- `CIVE/CIVE 204/1249__nnsrhn__Solid Mechanics 1.html`
  - Missed Civil Engineering Design Days starting `Nov 21`
  - Source text is a two-day range `Nov 21 and 22`

- `CO/CO 330/1249__njvb9b__Combinatorial Enumeration.html`
  - Missed `A6 due 12/3`

- `CS/CS 341/1249__nmnxnk__Algorithms.html`
  - Missed midterm exam `Monday, Oct 28, 4:30pm to 6:20pm`

- `CS/CS 370/1249__ng23jh__Numerical Computation.html`
  - Missed `Assignment 2 due: Oct 3`
  - Missed `Assignment 3 due: Oct 24`

## Likely Stale / Administrative / Ambiguous Date Hits

These were still unmatched in the checker, but they do not all look like parser failures that should become calendar items:

- `BME/BME 101/1249__ny65cy__Communications in Biomedical Engineering-Written and Oral.html`
  - Contains `Hard deadline is October 08, 2023`
  - Looks like stale copied-forward content rather than Fall 2024 output

- `CHEM/CHEM 266L/1249__nwt8uq__Organic Chemistry Laboratory.html`
  - WD / WF deadlines `Nov 19` and `Dec 5`
  - Administrative drop deadlines, probably intentionally excluded from normal event export

- `COMM/COMM 101/1249__nmyjud__Introduction to Financial Markets.html`
  - `Any marked midterms not claimed by December 23 ... will be destroyed`
  - Administrative notice, not a course event to export

- `CS/CS 135/1249__nm7p5g__Designing Functional Programs.html`
  - `First lecture on Thursday, September 7`
  - `First tutorial on Friday, September 8`
  - These look more like schedule markers than separate calendar events

- `CS/CS 246/1249__np5r6c__Object-Oriented Software Development.html`
  - Project demos `December 1-3`
  - Ambiguous multi-day range, not a single resolved event date

- `BET/BET 320/1249__ng9e5k__Entrepreneurial Strategy.html`
  - The `July 22` narrated presentation line is almost certainly stale cross-term content

## Office-Hours Misses

These are the office-hours files that still need attention after the tightened check.

### Clear office-hours misses

- `BIOL/BIOL 342/1249__n8j77f__Molecular Biotechnology 1.html`
  - Missed `Mondays 2-3 pm`

- `BIOL/BIOL 359/1249__nnfc9p__Evolution 1_ Mechanisms.html`
  - Missed `Mondays 3:00-3:30 pm`

- `BIOL/BIOL 434/1249__njt2h7__Human Molecular Genetics.html`
  - Missed `Wednesday 11:00AM - 12:00PM`

- `BME/BME 121/1249__n7wbw6__Digital Computation.html`
  - Missed `Tue, Thu 10-11:30am`

- `BME/BME 182/1249__nczpy5__Physics 2_ Dynamics.html`
  - Missed tentative `Thursday 1:30-2:30`

- `CHE/CHE 120/1249__nnrqms__Computer Literacy and Programming for Chemical Engineers.html`
  - Missed `Mondays 16:30-17:30`

- `CHE/CHE 180/1249__nvnsqr__Chemical Engineering Design Studio 1.html`
  - Missed `Wednesdays 12:30-1:30`

- `CHE/CHE 541/1249__npxhfk__Introduction to Polymer Science and Properties.html`
  - Missed `Wednesday 12:00-1:00 pm`

- `CHEM/CHEM 262L/1249__npapdt__Organic Chemistry Laboratory for Engineering Students.html`
  - Missed `Mon 8:30-11:30`
  - Missed `Tues 8:30-11:30`
  - Missed `Fri 8:30-11:30`

- `CIVE/CIVE 354/1249__nyhbcc__Geotechnical Engineering 2.html`
  - Missed instructor / TA / CA office hours on:
    - Tuesday
    - Friday
    - Monday

- `CS/CS 135/1249__nm7p5g__Designing Functional Programs.html`
  - Missed a large office-hours block spread across:
    - Monday
    - Tuesday
    - Wednesday
    - Thursday
    - Friday
  - This is one of the highest-priority office-hours parser gaps in this slice

- `CS/CS 145/1249__n6r84n__Designing Functional Programs _Advanced Level_.html`
  - Missed `Tues and Thur 1:00-2:00pm`

- `CS/CS 330/1249__nncjcn__Management Information Systems.html`
  - Missed `Thursdays 12:00-2:00 pm`

### Partial office-hours extraction

- `BIOL/BIOL 479/1249__nr9uqw__Population Genetics and Evolution.html`
  - Clear real office hours are Monday `3:00-3:30 pm`
  - Extra “alternate time” narrative likely inflates the hint count

- `BME/BME 101/1249__ny65cy__Communications in Biomedical Engineering-Written and Oral.html`
  - Parser captured only one of two days
  - Source has both Wednesday and Thursday `11:30-12:30`

- `BME/BME 362/1249__nrc5gx__Biomedical Engineering Design Workshop 1.html`
  - Parser captured only one of:
    - Wednesday `9:00-10:00`
    - Thursday `11:30-12:30`

- `CHE/CHE 100/1249__npqx3t__Chemical Engineering Concepts 1.html`
  - Parser captured only `3` office-hour events from a `5`-day combined hint set

- `CHE/CHE 241/1249__nrtvxv__Materials Science and Engineering.html`
  - Parser captured only one of:
    - Tuesday `9:30-10:30`
    - Thursday `4:00-5:00`

- `CHEM/CHEM 120L/1249__npq7mz__General Chemistry Laboratory 1.html`
  - Broad Monday-Friday “door is open” office hours are only partially recognized

- `CHEM/CHEM 121L/1249__n4rgsy__Chemical Reaction Laboratory 1.html`
  - Same broad Monday-Friday “door is open” pattern is only partially recognized

- `CHEM/CHEM 266L/1249__nwt8uq__Organic Chemistry Laboratory.html`
  - Parser captured only part of a five-day student-hours block

- `CIVE/CIVE 306/1249__nw6jxp__Solid Mechanics.html`
  - Parser captured `2` events from a `3`-day office-hours set

- `CIVE/CIVE 375/1249__ngm7px__Environmental Engineering Principles.html`
  - Parser captured only one of:
    - Wednesday instructor office hours
    - Friday TA office hours

- `CS/CS 466/1249__n4ez8g__Algorithm Design and Analysis.html`
  - Parser captured only one of:
    - Monday `5:00-6:00 PM`
    - Wednesday `3:00-4:00 PM`

## Naming Audit Status

Remaining suspicious-name warnings are now much cleaner:

- Suspicious-name files: `61`
- Suspicious-name entries: `70`
- Remaining reason type:
  - `generic_assessment_label`: `70`

This means the remaining naming flags are all things like plain `Quiz`, `Test`, or `Midterm` labels that still lack a more specific name. The audit is no longer being dominated by section-label noise like `Lab LAB 001`.

Most heavily flagged generic-name files in this slice:

- `CLAS/CLAS 105/1249__n8s2wj__Introduction to Medieval Studies.html`
  - multiple plain `Quiz` labels

- `CHE/CHE 180/1249__nvnsqr__Chemical Engineering Design Studio 1.html`
  - repeated plain `Quiz` labels

- `BIOL/BIOL 354/1249__nwqnkm__Environmental Toxicology.html`
  - plain `Test`
  - plain `Quiz`

- `CHEM/CHEM 331/1249__nnj6ax__Fundamentals of Metabolism 1.html`
  - plain `Midterm`
  - plain `Quiz`

- `CO/CO 250/1249__n9j8up__Introduction to Optimization.html`
  - plain `Test`
  - plain `Midterm`

## Main Parser Targets Exposed By This Slice

If we want to use this slice to drive the next parser pass, the biggest wins are:

1. Office-hours parsing for compact weekday lists
   - Examples:
     - `Tue, Thu 10-11:30am`
     - `Tues and Thur 1:00-2:00pm`
     - mixed semicolon-separated office-hours lines

2. Assignment / deliverable detection in prose-only due lines
   - Examples:
     - `Due: Friday, September 20 by 11:59 pm`
     - `Due Nov 22`
     - `Submit questions on Crowdmark by ...`

3. Multi-stage workflow parsing
   - Especially for report pipelines like `CHE 450`

4. Better separation between real exportable events and administrative dates
   - WD / WF deadlines
   - stale prior-year dates
   - “unclaimed by” disposal dates
   - ambiguous demo windows
