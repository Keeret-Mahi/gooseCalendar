# Fall 2024 A Slice Audit Notes

Scope:
- Root: `all_outlines_2024_to_2026/2024/Fall 2024`
- Subjects: `ACTSC, AE, AFM, AMATH, ANTH, APPLS, ARABIC, ARBUS, ARCH, ARTS, AVIA`
- Total outlines audited: `77`

Audit workflow:
- Ran the parser against the full A-subject slice.
- Compared parser output against the missed-date checker output.
- Tightened office-hours inspection by comparing office-hour hint days against generated office-hour events.
- Reviewed suspicious event names from the audit JSON rather than relying only on top-line counts.

## Parser changes applied during this pass

1. Office-hours parsing
- Normalized dot-separated times such as `2.30-4.30 pm` to `2:30-4:30 pm`.
- Preserved TA tails when they contain actual office-hours content instead of stripping everything after `TA:`.
- Allowed `Office Hours (Fall 2024): ...` style prefixes to normalize cleanly.
- Added extra splitting for inline `TA Office Hours:` blocks.
- Prioritized clustered day-time parsing ahead of a greedier detailed-segment path so `Tues & Thurs 11:30-12:45` produces both days.

2. Deliverable label recovery
- Added canonical recovery for:
  - `Project II` / other roman-numeral project labels
  - `Annotated Bibliography`
  - `Poster Presentation`
  - `Research Proposal`
  - `Grant Proposal`
- Expanded named-deliverable cues to catch those labels in prose.
- Added heading-style label capture for lines like `Short Essay (20%)`.

3. Date anchoring and sentence carryover
- Expanded deadline anchors to include phrases like:
  - `Date of Submission`
  - `Submission date`
  - `submitted virtually to`
  - `following dates`
  - `present on`
- Allowed section-text resolution to carry labels across semicolon-separated and sentence-separated fragments.
- Added better numbered assessment handling so `Test 1` / `Test 2` can resolve to different dates when both dates are listed together.

4. Event-name cleanup
- Allowed assessment labels like `Test 1` and `Test 2` without requiring `#`.
- This removed the previous generic `Test` names in `AVIA 310`.

5. Continuation and instructor-prose recovery
- Reused labels across adjacent prose paragraphs so heading-only lines like `Short Essay (20%)` can flow into a following `Date of Submission: ...` paragraph.
- Stopped the prose parser from treating table-cell paragraphs as free-form prose. This prevents schedule and weight tables from polluting carryover labels.
- Trimmed late-policy tails like `As of January 1, 2025 no papers will be accepted` so the parser keeps the actual due item and ignores the administrative cutoff sentence.
- Prefixed instructor office-hour blocks with `Office Hours:` before structured recovery so sentence-style blocks like `I will be available every Tuesday...` are parsed as recurring office hours.

## Confirmed improvements from this pass

- `ARBUS 200` office hours now include:
  - Monday `12:30-2:20`
  - Tuesday `11:30-12:45`
  - Thursday `11:30-12:45`
- `AVIA 310` office hours now resolve correctly from `Wednesday- 2.30-4.30 pm`.
- `AVIA 310` assessments are now named `Test 1` and `Test 2` instead of generic `Test`.
- `ACTSC 221` now recovers the recurring `Mobius Assignments #1-11` Monday series instead of dropping most of the Mobius dates.
- `ACTSC 431` now recovers the instructor Tuesday office hours block:
  - Tuesday `12:00-1:00`
  - recurring from `2024-09-17` to `2024-11-26`
