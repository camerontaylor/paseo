# Fork implementation plans

The current TMAD campaign is the [full Desvio intake plan](tmad-desvio-full-intake-2026-10-24.md)
and its [feature/evidence matrix](tmad-desvio-feature-matrix-2026-10-24.json),
prepared 2026-10-24 using the improve planning workflow. Execute the package
dependencies below and update status only with linked evidence.

This index tracks this campaign. Other plans in this directory remain separate
workstreams or dated records. The older beta upgrade/TMAD intake ordering is
superseded for this campaign; signing/updater redesign is not a prerequisite.

| Package | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| D0 | Immutable inputs, owners, isolated baseline | — | DONE ([receipt](tmad-2026-10-24-baseline.md)) |
| D1 | Durable queue, delivery marks and send defaults | D0 | DONE (candidate evidence; installed observations in D9/D10) |
| D2 | Durable Stream, asks, artifacts and pins | D1 | DONE (candidate evidence; installed observations in D9/D10) |
| D3 | Session navigation, unread and compact controls | D0 | DONE (candidate evidence; installed observations in D9/D10) |
| D4 | Cross-project views and side surfaces | D2, D3, D6 | DONE (candidate evidence; installed observations in D9/D10) |
| D5 | Search, routing and Quick launch | D1, D3, D4 | DONE (candidate evidence; installed observations in D9/D10) |
| D6 | Inspection, diagnostics and standalone CLI | D1 | DONE (candidate evidence; installed observations in D9/D10) |
| D7 | Realtime and full native voice workflows | D5, D6 | DONE (candidate evidence; installed observations in D9/D10) |
| D8 | Threaded reply UX on side conversations | D1, D4 | DONE (candidate evidence; installed observations in D9/D10) |
| D9 | Candidate assembly, QA and usage guide | D2–D8 | IN PROGRESS (browser suite green; Android device and release evidence pending) |
| D10 | Reviewed promotion, publication and staged rollout | D9 | TODO |

Statuses: TODO, IN PROGRESS, DONE, BLOCKED (with reason).
“Planned” is not “implemented,” “published,” “installed” or “observed.”
The source-unimplemented exclusions and source release/identity adaptations are
explicit in the matrix. No implemented source feature is silently waived.
