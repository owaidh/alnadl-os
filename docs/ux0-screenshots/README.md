# UX-0 Visual QA Evidence

Real Playwright screenshots against a live local server, captured during
UX-0 Foundations delivery. See `docs/UX_UI_SPEC.md` → "UX-0 Foundations"
for the full delivery record these support.

| File | What it shows |
|---|---|
| 01_qr_picker.png | Guest QR entry (dev mode), new purple brand |
| 02_welcome.png | Welcome screen, purple primary CTA |
| 03_menu.png | Menu — product cards with monogram placeholders (not emoji) |
| 04_product_modal.png | Product detail modal, monogram hero, purple selected-radio state |
| 05_cart.png | Cart — 44×44px steppers (was 22px) |
| 06_login_dev.png | Staff login, dev mode (demo account chips) |
| 07_admin_dark_chrome.png | PartnerAdmin dashboard, purple dark chrome |
| 08_superadmin_correct.png | SuperAdmin — the flagged 13+ flat nav buttons (unchanged this wave; UX-4 scope) |
| 09_kds_dark_chrome.png | KDS tickets/timers on purple dark chrome |
| 10_qr_picker_en_ltr.png | English/LTR — QR entry |
| 11_menu_en_ltr.png | English/LTR — menu, monograms match displayed language (S/A/C) |
| 12_prod_invalid_qr.png | Production mode — genuine "invalid QR" state, no demo picker |
| 13_prod_real_login_form.png | Production mode — real username/password form, no demo chips |
| 14_prod_login_success.png | Production mode — real bootstrap credentials authenticated successfully |
| 15_skeleton_loading_state.png | Skeleton loading component, captured mid-load via deliberate API delay |

## Corrective round: physical demo/production separation

Screenshots 12-14 above prove RUNTIME behavior was correct. The
screenshots below prove the fix goes further — the demo code is
physically absent from the production bundle, not just branched around
at runtime. See `docs/UX_UI_SPEC.md` → "UX-0 Corrective Round" for the
full record.

| File | What it shows |
|---|---|
| 16_corrective_prod_invalid_qr.png | Production, no token: genuine invalid-QR state, demo qrpicklist absent from DOM |
| 17_corrective_prod_login_form.png | Production: real credential form, 0 demo userchips in DOM |
| 18_corrective_prod_admin_logged_in.png | Production: real bootstrap credentials authenticated via the real form |
| 19_corrective_prod_real_qr_welcome.png | Production, REAL `?t=` token (DB-fixture tenant, not demo data): welcome screen |
| 20_corrective_prod_real_qr_menu.png | Production: a real product ("Americano", 16 SAR) rendered from a real catalog row |
| 21_corrective_prod_real_qr_modal.png | Production: product modal, monogram, 44px steppers — all correct on a genuine order |
| 22_corrective_dev_qr_picker.png | Dev mode: demo QR picker still works, unchanged |
| 23_corrective_dev_login_chips.png | Dev mode: demo login chips still work, unchanged |