- `ANTH 311` now recovers the missing `Short Essay` due `2024-11-15`.
- `ANTH 377` now keeps the concrete `Research Proposal` label on `2024-11-08` instead of collapsing it to a generic proposal/poster name.
- Follow-up naming cleanup pass:
  - `ERS 484` no longer saves the row as `Assignment Due #11`; it now resolves to `Major Group Assignment`.
  - `ERS 300` now keeps `Assignment #1-4` cleanly and drops the duplicated `Assignment 4 - the take home final analysis ...` shadow label.
  - `ERS 202` now keeps the dated lab deliverables from the week table:
    - `Lab 2: How best to catch a fish`
    - `Ethics Module`
    - `Lab 3 Presentations`
    - `Lab 3 Written Submission`
    - `Lab 4 Debate`
  - `ERS 270` no longer invents two assignment dates from the same row; it now keeps one `Major Group Assignment` on `2024-11-01`.
  - `ENVS 105` keeps `Reflection Paper Proposal` / `Reflection Paper` rather than sentence fragments ending in `is`.
  - `ECON 221` no longer creates ghost midterms from the `No tutorial will be held on ...` sentence; it now keeps the two real midterms only.
  - `ECE 150` keeps the project series as `Projects #1-5` instead of carrying the month name into the label.

## Remaining real misses after the parser fixes

### Office-hours mismatches

None in the current rerun.

### Unmatched dates still present

1. `ACTSC/ACTSC 431/1249__njnv3h__Casualty and Health Insurance Mathematics 2.html`
- Tutorial placeholders are still unmatched:
  - `September 6, September 20, October 4, October 18, November 1, November 15 and November 29`
- This is intentional for now. The outline explicitly says the tutorial slots are tentative and only used if a lecture needs to be made up, so these should probably stay out of the final calendar export.

2. `ANTH/ANTH 377/1249__n44rwb__Dental Anthropology.html`
- Still misses:
  - the explicit prose date `Test #1` on `2024-10-06`
- The parser now does recover:
  - `Research Proposal` on `2024-11-08`
  - `Poster Presentation` on `2024-11-29`
  - `Poster Presentation` on `2024-12-01`
  - `Grant Proposal` on `2024-12-09`
- The remaining gap is that the prose sentence `Oct 6th and Nov 17th` still only contributes the `Nov 17` side once the rest of the course schedule is merged.

3. `ARCH/ARCH 393/1249__nvm9zb__Design Studio_ Urban In_Queeries_ - Queer Resiliency through Joy in the Built Environment.html`
- Still misses:
  - `P.1b & P.2 Due - Submitted Virtually to LEARN by Friday Oct 11, 9:00pm`

4. `ARCH/ARCH 428/1249__nhjxwv__Rome and the Campagna _Rome_.html`
- Still misses:
  - `course introduction on September 3, 2024`
  - `field trip ... September 18 to 22, 2024`
- The parser does now recover:
  - `Initial Submission` on `2024-11-08`
  - `Final Paper` on `2024-12-19`
- The checker still flags `2025-01-01`, but that date only comes from the late-policy sentence `As of January 1, 2025 no papers will be accepted.` That is a checker false positive, not a parser miss.

5. `ARCH/ARCH 446/1249__n5jhsa__Italian Urban History _Rome_.html`
- Still misses:
  - `Oct 2 5:00 pm: Florence 1418 - Lecture`

6. `ARCH/ARCH 520/1249__nrfr8u__The Architectures of Reconciliation.html`
- Still misses:
  - `Annotated Bibio DUE Tues Oct 22 at 10:30pm`
  - `FINAL ESSAY DUE Tues Nov 19, 10:30pm`
  - `Weeks 7-12 Reading Reflections DUE Dec 3rd 10:30pm`

## Remaining suspicious names

These are now mostly generic-name checker leftovers rather than true date misses:
- `AE 205` generic `Midterm`
- `AE 223` generic `Midterm`
- `AMATH 350` generic `Midterm`
- `AMATH 351` generic `Midterm`
- `ANTH 311` generic `Midterm`
- `ARTS 140` two generic `Midterm`-style labels
- `AVIA 100` generic `Quiz`

These should be treated as naming cleanup work, not parser-date failures.

## Current status of this slice

After the fixes in this pass:
- Remaining unmatched-date files: `6`
- Remaining office-hours mismatch files: `0`
- Remaining suspicious-name files: `8`
- Total flagged files: `14 / 77` (`18.2%`)

This slice is materially better than the initial run, and the remaining failures are now concentrated enough to tackle one-by-one rather than by broad parser guesses.
