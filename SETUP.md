# SEQUEL 26 — setup

Registration, UPI payment, manual verification, entry passes, admin panel.
About 20 minutes. No payment gateway, no API keys, no gateway fees.

---

## How it works

```
Student fills details
   ↓
Sees UPI QR + "Open UPI app" button (exact amount baked in)
   ↓
Pays, copies the UPI reference number, submits it (+ optional screenshot)
   ↓
Status: Verifying          ← sits in your admin panel
   ↓
YOU check it against your bank app, hit Approve
   ↓
Pass code issued + student emailed automatically
   ↓
They download the pass as PNG or PDF
```

Nobody gets a pass until you personally approve it.

**One thing to know up front:** your GitHub repo is public, so anyone can read
`index.html` and `admin.html`. That's why the admin password lives in Google Apps
Script Properties and is checked on the server, never in the page. Your UPI ID *is*
in the page — that's fine, a UPI ID is a public payment address.

---

## 1. Sheet + backend (10 min)

1. **[sheets.new](https://sheets.new)** → name it `SEQUEL 26`
2. **Extensions → Apps Script** → delete everything → paste all of `apps-script.gs` → **Save**
3. Near the top, set `SITE_URL` to where you'll publish (used in the approval email):
   ```js
   const SITE_URL = 'https://yourname.github.io/sequel26/';
   ```
4. **Project Settings** (gear icon, left sidebar) → **Script Properties** → add two:

   | Property | Value |
   |---|---|
   | `ADMIN_PASSWORD` | `iimkfreshers26` |
   | `TICKET_PRICE` | `800` |

5. Back in the editor → run **`setup`** → grant permissions
   (**Advanced → Go to … (unsafe) → Allow** — it's your own script)
6. Run **`testConnection`** → **View → Logs**. Everything should say `set` / `OK`.
7. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Copy the **/exec** URL.

---

## 2. Connect the pages (3 min)

Paste that URL into **both** files at `CONFIG.endpoint` — `index.html` and `admin.html`.

Then in `index.html`, set the rest:

```js
upiId:   "9329641726@upi",         // already filled in from your QR
upiName: "Mr JEET JHAWAR",
useStaticQR: true,                 // see "Which QR" below

eventDate:     "Sun 6 September",
eventDateFull: "Sunday 6 September 2026",   // printed on the pass
eventTime:     "6:00 PM",
venue:         "IIMK Kochi Campus",
deadline:      "Wednesday 2 September",
deadlineShort: "Registration closes 2 Sept",
contactWhatsApp: "919XXXXXXXXX",            // country code + number, digits only
```

### Which QR

Prices are tiered, and each tier has its own **bank-signed** QR (a signed QR has
its amount baked in and cannot be re-signed for a different amount — hence one
file per tier):

| Tier | Price | Signed QR |
|---|---|---|
| Early bird | ₹800 | `images/upi-qr.png` |
| Regular | ₹1,000 | `images/upi-qr-1000.jpeg` |
| Last call | ₹1,200 | `images/upi-qr-1200.jpeg` |

You switch tiers from the admin panel (**Ticket price** button). The payment page
automatically shows the signed QR matching the current price.

| | `useStaticQR: true` (default) | `useStaticQR: false` |
|---|---|---|
| QR source | The signed image for the current tier | Generated live in the browser |
| Custom amount | Falls back to the live QR automatically | Always live |
| Payment note | Empty | `SEQUEL26 <roll no>` on every payment |
| Verified badge | Yes, bank-signed | No — a normal person-to-person payment |

The live QR's per-person note makes verifying faster (each payment in your UPI
history says `SEQUEL26 BMS/02/047`), but the signed QR is what banks trust most.
Either mode follows the admin price; the signed image can never show a wrong
amount because off-tier prices fall back to the live QR.

---

## 3. Test before you publish

Open `index.html` locally and register yourself. Then:

- [ ] The QR scans with your own phone and opens your UPI app with **your** ID and the right amount
- [ ] Pay yourself ₹1 (change `TICKET_PRICE` to 1 temporarily) — confirms the ID is right
- [ ] Submit the reference number, with a screenshot
- [ ] Sheet row shows status **Verifying**, screenshot link opens in your Drive
- [ ] `admin.html` logs in, row appears under **To verify**
- [ ] Hit **Approve** → code appears, you get the email
- [ ] Back on the site, "Check my status" shows the pass; PNG and PDF both download
- [ ] Set `TICKET_PRICE` back to 800

That ₹1 test is worth doing. A wrong UPI ID means money going to a stranger.

---

## 4. Publish (5 min)

1. New GitHub repo → `sequel26` → **Public** → Create
2. **Add file → Upload files** → drag in everything including the `images` and
   `fonts` folders → Commit
3. **Settings → Pages** → Deploy from a branch → **main** → **/ (root)** → Save
4. Wait 2 minutes → `https://YOURNAME.github.io/sequel26/`
5. Open `index.html`, replace the two `YOURNAME.github.io` URLs at the top with your
   real address, re-upload. WhatsApp needs the absolute URL for the preview image.

Your admin panel is at `…/admin.html`. It isn't linked from anywhere, but assume
people will find it — the password is what protects it.

---

## Campus photos

The hero uses the confetti image. To use campus photos instead, drop them in as:

- `images/campus-kochi.jpg` — the hero picks this up automatically if present
- `images/campus-main.jpg` — spare

The CSS already falls back to `confetti.jpg` if the file isn't there, so nothing
breaks either way. Landscape, at least 1600px wide.

---

## Running it

**Verifying payments** — the whole job:

1. Admin panel opens on the **To verify** filter
2. For each row: open your UPI or bank app, find that reference number, check the
   amount matches
3. **Approve** → code issued, student emailed
4. **Reject** → asks for a reason, emails them that too

Do this in batches. Twice a day is plenty.

| Task | How |
|---|---|
| Change the price tier | **Ticket price** button — pick Early bird ₹800 / Regular ₹1,000 / Last call ₹1,200. Applies to new registrations only; the site's QR switches with it |
| Pause entries | **Pause entries** button — blocks new sign-ups and shows your message. People mid-payment can still submit their reference. Pause while switching tiers, then resume |
| Cash at the door | Find them (filter **No payment**) → **Mark paid** |
| Entry desk | Filter **Paid**, search a name or code → **Check in** |
| Who hasn't arrived | Filter **Not in yet** |
| Export | **Export CSV** — exports whatever the current filter shows |

**Email limits:** Apps Script sends 100/day on a personal Gmail, 1500/day on a
Workspace account like `@iimk.ac.in`. Use the institute account if you have it.
If the quota runs out, approvals still work — only the email fails, and students
can still use "Check my status".

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Not connected yet" | `CONFIG.endpoint` still says `PASTE_YOUR…` in one of the two files |
| Admin says wrong password | `ADMIN_PASSWORD` not set, or you didn't redeploy after setting it |
| Changes to the script do nothing | You didn't redeploy as a **New version** |
| QR doesn't open a UPI app on desktop | Expected. The QR is for scanning from another phone; the button is for the phone you're holding |
| Screenshot didn't save | Upload failures are ignored on purpose so the payment claim isn't lost. The reference number is what matters |
| Two people, same reference number | Blocked automatically — the second one is told to check it |
| Student paid but no pass | They're in **To verify**. That's the system working |

> After **any** edit to `apps-script.gs`:
> **Deploy → Manage deployments → pencil → Version: New version → Deploy.**
> The single most common thing to forget.

---

## Money

- It goes straight to your UPI account. No gateway, no percentage taken.
- Your **UPI transaction history is the source of truth.** The sheet is your record
  of who gets in; your bank statement is the record of what came in. Reconcile them
  once after registration closes.
- Refunds are manual — send it back by UPI and mark the row Rejected with a note.
- Download the CSV after registration closes and keep it.
