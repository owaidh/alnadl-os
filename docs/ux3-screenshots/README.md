# UX-3 (Partner Dashboard) Visual QA Evidence

| File | What it shows |
|---|---|
| 01_partner_overview.png | Partner decision dashboard — Today snapshot (SLA 50% in red, rating 2.67), "Needs your attention" with 4 real signals above any table, Performance and Money layers, detail tables demoted below. Honest em-dashes where data genuinely does not exist yet. |

Programmatic assertions verified alongside this screenshot:
- 4 attention rows rendered (2 high severity)
- Severity conveyed by a TEXT label ("متوسط"/"عالٍ"), not colour alone
- Attention panel at DOM index 1 vs outlet table at index 5 — insight genuinely precedes tables
- Zero occurrences of prompt / mechanic / selection_reason / provider / embedding / rendered_payload anywhere in the rendered partner page
- Zero page JavaScript errors

## Corrective round

| File | What it shows |
|---|---|
| 02_corrective_round.png | SLA card labelled "(today)" with an explicit basis line ("from 2 orders · 1 multi-outlet not measurable"); refund alert stating the real rate against its configured threshold; Next settlement with period, amount and workflow status; Bottom zone alongside Top zone. |

Programmatic assertions verified alongside this screenshot (all true, 0 page errors):
multi-outlet exclusion notice rendered · elevated-refund wording rendered ·
next settlement rendered · bottom zone rendered · SLA explicitly labelled "today".
