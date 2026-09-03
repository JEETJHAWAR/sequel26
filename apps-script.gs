/**
 * SEQUEL 26 — BACKEND
 * ====================================================================
 * Registrations land in this spreadsheet. You verify each UPI payment
 * by hand in the admin panel; only then is a pass code issued and the
 * student emailed.
 *
 * No payment gateway, no API keys, no gateway fees.
 *
 * SETUP
 *   1. Extensions > Apps Script, paste this file, Save
 *   2. Project Settings (gear, left sidebar) > Script Properties,
 *      add two properties:
 *
 *        ADMIN_PASSWORD   iimkfreshers26
 *        TICKET_PRICE     800
 *
 *      The password lives here, NOT in admin.html, because your GitHub
 *      repo is public and anyone can read the files in it.
 *
 *   3. Fill in SITE_URL below (used in the approval email)
 *   4. Run setup()
 *   5. Deploy > New deployment > Web app
 *        Execute as:     Me
 *        Who has access: Anyone
 *   6. Paste the /exec URL into CONFIG.endpoint in BOTH index.html
 *      and admin.html
 *
 * After ANY edit here: Deploy > Manage deployments > pencil >
 * Version: New version > Deploy. Otherwise the site runs old code.
 */

const SHEET_NAME  = 'Registrations';
const EVENT_NAME  = 'SEQUEL 26';
const SITE_URL    = 'https://jeetjhawar.github.io/sequel26/';
const DRIVE_FOLDER = 'SEQUEL 26 — payment screenshots';

/** Optional: get an email whenever someone submits a payment. '' for none. */
const NOTIFY_EMAIL = '';

/** Status values used across the sheet, the site and the admin panel. */
const S = {
  STARTED:  'Awaiting payment',   // filled the form, hasn't paid yet
  CLAIMED:  'Verifying',          // sent a UPI reference, waiting on you
  PAID:     'Paid',               // you approved it, pass issued
  REJECTED: 'Rejected'            // you rejected it
};

const COLS = [
  ['Registered',  'created'],
  ['Name',        'name'],
  ['Batch',       'batch'],
  ['Roll no',     'roll'],
  ['WhatsApp',    'phone'],
  ['Email',       'email'],
  ['Amount',      'amount'],
  ['Status',      'status'],
  ['Pass code',   'code'],
  ['UPI ref',     'utr'],
  ['Screenshot',  'shot'],
  ['Verified',    'verifiedAt'],
  ['Checked in',  'checkedIn'],
  ['Notes',       'notes'],
  ['Updated',     'updated'],
  ['Paid to',     'payee'],    // appended last so existing sheets don't shift
  ['Consent',     'consent']   // when they ticked the house-rules box
];

/** Who can collect payments. Mirrored in PAYEES in index.html and admin.html —
    if you add someone, add them in all three places. Rows with an empty
    'Paid to' predate this column: they were all collected by jeet. */
const PAYEE_IDS = ['jeet', 'anshika', 'niveditha'];

const C = {};
COLS.forEach(function (c, i) { C[c[1]] = i + 1; });


