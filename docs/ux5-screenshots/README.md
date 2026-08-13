# UX-5 (Engage Experience) Visual QA Evidence

| File | What it shows |
|---|---|
| spark.png | DISCOVER mode — deep gradient surface, lime kicker, white CTA, 2-step progress, mode-specific copy ("Discover more") |
| play.png | PLAY mode — energetic 22px/900 display type, lime CTA, 3-step progress, clear participation state |
| reset.png | RESET mode — calm cream surface, and its graceful one-moment closure ("Enjoy the rest of your day"), which is exactly the spec's "One-moment experience; graceful closure" |

Programmatic assertions verified alongside these (all passed):
- **3 of 3 distinct visual signatures** (background + type treatment) across the modes exercised — genuinely different surfaces, not one card recoloured
- **zero** capability-token names (`sessionToken`/`accessToken`/`access_token`) anywhere in the DOM
- **zero** AI internals (`selection_reason`/`mechanic`/`provider`/`embedding`/`rendered_payload`/`prompt`)
- **zero** page JavaScript errors across the full flow
