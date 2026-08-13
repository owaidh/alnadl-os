# UX-2 (KDS + Runner) Visual QA Evidence

Real Playwright screenshots against a live local server. See
`docs/UX_UI_SPEC.md` → "UX-2 KDS + Runner" for the full delivery record.

| File | What it shows |
|---|---|
| 01_kds_board.png | KDS board — dominant next-action button on every card, zone name now shown, breached ticket with red edge + red timer, "1 late" SLA summary in the column header |
| 02_kds_after_action.png | After tapping the dominant action — state advanced with NO modal opened (spec K02: "No detail modal required for basic decision") |
| 03_runner_queue.png | Runner queue rebuilt destination-first: zone above a 22px destination, pickup/order/timer/item-count below, 44px claim button, last-refresh line |
| 04_runner_claimed.png | Claimed order visually pinned and distinct (lighter surface + purple edge), "Delivered" dominant, "Delivery failed" clearly secondary/destructive |
| 05_runner_fail_reason.png | Delivery-failure modal — restates destination + order, offers preset reasons, requires input |
| 06_runner_fail_empty_blocked.png | Confirming with an empty reason is blocked (client-side AND server-side) |
