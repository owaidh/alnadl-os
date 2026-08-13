# UX-4 (SuperAdmin IA) Visual QA Evidence

| File | What it shows |
|---|---|
| 01_superadmin_sidebar.png | The 13 flat equal-weight buttons replaced by a grouped RTL sidebar across 5 domain groups, with the current scope pinned at the top and the active module highlighted |
| 02_breadcrumb_governance.png | Persistent scope breadcrumb in the header ("Governance › Audit Log") — spec SA02 |
| 03_narrow_collapse.png | At 700px the sidebar collapses to a horizontal grouped strip with its headings intact — no clipping, breadcrumb preserved |

Programmatic assertions verified alongside these (all passed, 0 page errors):
- 0 flat horizontal nav buttons remaining for SuperAdmin
- 13 sidebar links across 5 domain group headings
- **all 13 modules reachable**, each with exactly one active link, a rendered breadcrumb, and real content
- admin-layout switches to column direction at 700px
- Operator KEEPS the flat bar (sidebar absent) — grouping is applied only where breadth justifies it
