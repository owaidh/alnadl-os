# UX-1 (Guest) Visual QA Evidence

Real Playwright screenshots against a live local server. See
`docs/UX_UI_SPEC.md` → "UX-1 Guest" for the full delivery record these
support.

| File | What it shows |
|---|---|
| 01_welcome_no_fake_eta.png | Welcome screen — fake static "8-12 min" ETA removed entirely |
| 02_menu_real_image.png | Menu — real image attempted, gracefully fell back to monogram when the external CDN was unreachable (sandbox network restriction) — proves the fallback path works under a genuine failure |
| 03_product_modal_selections_made.png | Product modal — variant + note selected, before closing |
| 04_product_modal_state_preserved.png | Same product reopened after closing without adding to cart — selections restored exactly |
| 05_cart_real_image.png | Cart row also carries the product's real media (or fallback), not just the menu card |
| 06_checkout_dev_mode.png | Checkout, dev mode |
| 07_menu_real_image_loaded.png | Menu — real image genuinely loaded (verified via a working data-URI image after finding the first CDN test image itself was invalid) |
| 08_modal_real_image_loaded.png | (Diagnostic) modal opened for the wrong card by an nth=0 selector — see 09 for the corrected, precise check |
| 09_americano_modal_correct.png | Product modal for the exact product an image was set on — confirmed loaded (naturalWidth verified programmatically) |
| 10_service_hub.png | Service Hub — real "Available now" status badge (server-confirmed, not invented) + monogram type icons replacing food emoji |
