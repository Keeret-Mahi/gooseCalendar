# Fall 2024 DAC-GENE Audit Notes

Date: 2026-04-11

## Scope

- Root: `all_outlines_2024_to_2026/2024/Fall 2024`
- Subjects audited in this slice:
  - `DAC`
  - `DUTCH`
  - `EARTH`
  - `EASIA`
  - `ECE`
  - `ECON`
  - `EMLS`
  - `ENBUS`
  - `ENGL`
  - `ENVE`
  - `ENVS`
  - `ERS`
  - `FINE`
  - `FR`
  - `GBDA`
  - `GENE`

## Outputs

- Comparison JSON: `all_outlines_2024_to_2026/audits/fall-2024-dac-gene-date-comparison.json`
- Audit JSON: `all_outlines_2024_to_2026/audits/fall-2024-dac-gene-audit.json`

## Summary

- Total files: `178`
- Flagged files: `61`
- Files with unmatched source dates: `24`
- Files with office-hours mismatch: `15`
- Files with suspicious event names: `34`
- Total unmatched source-date entries: `55`
- Total suspicious-name entries: `56`

## Parser Stability Note

While starting this slice, the runner hit a real parser regression:

- `ReferenceError: fallbackInstructorName is not defined`

This came from `parseStructuredOfficeHourLines` in `src/app/lib/parser.ts`.

Fix applied:

- Replaced the bad out-of-scope reference with `sectionFallbackInstructorName`
- Rebuilt `tmp-parser-bundle.cjs`
- Reran the full `DAC` to `GENE` slice successfully

## High-Confidence Date Misses

These look like real parser misses rather than audit noise:

- `DAC/DAC 203/1249__n9f746__Designing Digital Sound.html`
  - Missed two prose assignment submissions:
    - digital audio project due `Oct 7`
    - soundtrack project due `Nov 6`

- `EARTH/EARTH 436A/1249__n4fnaz__Thesis Proposal.html`
  - Missed final research design proposal due `Dec 9`
  - Also contains two presentation-session placeholders that were not turned into events

- `ECE/ECE 150/1249__n5t4k6__Fundamentals of Programming.html`
  - Missed:
    - `Project 1 September 24`
    - `Project 3 November 5`
    - `Project 5 December 3`

- `ECE/ECE 203/1249__nveenu__Probability Theory and Statistics 1.html`
  - Missed a cluster of problem-set handout / due dates, especially:
    - `Oct 4`
    - `Oct 11`
    - `Nov 8`
    - `Nov 15`
    - `Nov 22`
    - `Nov 29`
  - This is one of the biggest real date gaps in this slice

- `ECE/ECE 224/1249__n99jah__Embedded Microprocessor Systems.html`
  - Missed several lab report / demo deadlines:
    - Lab 1 demo due `Oct 31`
    - Lab 1 report due `Oct 31`
    - Lab 2 demo due `Nov 28`
    - Lab 2 report due `Nov 28`

- `ENBUS/ENBUS 102/1249__nrye47__Introduction to Environment and Business.html`
  - Missed tutorial activity windows beginning:
    - `Sep 16`
    - `Sep 30`
    - `Oct 21`
    - `Nov 4`
    - `Nov 18`

- `ENGL/ENGL 210G/1249__n7eayu__Genres of Fundraising Communication.html`
  - Missed draft and final proposal package deadlines:
    - Draft 1 `Oct 24`
    - Draft 2 `Nov 14`
    - Final package `Dec 3`

- `ENGL/ENGL 275/1249__nmudyj__Fiction and Film.html`
  - Missed assignment due `Dec 4`

- `ENGL/ENGL 304/1249__n5nep4__Designing Digital Sound.html`
  - Same pattern as `DAC 203`
  - Missed assignment submissions due `Oct 7` and `Nov 6`

- `ENGL/ENGL 309C/1249__nb2jph__Contemporary Rhetoric.html`
  - Missed:
    - essay proposal due `Oct 24`
    - final essay due `Dec 3`

