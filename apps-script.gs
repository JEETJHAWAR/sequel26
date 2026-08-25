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
  ['Updated',     'updated']
];

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
      case 'price':          return json({ ok: true, price: getPrice() });
      case 'register':       return json(actionRegister(body));
      case 'submitPayment':  return json(actionSubmitPayment(body));
      case 'getPass':        return json(actionGetPass(body));

      case 'adminLogin':     return json(guard(body, function () { return { ok: true }; }));
      case 'adminList':      return json(guard(body, adminList));
      case 'adminSetPrice':  return json(guard(body, adminSetPrice));
      case 'adminDecide':    return json(guard(body, adminDecide));
      case 'adminUpdate':    return json(guard(body, adminUpdate));

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

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    var row   = findRow(sheet, email);
    var now   = new Date();

    if (row > 0) {
      var status = readCell(sheet, row, 'status');

      // Already approved — hand back the pass, don't ask them to pay again.
      if (status === S.PAID) return { ok: true, pass: passFromRow(sheet, row) };

      // Update their details but keep whatever payment state they're in.
      sheet.getRange(row, C.name).setValue(name);
      sheet.getRange(row, C.batch).setValue(batch);
      sheet.getRange(row, C.roll).setValue(roll);
      sheet.getRange(row, C.phone).setValue(phone);
      sheet.getRange(row, C.updated).setValue(now);
      return { ok: true, price: getPrice(), status: status };
    }

    var price = getPrice();
    var values = {
      created: now, name: name, batch: batch, roll: roll, phone: phone, email: email,
      amount: price, status: S.STARTED, code: '', utr: '', shot: '',
      verifiedAt: '', checkedIn: '', notes: '', updated: now
    };
    sheet.appendRow(COLS.map(function (c) { return values[c[1]]; }));
    return { ok: true, price: price, status: S.STARTED };

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

    var link = '';
    if (b.shot) {
      try { link = saveScreenshot(b.shot, b.shotMime, readCell(sheet, row, 'name'), utr); }
      catch (err) { link = ''; }        // a failed upload must not lose the payment claim
    }

    sheet.getRange(row, C.utr).setValue(utr);
    if (link) sheet.getRange(row, C.shot).setValue(link);
    sheet.getRange(row, C.status).setValue(S.CLAIMED);
    sheet.getRange(row, C.updated).setValue(new Date());

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
  return { ok: true, rows: rows, price: getPrice(), event: EVENT_NAME, statuses: S };
}

function adminSetPrice(b) {
  var p = parseInt(b.price, 10);
  if (!p || p < 1 || p > 100000) return { ok: false, error: 'Price must be between 1 and 100000.' };
  PropertiesService.getScriptProperties().setProperty('TICKET_PRICE', String(p));
  return { ok: true, price: p };
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

function readCell(sheet, row, key) { return sheet.getRange(row, C[key]).getValue(); }

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

function passFromRow(sheet, row) {
  var v = sheet.getRange(row, 1, 1, COLS.length).getValues()[0];
  var o = {};
  COLS.forEach(function (c, i) { o[c[1]] = v[i]; });
  return { name: o.name, batch: o.batch, roll: o.roll, code: o.code, amount: o.amount, email: o.email };
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
  SpreadsheetApp.getUi().alert(msg);
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