/* ==================================================================
   ROUTING
   ================================================================== */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, error: 'Bad request' }); }

  try {
    switch (body.action) {
      case 'price':          return json(actionPrice(body));
      case 'register':       return json(actionRegister(body));
      case 'submitPayment':  return json(actionSubmitPayment(body));
      case 'getPass':        return json(actionGetPass(body));

      case 'adminLogin':     return json(guard(body, function () { return { ok: true }; }));
      case 'adminList':      return json(guard(body, adminList));
      case 'adminSetPrice':  return json(guard(body, adminSetPrice));
      case 'adminSetPause':  return json(guard(body, adminSetPause));
      case 'adminSetPayee':  return json(guard(body, adminSetPayee));
      case 'adminSetAuto':   return json(guard(body, adminSetAuto));
      case 'adminSetFull':   return json(guard(body, adminSetFull));
      case 'adminDecide':    return json(guard(body, adminDecide));
      case 'adminUpdate':    return json(guard(body, adminUpdate));
      case 'adminDelete':    return json(guard(body, adminDelete));

      default: return json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return ContentService.createTextOutput(EVENT_NAME + ' registration endpoint is live.')
                       .setMimeType(ContentService.MimeType.TEXT);
}


/* ==================================================================
   PUBLIC
   ================================================================== */
/** Live price / collector / pause state — plus, when an email is given, that
    student's own row: a quote already on screen must follow the row, never
    the live properties, because the row is what gets verified against. */
function actionPrice(b) {
  var out = { ok: true, price: getPrice(), payee: getPayee(), paused: isPaused(), pauseMsg: getPauseMessage(),
              full: isFull(), fullMsg: getFullMessage() };
  var email = String(b.email || '').trim().toLowerCase();
  if (email) {
    var sheet = getSheet();
    var row = findRow(sheet, email);
    if (row > 0) out.row = rowQuote(rowValues(sheet, row));
  }
  return out;
}

function actionRegister(b) {
  if (b.website) return { ok: false, error: 'Rejected' };            // honeypot

  var name  = String(b.name  || '').trim();
  var email = String(b.email || '').trim().toLowerCase();
  var roll  = String(b.roll  || '').trim();
  var phone = String(b.phone || '').replace(/\D/g, '');
  var batch = String(b.batch || '').trim();

  if (!name || !email || !roll || !phone || !batch) {
    return { ok: false, error: 'Please fill every field.' };
  }
  if (!/@iimk\.ac\.in$/.test(email)) {
    return { ok: false, error: 'Use your IIMK email — it must end with @iimk.ac.in.' };
  }
  if (b.consent !== true) {
    return { ok: false, error: 'Please tick the box to confirm you agree to the house rules.' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    var row   = findRow(sheet, email);
    var now   = new Date();

    // Paused: an already-approved student still gets their pass back;
    // everyone else is blocked. Payment submissions are NOT blocked — see
    // actionSubmitPayment — so a claim from someone mid-flow is never lost.
    if (isPaused()) {
      if (row > 0 && readCell(sheet, row, 'status') === S.PAID) {
        return { ok: true, pass: passFromRow(sheet, row) };
      }
      return { ok: false, paused: true, error: getPauseMessage() };
    }

    // Already approved — hand back the pass, don't ask them to pay again.
    if (row > 0 && readCell(sheet, row, 'status') === S.PAID) {
      return { ok: true, pass: passFromRow(sheet, row) };
    }

    // Auto-collect filled its quota: closed to NEW registrations only. Anyone
    // already registered can still come back, get their quote and pay.
    if (row < 1 && isFull()) {
      return { ok: false, full: true, error: getFullMessage() };
    }

    // One person, one registration. Email is the key, but a roll number
    // must not appear under a second email either — that is how people end
    // up registering (and paying) twice. A row that already holds this roll
    // under this email is simply theirs; a duplicate that predates this rule
    // is flagged in the admin panel for the organiser to delete.
    var rollRow = findRowBy(sheet, 'roll', roll);
    var ownRoll = row > 0 ? String(readCell(sheet, row, 'roll')).trim().toUpperCase() : '';
    if (rollRow > 0 && rollRow !== row && ownRoll !== roll.toUpperCase()) {
      return { ok: false, error: 'Roll number ' + roll + ' is already registered under ' +
        maskEmail(readCell(sheet, rollRow, 'email')) + '. Use "Check my status" with that email — ' +
        'or message the Students\' Council if that isn\'t you.' };
    }

    if (row > 0) {
      var status = readCell(sheet, row, 'status');

      // Update their details but keep whatever payment state they're in.
      sheet.getRange(row, C.name).setValue(name);
      sheet.getRange(row, C.batch).setValue(batch);
      sheet.getRange(row, C.roll).setValue(roll);
      sheet.getRange(row, C.phone).setValue(phone);
      if (!readCell(sheet, row, 'consent')) sheet.getRange(row, C.consent).setValue(now);
      // Not paid yet, or a rejected claim being retried: re-quote at the
      // CURRENT price and collector and record that on the row. A row still
      // being verified keeps its original amount and payee.
      if (status === S.STARTED || status === S.REJECTED) {
        sheet.getRange(row, C.amount).setValue(getPrice());
        // Auto-collect: a row keeps the collector it was handed (that slot was
        // counted). By hand, a switch applies to everyone still unpaid.
        var keepPayee = isAutoOn() && String(readCell(sheet, row, 'payee') || '').trim() !== '';
        if (!keepPayee) sheet.getRange(row, C.payee).setValue(getPayee());
      }
      sheet.getRange(row, C.updated).setValue(now);
      // Echo the ROW, never the live properties: the screen must show exactly
      // what the organiser will verify against. A row already being verified
      // sends the student to the waiting screen, not to a second QR.
      var q = rowQuote(rowValues(sheet, row));
      return { ok: true, price: q.amount || getPrice(), payee: q.payee, status: status,
               claimed: q.claimed, utr: q.claimed ? q.utr : '' };
    }

    var price = getPrice();
    var values = {
      created: now, name: name, batch: batch, roll: roll, phone: phone, email: email,
      amount: price, status: S.STARTED, code: '', utr: '', shot: '',
      verifiedAt: '', checkedIn: '', notes: '', updated: now, payee: getPayee(),
      consent: now
    };
    sheet.appendRow(COLS.map(function (c) { return values[c[1]]; }));
    return { ok: true, price: price, payee: getPayee(), status: S.STARTED };

  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function actionSubmitPayment(b) {
  var email = String(b.email || '').trim().toLowerCase();
  var utr   = String(b.utr   || '').trim();

  if (!/^[A-Za-z0-9]{6,25}$/.test(utr)) {
    return { ok: false, error: 'That reference number does not look right.' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet();
    var row = findRow(sheet, email);
    if (row < 1) return { ok: false, error: 'We have no registration for that email. Start again from the top.' };
    if (readCell(sheet, row, 'status') === S.PAID) {
      return { ok: true, pass: passFromRow(sheet, row) };
    }

    // Same reference number used by someone else? Flag it rather than accept it.
    var clash = findRowBy(sheet, 'utr', utr);
    if (clash > 0 && clash !== row) {
      return { ok: false, error: 'That reference number is already on another registration. Check you copied the right one, or message the organisers.' };
    }

    // What the screen showed vs what the row says. A mismatch (re-quoted from
    // another device, or a tier change between quote and payment) is flagged
    // in Notes so the organiser checks the right account for the right amount
    // instead of verifying blind. The row is never overwritten from the client.
    var o = rowValues(sheet, row);
    var shownAmount = Number(b.amount) || 0;
    var shownPayee  = String(b.payee || '').trim().toLowerCase();
    if (shownAmount && (shownAmount !== Number(o.amount) || (shownPayee && shownPayee !== normPayee(o.payee)))) {
      var flag = 'CHECK: screen showed Rs ' + shownAmount + ' to ' + (shownPayee || '?') +
                 ' at submit, row says Rs ' + o.amount + ' to ' + normPayee(o.payee) + '.';
      var notes = String(o.notes || '');
      sheet.getRange(row, C.notes).setValue(notes ? notes + ' | ' + flag : flag);
    }

    var link = '';
    if (b.shot) {
      try { link = saveScreenshot(b.shot, b.shotMime, readCell(sheet, row, 'name'), utr); }
      catch (err) { link = ''; }        // a failed upload must not lose the payment claim
    }

    sheet.getRange(row, C.utr).setValue(utr);
    if (link) sheet.getRange(row, C.shot).setValue(link);
    sheet.getRange(row, C.status).setValue(S.CLAIMED);
    sheet.getRange(row, C.updated).setValue(new Date());
    autoCloseIfFull(sheet);                 // auto-collect counts paid entries: this may be the last one

    notifyOrganiser(sheet, row, utr);
    return { ok: true, status: S.CLAIMED };

  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function actionGetPass(b) {
  var email = String(b.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Enter your email.' };

  var sheet = getSheet();
  var row = findRow(sheet, email);
  if (row < 1) {
    return { ok: false, title: 'Not found', error: 'No registration for that email. Register from the top of this page.' };
  }

  var status = readCell(sheet, row, 'status');
  if (status === S.PAID)     return { ok: true, pass: passFromRow(sheet, row) };
  if (status === S.CLAIMED)  return { ok: false, title: 'Still being verified', error: 'We have your reference number and are checking it. You will get an email as soon as it clears.' };
  if (status === S.REJECTED) return { ok: false, title: 'Payment not accepted', error: String(readCell(sheet, row, 'notes') || 'We could not match that payment. Message the organisers.') };
  return { ok: false, title: 'No payment yet', error: 'You registered but we have no payment reference. Register again to get to the payment step.' };
}


/* ==================================================================
   ADMIN
   ================================================================== */
function guard(body, fn) {
  var given = String(body.password || '');
  var real  = String(prop('ADMIN_PASSWORD') || '');
  if (!real)          return { ok: false, error: 'ADMIN_PASSWORD is not set in Script Properties.' };
  if (given !== real) { Utilities.sleep(600); return { ok: false, error: 'Wrong password.' }; }
  return fn(body);
}

function adminList() {
  var sheet = getSheet();
  var last = sheet.getLastRow();
  var rows = [];
  if (last > 1) {
    var vals = sheet.getRange(2, 1, last - 1, COLS.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = { row: i + 2 };
      for (var j = 0; j < COLS.length; j++) {
        var v = vals[i][j];
        o[COLS[j][1]] = (v instanceof Date) ? v.toISOString() : v;
      }
      rows.push(o);
    }
  }
  return { ok: true, rows: rows, price: getPrice(), payee: getPayee(), event: EVENT_NAME,
           statuses: S, paused: isPaused(), pauseMsg: String(prop('PAUSE_MESSAGE') || ''),
           full: isFull(), fullMsg: String(prop('FULL_MESSAGE') || ''), auto: autoInfo(sheet) };
}

function adminSetPrice(b) {
  var p = parseInt(b.price, 10);
  if (!p || p < 1 || p > 100000) return { ok: false, error: 'Price must be between 1 and 100000.' };
  PropertiesService.getScriptProperties().setProperty('TICKET_PRICE', String(p));
  return { ok: true, price: p };
}

/** Switch which account the payment QR collects to (avoids one account
    hitting its UPI receiving limit). Applies from the next payment screen on;
    each row records the payee it was shown. */
function adminSetPayee(b) {
  var id = String(b.payee || '').trim().toLowerCase();
  if (PAYEE_IDS.indexOf(id) < 0) {
    return { ok: false, error: 'Unknown payee. Allowed: ' + PAYEE_IDS.join(', ') + '.' };
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PAYEE', id);
  props.setProperty('AUTO_ROTATE', '');   // a hand-picked collector ends auto-collect
  return { ok: true, payee: id, auto: autoInfo(null) };
}

/** Auto-collect on/off: hand out collectors in PAYEE_IDS order, ROTATE_PER
    registrations each, and pause once ROTATE_TOTAL have registered. Turning
    it on (or restart=true) starts a fresh count from now; picking a collector
    by hand (adminSetPayee) turns it off. */
function adminSetAuto(b) {
  var props = PropertiesService.getScriptProperties();
  var on = (b.on === true || b.on === 'true');
  if (!on) {
    props.setProperty('AUTO_ROTATE', '');
    props.setProperty('REG_FULL', '');      // "batch full" only means something while rotating
    return { ok: true, auto: autoInfo(null), payee: normPayee(prop('PAYEE')) };
  }
  var per = parseInt(b.per, 10), total = parseInt(b.total, 10);
  if (!per || per < 1 || per > 1000)        return { ok: false, error: 'Entries per account must be between 1 and 1000.' };
  if (!total || total < 1 || total > 10000) return { ok: false, error: 'The pause-after total must be between 1 and 10000.' };
  var wasOn   = props.getProperty('AUTO_ROTATE') === '1';
  var restart = (b.restart === true || b.restart === 'true');
  props.setProperty('AUTO_ROTATE', '1');
  props.setProperty('ROTATE_PER', String(per));
  props.setProperty('ROTATE_TOTAL', String(total));
  props.setProperty('ROTATE_PAUSE_MSG', String(b.message || '').trim().slice(0, 300));
  if (!wasOn || restart || !props.getProperty('ROTATE_SINCE')) {
    props.setProperty('ROTATE_SINCE', new Date().toISOString());
    props.setProperty('REG_FULL', '');      // a fresh round reopens registrations
  }
  _payeeMemo = '';
  var info = autoInfo(getSheet());
  return { ok: true, auto: info, payee: info.current };
}

/** Reopen registrations after auto-collect closed them. With auto still on
    this also starts the next round, otherwise the next registration would
    close the site again straight away. */
function adminSetFull(b) {
  var props = PropertiesService.getScriptProperties();
  var full = (b.full === true || b.full === 'true');
  props.setProperty('REG_FULL', full ? '1' : '');
  if (!full && prop('AUTO_ROTATE') === '1') props.setProperty('ROTATE_SINCE', new Date().toISOString());
  _payeeMemo = '';
  return { ok: true, full: full, auto: autoInfo(getSheet()) };
}

/** Pause or resume new registrations, with the message the site shows while
    paused. Stored in Script Properties, so it needs no redeploy to flip. */
function adminSetPause(b) {
  var on  = (b.paused === true || b.paused === 'true');
  var msg = String(b.message || '').trim().slice(0, 300);
  var props = PropertiesService.getScriptProperties();
  props.setProperty('REG_PAUSED', on ? '1' : '');
  props.setProperty('PAUSE_MESSAGE', msg);
  return { ok: true, paused: on, pauseMsg: msg };
}

/** Approve or reject a payment. Approving issues the code and emails them. */
function adminDecide(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet();
    var row = parseInt(b.row, 10);
    if (!row || row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Bad row.' };

    var now = new Date();

    if (b.decision === 'approve') {
      var code = readCell(sheet, row, 'code') || nextCode(sheet);
      sheet.getRange(row, C.code).setValue(code);
      sheet.getRange(row, C.status).setValue(S.PAID);
      sheet.getRange(row, C.verifiedAt).setValue(now);
      if (b.method) sheet.getRange(row, C.notes).setValue(String(b.method));
      sheet.getRange(row, C.updated).setValue(now);
      emailApproved(sheet, row, code);
      autoCloseIfFull(sheet);               // a cash "Mark paid" counts too
      return { ok: true, code: code };
    }

    if (b.decision === 'reject') {
      sheet.getRange(row, C.status).setValue(S.REJECTED);
      sheet.getRange(row, C.notes).setValue(String(b.reason || 'Payment could not be matched.'));
      sheet.getRange(row, C.updated).setValue(now);
      emailRejected(sheet, row, String(b.reason || ''));
      return { ok: true };
    }

    return { ok: false, error: 'Unknown decision.' };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** Check-in toggle and free-text notes. */
function adminUpdate(b) {
  var sheet = getSheet();
  var row = parseInt(b.row, 10);
  if (!row || row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Bad row.' };

  if (b.field === 'checkedIn') {
    sheet.getRange(row, C.checkedIn).setValue(readCell(sheet, row, 'checkedIn') ? '' : new Date());
  } else if (b.field === 'notes') {
    sheet.getRange(row, C.notes).setValue(String(b.value || '').slice(0, 500));
  } else {
    return { ok: false, error: 'Unknown field.' };
  }
  sheet.getRange(row, C.updated).setValue(new Date());
  return { ok: true };
}

/** Remove a registration outright. The row's email must match too, so a
    stale row number (rows shift after another delete) can't hit the wrong
    person — refresh and retry instead. */
function adminDelete(b) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet();
    var row = parseInt(b.row, 10);
    if (!row || row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Bad row.' };
    var email = String(b.email || '').trim().toLowerCase();
    var have  = String(readCell(sheet, row, 'email') || '').trim().toLowerCase();
    if (!email || have !== email) {
      return { ok: false, error: 'Row moved — refresh the list and try again.' };
    }
    sheet.deleteRow(row);
    return { ok: true };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}


/* ==================================================================
   SCREENSHOTS -> DRIVE
   ================================================================== */
function saveScreenshot(b64, mime, name, utr) {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER);

  var safe = String(name || 'unknown').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40);
  var blob = Utilities.newBlob(
    Utilities.base64Decode(b64),
    mime || 'image/jpeg',
    'SQL26-' + safe + '-' + utr + '.jpg'
  );
  var file = folder.createFile(blob);
  return file.getUrl();     // private to your Drive; opens for you when signed in
}


/* ==================================================================
   EMAIL
   ================================================================== */
function emailApproved(sheet, row, code) {
  var name  = readCell(sheet, row, 'name');
  var email = readCell(sheet, row, 'email');
  if (!email) return;
  try {
    MailApp.sendEmail({
      to: email,
      subject: EVENT_NAME + ' — you\'re in. Pass code ' + code,
      body: [
        'Hi ' + name + ',',
        '',
        'Your payment is verified. You\'re on the list for ' + EVENT_NAME + '.',
        '',
        'Pass code: ' + code,
        '',
        'Download your pass here — use "Check my status" and enter this email:',
        SITE_URL,
        '',
        'Save it to your phone before the night. Screenshot it too, in case the',
        'wifi is bad at the door.',
        '',
        'See you there.'
      ].join('\n')
    });
  } catch (ignore) {}
}

function emailRejected(sheet, row, reason) {
  var name  = readCell(sheet, row, 'name');
  var email = readCell(sheet, row, 'email');
  if (!email) return;
  try {
    MailApp.sendEmail({
      to: email,
      subject: EVENT_NAME + ' — we couldn\'t verify that payment',
      body: [
        'Hi ' + name + ',',
        '',
        'We couldn\'t match the payment reference you sent us.',
        reason ? ('Reason: ' + reason) : '',
        '',
        'Nothing has been charged by us and no pass has been issued. Please get',
        'in touch with the organisers so we can sort it out — do not pay again',
        'until we\'ve spoken.',
        '',
        EVENT_NAME
      ].filter(String).join('\n')
    });
  } catch (ignore) {}
}

function notifyOrganiser(sheet, row, utr) {
  if (!NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail(NOTIFY_EMAIL,
      EVENT_NAME + ' — payment to verify: ' + readCell(sheet, row, 'name'),
      ['Name:     ' + readCell(sheet, row, 'name'),
       'Batch:    ' + readCell(sheet, row, 'batch'),
       'Roll:     ' + readCell(sheet, row, 'roll'),
       'WhatsApp: ' + readCell(sheet, row, 'phone'),
       'Amount:   Rs ' + readCell(sheet, row, 'amount'),
       'UPI ref:  ' + utr,
       '',
       'Approve or reject it in the admin panel.'].join('\n'));
  } catch (ignore) {}
}


/* ==================================================================
   HELPERS
   ================================================================== */
function getSheet() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!s) throw new Error('Run setup() first.');
  return s;
}

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function getPrice() {
  var p = parseInt(prop('TICKET_PRICE'), 10);
  return (p && p > 0) ? p : 800;
}

function isPaused() { return prop('REG_PAUSED') === '1'; }

function normPayee(v) {
  var id = String(v || '').trim().toLowerCase();
  return PAYEE_IDS.indexOf(id) >= 0 ? id : PAYEE_IDS[0];   // empty = pre-column row = jeet
}

/* Memoised per execution: in auto-collect mode the answer comes from a scan
   of the sheet, and one request must hand out one consistent collector. */
var _payeeMemo = '';
function getPayee() {
  if (_payeeMemo) return _payeeMemo;
  _payeeMemo = (prop('AUTO_ROTATE') === '1') ? autoInfo(getSheet()).current : normPayee(prop('PAYEE'));
  return _payeeMemo;
}

/** Auto-collect state. An entry COUNTS once its UPI reference is in
    (Verifying or Paid); rows still Awaiting payment are only "pending".
    Only rows registered since ROTATE_SINCE belong to the round. `current` is
    the first collector in PAYEE_IDS order with fewer than ROTATE_PER paid
    entries (the last one once all are full). */
function autoInfo(sheet) {
  var on    = prop('AUTO_ROTATE') === '1';
  var per   = parseInt(prop('ROTATE_PER'), 10) || 15;
  var total = parseInt(prop('ROTATE_TOTAL'), 10) || 45;
  var since = prop('ROTATE_SINCE') ? new Date(prop('ROTATE_SINCE')) : null;
  var counts = {}, sums = {}, pending = {}, paid = 0, collected = 0;
  PAYEE_IDS.forEach(function (id) { counts[id] = 0; sums[id] = 0; pending[id] = 0; });
  if (on && sheet) {
    var last = sheet.getLastRow();
    if (last > 1) {
      var vals = sheet.getRange(2, 1, last - 1, COLS.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        var created = vals[i][C.created - 1], status = vals[i][C.status - 1];
        if (since && !(created instanceof Date && created >= since)) continue;
        var id = normPayee(vals[i][C.payee - 1]);
        if (status === S.CLAIMED || status === S.PAID) {
          var amt = Number(vals[i][C.amount - 1]) || 0;
          counts[id]++; sums[id] += amt; paid++; collected += amt;
        } else if (status === S.STARTED) {
          pending[id]++;
        }
      }
    }
  }
  var current = PAYEE_IDS[PAYEE_IDS.length - 1];
  for (var j = 0; j < PAYEE_IDS.length; j++) {
    if (counts[PAYEE_IDS[j]] < per) { current = PAYEE_IDS[j]; break; }
  }
  return { on: on, per: per, total: total, since: since ? since.toISOString() : '',
           counts: counts, sums: sums, pending: pending, paid: paid, collected: collected,
           current: current, message: String(prop('ROTATE_PAUSE_MSG') || '') };
}

function isAutoOn() { return prop('AUTO_ROTATE') === '1'; }
function isFull()   { return prop('REG_FULL') === '1'; }

function getFullMessage() {
  return String(prop('FULL_MESSAGE') || '').trim() ||
         'Early bird registrations are closed — this batch is full. Regular entries will open soon.';
}

/** Called whenever an entry becomes paid (reference submitted, or marked
    paid by hand): once the round's total is reached, close the site to NEW
    registrations (a flag, so a later deletion or rejection cannot silently
    reopen it). Existing rows keep working: they can still return, be quoted
    and pay — that is the whole point of the batch. */
function autoCloseIfFull(sheet) {
  if (!isAutoOn() || isFull()) return;
  var st = autoInfo(sheet);
  if (st.paid >= st.total) {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('REG_FULL', '1');
    props.setProperty('FULL_MESSAGE', st.message);
  }
}

function getPauseMessage() {
  return String(prop('PAUSE_MESSAGE') || '').trim() ||
         'Registrations are paused for a moment while we update things. Check back shortly.';
}

function readCell(sheet, row, key) { return sheet.getRange(row, C[key]).getValue(); }

/** j***@iimk.ac.in — enough to recognise your own address, not someone else's. */
function maskEmail(email) {
  var m = String(email || '').split('@');
  if (m.length < 2) return 'another email';
  return m[0].charAt(0) + '***@' + m[1];
}

function findRow(sheet, email) { return findRowBy(sheet, 'email', email); }

function findRowBy(sheet, key, needle) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, C[key], last - 1, 1).getValues();
  var want = String(needle).trim().toLowerCase();
  if (!want) return 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === want) return i + 2;
  }
  return 0;
}

/** Sequential codes — easy to read out at the entry desk. */
function nextCode(sheet) {
  var last = sheet.getLastRow();
  var n = 0;
  if (last > 1) {
    var vals = sheet.getRange(2, C.code, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var m = String(vals[i][0]).match(/SQL26-(\d+)/);
      if (m) n = Math.max(n, parseInt(m[1], 10));
    }
  }
  return 'SQL26-' + String(n + 1).padStart(3, '0');
}

/** Every cell of one row keyed by COLS key — a single read, so amount and
    payee can never be torn between two writes. */
function rowValues(sheet, row) {
  var v = sheet.getRange(row, 1, 1, COLS.length).getValues()[0];
  var o = {};
  COLS.forEach(function (c, i) { o[c[1]] = v[i]; });
  return o;
}

function passFromRow(sheet, row) {
  var o = rowValues(sheet, row);
  return { name: o.name, batch: o.batch, roll: o.roll, code: o.code, amount: o.amount, email: o.email };
}

/** What a quote on screen must follow. Booleans rather than status strings so
    index.html does not become a third copy of S. */
function rowQuote(o) {
  return { paid: o.status === S.PAID, claimed: o.status === S.CLAIMED,
           amount: Number(o.amount) || 0, payee: normPayee(o.payee), utr: String(o.utr || '') };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}


/* ==================================================================
   SETUP
   ================================================================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME, 0);

  var headers = COLS.map(function (c) { return c[0]; });
  sheet.getRange(1, 1, 1, headers.length)
       .setValues([headers]).setFontWeight('bold')
       .setBackground('#221030').setFontColor('#F7F0E6');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);
  sheet.getRange(2, C.roll,  sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, C.phone, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, C.utr,   sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  for (var i = 1; i <= headers.length; i++) sheet.setColumnWidth(i, 150);
  sheet.setColumnWidth(C.name, 200);
  sheet.setColumnWidth(C.email, 230);

  if (!prop('TICKET_PRICE')) {
    PropertiesService.getScriptProperties().setProperty('TICKET_PRICE', '800');
  }

  var msg = prop('ADMIN_PASSWORD')
    ? 'Everything is set.\n\nNow: Deploy > New deployment > Web app\nExecute as: Me\nWho has access: Anyone\n\nPaste the /exec URL into index.html and admin.html.'
    : 'Sheet is ready, but ADMIN_PASSWORD is not set yet.\n\nProject Settings > Script Properties > Add script property:\n  ADMIN_PASSWORD = your password\n\nThen deploy.';
  // A popup only works when the spreadsheet UI is open; from the editor or a
  // trigger there is no UI, and the sheet work above has already succeeded.
  try { SpreadsheetApp.getUi().alert(msg); }
  catch (ignore) { Logger.log(msg); }
}

/** Sanity check — run it, then View > Logs. */
function testConnection() {
  var out = [];
  ['ADMIN_PASSWORD', 'TICKET_PRICE'].forEach(function (k) {
    out.push(k + ': ' + (prop(k) ? 'set' : 'MISSING'));
  });
  out.push('SITE_URL: ' + (SITE_URL.indexOf('YOURNAME') === -1 ? SITE_URL : 'still a placeholder — edit it'));
  try { getSheet(); out.push('Sheet: OK'); }
  catch (e) { out.push('Sheet: ' + e.message); }
  try {
    out.push('Email quota left today: ' + MailApp.getRemainingDailyQuota());
  } catch (e) { out.push('Email: ' + e.message); }
  Logger.log(out.join('\n'));
}