- `ENVE/ENVE 225/1249__nj7x54__Environmental Modelling.html`
  - Missed:
    - `A1 is due on Sep 23`
    - `A2 is due on Oct 21`
    - `A3 is due on Nov 11`

- `ENVS/ENVS 105/1249__np96f6__Environmental Sustainability and Ethics.html`
  - Missed discussion roles due `Sep 11`

- `ERS/ERS 100/1249__nr46wy__Foundations_ Environment_ Resources and Sustainability.html`
  - Missed deliverable due `Sep 27 @ 11:55 p.m.`

- `ERS/ERS 202/1249__nrqxmm__Natural Resources Ecology.html`
  - Missed:
    - e-Journal 7-8 due `Oct 11`
    - e-Journal 11-12 due `Nov 1`
    - e-Journal 13-14 due `Nov 8`

- `ERS/ERS 215/1249__nz8wj9__Environmental and Sustainability Assessment 1.html`
  - Missed honour statement due `Sep 11`

- `ERS/ERS 300/1249__n7znds__Social Ecological Systems Analysis.html`
  - Missed `Assignment 3` due `Nov 24 @ 8 PM`

- `ERS/ERS 316/1249__nv94dx__Urban Water and Wastewater Systems_ Integrated Planning and Management.html`
  - Missed final test on `Dec 4`

## Likely Stale / Administrative / Ambiguous Date Hits

These still appeared in the unmatched-date checker, but they are not all parser failures that should become normal calendar events:

- `ENBUS/ENBUS 402A/1249__npkzs2__Environment and Business Project.html`
  - One real-looking item: `Client Meeting Summary ... Due: Oct 10`
  - One stale copied-forward line: `The first class will be held on September 8, 2023`

- `ECE/ECE 240/1249__nvuver__Electronic Circuits 1.html`
  - `Midterm Week Oct 20 - Oct 26`
  - A date range, not a single resolved event

- `ECE/ECE 252/1249__n4yk45__Systems Programming and Concurrency.html`
  - Lateness policy contains `one day late` language
  - Not a real dated event

- `ECE/ECE 358/1249__njvx5t__Computer Networks.html`
  - `Tutorial - problem set 1/2`, `2/3`, `3/4`
  - These are fraction-style labels rather than dates

- `GBDA/GBDA 204/1249__nz5myf__WORKING IN TEAMS AND PROJECT MANAGEMENT.html`
  - Real-looking deadline:
    - peer evaluation due `Dec 2`
  - But also contains:
    - article publication date `24 August 2022`
    - broad prose around periodic quizzes
  - Mixed file, not all unmatched lines should become events

- `ERS/ERS 335/1249__nmq8j5__Restoration Ecology.html`
  - `Ecological Restoration Case is due in LEARN dropbox on Dec 16 at 8 PM`
  - This falls after regular class activity and may need a policy decision on whether to export such post-term deadlines

- `ERS/ERS 403A/1249__nbqeds__Senior Honours Thesis.html`
  - Both unmatched dates are in `March/April 2025`
  - These are likely intentional cross-term deliverables, but not Fall 2024 course-calendar dates in the usual sense

## Office-Hours Misses

These are the files still failing the tightened office-hours check.

### Clear office-hours misses

- `EARTH/EARTH 458/1249__nmkvgd__Physical Hydrogeology.html`
  - Missed `Fridays 10:30 AM - 11:20 AM`

- `ECE/ECE 207/1249__n987jm__Signals and Systems ECE 207 Fall 2024.html`
  - Missed `Tuesday and Wednesday 4:45 - 5:30 PM`

- `ECE/ECE 373/1249__n6ds99__Radio Frequency and Microwave Circuits.html`
  - Missed `Mondays, 5:00-6:00 pm`

- `ECON/ECON 393/1249__nmdht9__Market Failures.html`
  - Missed `Tuesday, Thursday 15:30-17:00`

