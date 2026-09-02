# SEQUEL 26

Freshers registration site for the BMS programme at IIM Kozhikode, Kochi Campus.
Both batches (BMS-01, BMS-02) register, pay by **UPI** (tiered price), and an
organiser **verifies each payment by hand**. Run by the Students' Council BMS
(note the apostrophe — "Students' Council"). Only then is a pass code issued and the student
emailed. There is a password-protected admin panel.

Static site on GitHub Pages. **No build step, no npm, no bundler, no payment gateway.**

## Files

| File | Role |
|---|---|
| `index.html` | Registration → UPI payment → reference submission → pass. Has `CONFIG`. |
| `admin.html` | Admin panel. Same `CONFIG.endpoint` must be pasted here too. |
| `style.css` | Shared design tokens and components. |
| `qr.js` | Self-contained QR encoder (byte mode, EC level M, versions 1–10) + `upiURI()`. |
| `pass.js` | Draws the pass on canvas; exports PNG and a hand-built PDF. |
| `apps-script.gs` | The backend. Pasted into Google Apps Script, NOT served by the site. |
| `fonts/` | Three self-hosted WOFF2 files. No CDN fallback — do not delete. |
| `images/` | `hero.jpg` (hero background), `campus-*.jpg` (section backdrops under a dark veil), `cover.jpg` (link preview), fixed-amount UPI QRs — Jeet: `upi-qr.png` (₹800), `upi-qr-1000.jpeg`, `upi-qr-1200.jpeg`; Anshika: `upi-qr-anshika-800/1000/1200.jpeg`. |

## Status flow

`Awaiting payment` → `Verifying` → `Paid` (or `Rejected`)

Set in `apps-script.gs` as `S.STARTED / S.CLAIMED / S.PAID / S.REJECTED`, mirrored
in `admin.html` as `ST`. **If you change one, change both** — the admin filters
compare these strings literally.

## Architecture — read before changing anything

The repo is **public**. The admin password lives in Apps Script Properties
(`ADMIN_PASSWORD`) and is checked server-side by `guard()`. The ticket price lives
there too (`TICKET_PRICE`) so the admin panel can change it without a redeploy.

Payments can be collected by **two people** — Jeet (`9329641726@upi`) or Anshika
(`anshika.chauhan258@okhdfcbank`) — so one account never hits its daily UPI
receiving limit. The active collector lives in Script Properties (`PAYEE`), set by
`adminSetPayee` from the admin panel's "Collecting" button; the site's QR, UPI ID
and pay button all follow it. The `PAYEES` map exists in `index.html` (UPI ID +
name + QR per tier) and `admin.html` (labels), with the id whitelist `PAYEE_IDS`
in `apps-script.gs`. **Adding a payee means updating all three.** Each sheet row
records who it paid in the `Paid to` column (empty = Jeet, pre-column rows), set
at registration and refreshed while the row is still `Awaiting payment` — the
same rule as the amount. Verification must check the account in that column.
UPI IDs are public payment addresses — fine in a public repo, but Jeet's is a
phone-number handle, so publishing the site publishes that number.

Prices are **tiered**: ₹800 "Early bird", ₹1000 "Regular", ₹1200 "Last call". The
admin panel's price dialog picks a tier (or a custom amount); the number itself
still lives in `TICKET_PRICE` in Script Properties. The `TIERS` map exists twice:
in `index.html` (label + signed QR image per amount) and `admin.html` (labels).
**If you change one, change both.**

`CONFIG.useStaticQR` (now `true`) shows the current payee's fixed-amount QR for
the current tier. Each image has its amount baked in and cannot be edited — that
is why there is one file per payee per tier. If the price matches no tier
(custom amount), the site falls back to the live-generated QR **for the active
payee's UPI ID**, so a fixed QR can never appear with the wrong amount. Setting
it `false` reverts to live QRs everywhere; those carry the per-person
"SEQUEL26 &lt;roll&gt;" note that makes verification easier.

