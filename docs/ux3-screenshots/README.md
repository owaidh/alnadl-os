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