- `ENBUS/ENBUS 408/1249__n7bh5d__Policy Instruments for Sustainability.html`
  - Missed `Tuesday, 10:30 - 11:30 a.m.`

- `ENGL/ENGL 191/1249__nm8msc__Communication in the Engineering Profession _AE_ CIVE_ ENVE_ GEOE_.html`
  - Missed Monday and Wednesday drop-in hours

- `ENGL/ENGL 275/1249__nmudyj__Fiction and Film.html`
  - Missed Monday and Wednesday `12-1pm`

- `ENVS/ENVS 195/1249__np89yu__Introduction to Environmental Studies.html`
  - Missed `Tuesdays 1:00 - 3:00pm`

- `ENVS/ENVS 201/1249__nr8rpv__Introduction to Canadian Environmental Law.html`
  - Missed `Fridays, 11:00 a.m. to 3:00 p.m.`

- `ERS/ERS 301/1249__nbhf4z__Sustainability Thought_ Practice and Prospects.html`
  - Missed three separate office-hour blocks:
    - Tuesday
    - Wednesday
    - Monday

### Partial office-hours extraction

- `ECE/ECE 206/1249__nrteua__Adv Calculus 2 for Electrical Engineers.html`
  - Parser captured `2` events from a `3`-day hint set
  - Miss likely involves one of:
    - Monday
    - Friday
    - Thursday TA office hour

- `ECE/ECE 320/1249__nm9xt6__Computer Architecture.html`
  - Parser captured only part of a multi-line office-hours set spanning:
    - Tuesday
    - Friday
    - Thursday
    - Friday again for a second instructor / TA block

- `ENBUS/ENBUS 402A/1249__npkzs2__Environment and Business Project.html`
  - Parser captured one office-hour signal, but the file mixes:
    - Friday `3-4 pm` drop-in office hours
    - workshop support language
    - `office hours are by request`

- `ENVS/ENVS 178/1249__n8u7zh__Environmental Applications of Data Management and Statistics.html`
  - Parser captured `2` office-hour events from a hint count of `3`
  - Extra office-hour mention may be inflated by instructional prose, but worth checking

- `ERS/ERS 365/1249__nw6wy7__Water Governance.html`
  - Parser captured only one event while the hint count is `3`
  - The true office-hour line is likely just `Thursdays 3-4pm`; the rest is email policy noise

## Naming Audit Status

Remaining suspicious-name warnings are mostly generic labels:

- Suspicious-name files: `34`
- Suspicious-name entries: `56`
- Remaining reason types:
  - `generic_assessment_label`: `50`
  - `generic_assignment_label`: `6`

Most heavily flagged naming files in this slice:

- `ENVS/ENVS 278/1249__ncy8tx__Applied Statistics for Environmental Research.html`
  - multiple plain `Test` labels

- `ECON/ECON 437/1249__nwvdp9__Urban Economics.html`
  - multiple plain `Test` labels

- `ECE/ECE 105` variants
  - repeated plain `Quiz` labels

- `ENBUS/ENBUS 102/1249__nrye47__Introduction to Environment and Business.html`
  - plain `Midterm`
  - plain `Quiz`

- `ENVS/ENVS 195/1249__np89yu__Introduction to Environmental Studies.html`
  - several plain `Assignment` labels

## Main Parser Targets Exposed By This Slice

If we want to use this slice to drive the next parser pass, the most valuable targets are:

1. Prose assignment / project due lines with full descriptions
   - `DAC 203`
   - `ENGL 304`
   - `ENGL 210G`
   - `ENGL 309C`

2. Repeated handout / due workflow extraction
   - `ECE 203`

3. Lab report / demo due extraction from sectioned prose
   - `ECE 224`

4. Compact multi-day office-hours parsing
   - `Tuesday and Wednesday 4:45 - 5:30 PM`
   - `Tuesday, Thursday 15:30-17:00`
   - `Monday and Wednesday, 12-1pm`

5. Better filtering of mixed stale/admin lines
   - `ENBUS 402A`
   - `GBDA 204`
   - `ERS 403A`