Registrations can be **paused** from the admin panel ("Pause entries", with a
custom message). State lives in Script Properties (`REG_PAUSED`, `PAUSE_MESSAGE`),
written by `adminSetPause` — flipping it needs no redeploy. While paused, new
registrations are blocked, the site swaps the form for the message, and the
payment step hides its QR / pay button (the page re-polls `price` every 45 s
while on that step or while paused, so a mid-flow pause takes effect without a
reload). `submitPayment` stays open on purpose (someone who already paid must
never lose the claim) and already-paid students still get their pass back.
Default message text is in `getPauseMessage()` in `apps-script.gs`.

Screenshots are shrunk in the browser (`shrinkImage()`, max 1000px, JPEG 0.72), sent
as base64, and written to a private Drive folder by `saveScreenshot()`. Upload
failures are swallowed on purpose so a flaky upload never loses the payment claim —
the UPI reference number is the thing that matters.

## Hard rules

- **Never** put the admin password in any file in this repo. Script Properties only.
- Keep `Content-Type: text/plain` on every `fetch` to Apps Script. Using
  `application/json` triggers a CORS preflight Apps Script cannot answer.
- Use **relative** paths for fonts, images, css and js — served from a GitHub Pages
  subfolder. Only the `og:` meta tags use absolute URLs.
- No `localStorage`. The admin password is held in a JS variable only, so a refresh
  signs you out. Deliberate.
- After editing `apps-script.gs`, the user must redeploy as a **New version**.
  Always remind them.
- Don't touch the Reed–Solomon code in `qr.js` without re-verifying output against a
  real decoder. It is correct now and subtle to get right.

## Where to edit

- **Dates, venue, WhatsApp, endpoint** → `CONFIG` at the bottom of `index.html`
- **UPI IDs / payee QRs** → `PAYEES` in `index.html` (+ labels in `admin.html`,
  ids in `PAYEE_IDS` in `apps-script.gs`)
- **What the pass covers** → `INCLUDES` array in `index.html`
- **Pass design** → `drawPass()` in `pass.js` (canvas is 1080 × 1500)
- **Email wording** → `emailApproved()` / `emailRejected()` in `apps-script.gs`
- **Sheet columns** → `COLS` in `apps-script.gs`. Adding one means updating `COLS`,
  the payload in `index.html`, and the admin table in `admin.html`.
- **Price** → not in code. Script Properties, changed from the admin panel UI.
- **Tier names** → `TIERS` in `index.html` **and** `admin.html`.
- **Who collects** → not in code. The admin panel's "Collecting" button (Script
  Properties `PAYEE`).

## Common asks

- *"Change the date"* → `CONFIG.eventDate` and `CONFIG.eventDateFull` (the second is
  printed on the pass).
- *"Change the price"* → the admin panel's tier dialog, not code. A new tier (say
  ₹1500) needs a new bank-signed QR image plus a `TIERS` entry in both files.
- *"Change the hero photo"* → replace `images/hero.jpg` (landscape, ≥1200 px wide,
  dark at the bottom where the title sits) and check `.hero-veil` in `index.html`.
  Section backdrops are the `--bg-img` inline styles on each `.bgphoto` section,
  darkened by the gradient in `.bgphoto::before`.
- *"Add a QR to the pass"* → `qr.js` is already loaded on the page; you could encode
  the pass code. Discuss first — the entry desk currently works fine by search.
- *"Let people register a friend"* → the schema is one row per person keyed by email.
  Don't break that; duplicate detection and status lookup both rely on it. The
  roll number is also unique server-side: a second email for the same roll is
  rejected (with the existing email masked) so nobody registers or pays twice.
  The site shows a "Check your details" dialog before saving for the same reason.
- *"Change the house rules / T&C"* → the `#terms` block in `index.html`. The consent
  checkbox is required client-side, enforced in `actionRegister` (`consent === true`),
  and the tick time is stored in the `Consent` sheet column (in the CSV, not the table).
- *"Auto-verify payments"* → not possible without a gateway or bank API. Manual
  verification is the deliberate design here.
