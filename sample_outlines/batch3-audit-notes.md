# Batch 3 Audit Notes

Date: 2026-03-26

Scope:
- Ran the parser across all outlines in `sample_outlines/batch3`
- Compared office-hours coverage directly against the source HTML outlines
- Fixed confirmed parser misses in `src/app/lib/parser.ts`
- Regenerated `sample_outlines/batch3-audit.json`

## Confirmed parser misses fixed

### HLTH 435 flattened instructional-team office hours were missed
- Source outline:
  - `Office hours: Wednesdays 11:00am-12:00pm or by appointment`
- Before the fix:
  - no office-hours event was produced
- Root cause:
  - the instructional-team block was flattened into one prose segment
  - the parser rejected the line because it only treated singular weekday forms as concrete, so `Wednesdays ... or by appointment` got filtered out
- Fix:
  - widened office-hours weekday detection to accept plural weekday forms like `Mondays`, `Wednesdays`, and `Thursday's`
  - kept the concrete-time path even when `or by appointment` appears alongside a real weekly slot
- Result:
  - `Knowledge Translation for Public Health and Health Care` now includes `Office Hours with Carrie McAiney` on Wednesdays `11:00-12:00`

### BIOL 273-style office-hours tables were fine; BIOC/HLTH-style table rows were not
- Source outline:
  - `Trevor Manning, Ph.D | Email: ... | Mondays and Wednesdays: 11:30 AM - 12:30 PM, or by Appointment (virtual)`
- Before the fix:
  - `Biochemistry for Health Sciences` showed `OfficeHours: 0`
- Root cause:
  - grouped office-hours day rows written as `Mondays and Wednesdays: ...` were not being parsed because the grouped-day regex expected `from`, not a colon after the weekday group
- Fix:
  - updated the office-hours grouped-day regex family to accept `:` as well as `from`
- Result:
  - `Biochemistry for Health Sciences` now includes two recurring office-hours events:
    - Monday `11:30-12:30`
    - Wednesday `11:30-12:30`

### Multi-slot office-hours lines only kept the first slot
- Source outline:
  - `Office Hours: Wednesday 2:30-3:30 (virtual) and Thursday 4:00-5:00 (office)`
- Before the fix:
  - `Introductory Psychology` only produced the Wednesday office-hours event
- Root cause:
  - the parser accepted the first single-slot office-hours match and returned before checking for a second distinct day/time pair later in the same line
- Fix:
  - changed office-hours parsing to compare grouped-day matches against repeated single-day matches and keep the richer interpretation
  - this preserves grouped same-time patterns like `Mondays and Wednesdays: 11:30-12:30`, while also capturing multi-slot lines like `Wednesday ... and Thursday ...`
- Result:
  - `Introductory Psychology` now includes:
    - Wednesday `2:30-3:30` (Online)
    - Thursday `4:00-5:00` (PAS 3050)

## Office-hours cases reviewed and left unchanged

These were checked manually and are acceptable as non-events because the source outline does not provide a concrete recurring office-hours slot:

- `Competencies in Health`
  - source says `By appointment`
- `Genetics`
  - source says office-hours details are on LEARN
- `Introductory Cell Biology`
  - source provides a booking link rather than a recurring time
- `Quantitative Approaches to Health Science`
  - source only generically mentions attending office hours
- `Introduction to Health Research`
  - source says Thursday sessions may be used for office hours and coursework, but does not define a dedicated office-hours slot separate from the optional Thursday class block

## Validation

Commands rerun after the fixes:

```bash
./node_modules/.bin/tsx scripts/run-batch-audit.mts batch3
npm run build
```

Status:
- `sample_outlines/batch3-audit.json` regenerated successfully
- batch 3 now has no `reviewNeeded` entries in the regenerated audit
- production build passes
