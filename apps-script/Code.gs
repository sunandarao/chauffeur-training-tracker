/**
 * Chauffeur Training Tracker - backend API (Google Apps Script)
 *
 * The Google Sheet this script is attached to is the database:
 *   Chauffeurs, Attendance, Modules, Users, Settings
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me      Who has access: Anyone
 * Then paste the web app URL into web/config.js of the Vercel site.
 *
 * Run setup() once from the editor before the first deployment.
 */

var SH = { CH: 'Chauffeurs', AT: 'Attendance', MO: 'Modules', US: 'Users', SE: 'Settings', RG: 'Regions', FL: 'FeedbackLinks', FI: 'Feedback Inbox', NM: 'Not in Master' };
var USER_COLS = ['Name', 'Email', 'Role', 'Active', 'Access', 'New Password', 'Password Hash', 'Salt', 'Link Key Hash'];
var CODE_VERSION = '2026-10-08-users';
var TOKEN_DAYS = 7;
var HASH_ROUNDS = 300;
var Q_COUNT = 8;   // rating columns Q1-Q8 in the Attendance sheet
var Q_ASKED = 7;   // questions asked today (Q8 'confident applying' was dropped); Q8 stays blank

/* ------------------------------------------------------------------ entry points */

function doGet(e) {
  return respond_(route_((e && e.parameter) || {}));
}

function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { p = {}; }
  return respond_(route_(p));
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  try {
    var action = String(p.action || '');
    if (action === 'ping') return { ok: true, version: CODE_VERSION, time: new Date().toISOString() };
    if (action === 'login') return login_(p);
    if (action === 'linkLogin') return linkLogin_(p);
    if (action === 'resetRequest') return resetRequest_(p);
    if (action === 'resetConfirm') return withLock_(function () { return resetConfirm_(p); });
    if (action === 'fbOptions') return fbOptions_();
    if (action === 'fbCheck') return fbCheck_(p);
    if (action === 'fbSubmitCommon') return withLock_(function () { return fbSubmitCommon_(p); });
    if (action === 'fbSession') return fbSession_(p);
    if (action === 'fbSubmit') return withLock_(function () { return fbSubmit_(p); });
    var me = auth_(p.token);
    var out = act_(action, me, p);
    if (MV_WRITES[action]) markDirty_();
    return out;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function act_(action, me, p) {
  switch (action) {
    case 'data': return data_(me);
    case 'addTraining': editor_(me); return withLock_(function () { return addTraining_(me, p); });
    case 'makeFeedbackLink': editor_(me); return withLock_(function () { return makeFeedbackLink_(me, p); });
    case 'updateEntries': editor_(me); return withLock_(function () { return updateEntries_(me, p); });
    case 'deleteEntries': editor_(me); return withLock_(function () { return deleteEntries_(me, p); });
    case 'dismissPending': editor_(me); return withLock_(function () { return dismissPending_(me, p); });
    case 'changePassword': return withLock_(function () { return changePassword_(me, p); });
    case 'saveChauffeur': admin_(me); return withLock_(function () { return saveChauffeur_(p); });
    case 'replaceCode': admin_(me); return withLock_(function () { return replaceCode_(p); });
    case 'saveUser': admin_(me); return withLock_(function () { return saveUser_(me, p); });
    case 'saveUsers': admin_(me); return withLock_(function () { return saveUsers_(me, p); });
    case 'listUsers': admin_(me); return listUsers_();
    case 'makeLink': admin_(me); return withLock_(function () { return makeLink_(p); });
    case 'revokeLink': admin_(me); return withLock_(function () { return revokeLink_(p); });
    case 'saveModule': admin_(me); return withLock_(function () { return saveModule_(p); });
    case 'mergeModule': admin_(me); return withLock_(function () { return mergeModule_(p); });
    case 'syncMaster': admin_(me); return withLock_(function () { return syncMaster_(p); });
    case 'listInbox': admin_(me); return listInbox_();
    case 'importFeedback': admin_(me); return withLock_(function () { return importFeedback_(p); });
    case 'dismissInbox': admin_(me); return withLock_(function () { return dismissInbox_(p); });
    case 'rebuildMasterView': admin_(me); return withLock_(function () { return rebuildMasterView_(); });
    case 'saveSettings': admin_(me); return withLock_(function () { return saveSettings_(p); });
    default: throw new Error('Unknown action: ' + action);
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The system is busy saving another entry. Please try again in a few seconds.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ setup */

/** Run once from the Apps Script editor (select setup, click Run). */
function setup() {
  secret_();
  ensureSheets_();
  ensureCols_(SH.US, USER_COLS);
  var n = applyNewPasswords_();
  Logger.log('Setup done. Passwords set for ' + n + ' user(s).');
}

function ensureSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var need = {};
  need[SH.CH] = ['Code', 'Name', 'Chauffeur ID', 'Location', 'Driver Type', 'Status', 'DOJ', 'DOL', 'Category', 'Mobile'];
  need[SH.AT] = ['Entry ID', 'Date', 'Code', 'Module', 'Trainer', 'Remarks'].concat(qHeaders_()).concat(['Entered By', 'Entered At', 'Note']);
  need[SH.MO] = ['Module', 'Duration (mins)', 'Active'];
  need[SH.US] = USER_COLS;
  need[SH.SE] = ['Key', 'Value'];
  need[SH.RG] = ['Region', 'Locations'];
  Object.keys(need).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, need[name].length).setValues([need[name]]); }
  });
}

/** Adds any missing header columns at the end of a sheet (for sheets created by an older version). */
function ensureCols_(name, headers) {
  var sh = sheet_(name);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var have = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length).setValues([missing]);
}

function qHeaders_() {
  var h = [];
  for (var i = 1; i <= Q_COUNT; i++) h.push('Q' + i);
  return h;
}

function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SECRET', s);
  }
  return s;
}

/* ------------------------------------------------------------------ sheet helpers */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Run setup() in Apps Script.');
  return sh;
}

/** Reads a sheet into {sh, head (name->col index), rows (array of arrays, without header)}. */
function table_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var values = lastRow > 0 && lastCol > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var head = {};
  values[0].forEach(function (h, i) { head[String(h).trim()] = i; });
  return { sh: sh, head: head, rows: values.slice(1), width: lastCol };
}

function optCol_(t, name) {
  return name in t.head ? t.head[name] : -1;
}

function col_(t, name) {
  if (!(name in t.head)) throw new Error('Column "' + name + '" missing in sheet ' + t.sh.getName());
  return t.head[name];
}

function iso_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (s === '-') return '';
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
}

var TZ_ = null;
function tz_() {
  if (!TZ_) TZ_ = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  return TZ_;
}

// A calendar date as midnight in the SPREADSHEET's time zone, so the sheet shows exactly that day even when the
// script and the spreadsheet are set to different time zones.
function toDate_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var d = Utilities.parseDate(m[0], tz_(), 'yyyy-MM-dd');
  return d && !isNaN(d.getTime()) && iso_(d) === m[0] ? d : null;
}

/**
 * Run ONCE from the Apps Script editor (select repairDates, click Run) after installing this version.
 * Dates saved by the app before this fix were written as midnight in the script's time zone, so a sheet set to
 * another time zone showed them a day early (with a time of day attached). This puts each such date back on the
 * day it was meant to be. Dates typed or imported directly (plain midnight) are not touched.
 */
function repairDates() {
  var scriptTz = Session.getScriptTimeZone(), tz = tz_(), fixed = {};
  [[SH.AT, ['Date']], [SH.CH, ['DOJ', 'DOL']]].forEach(function (job) {
    var t = table_(job[0]);
    if (!t.rows.length) return;
    job[1].forEach(function (h) {
      var c = optCol_(t, h); if (c < 0) return;
      var rng = t.sh.getRange(2, c + 1, t.rows.length, 1), vals = rng.getValues(), n = 0;
      vals.forEach(function (v) {
        var d = v[0];
        if (Object.prototype.toString.call(d) !== '[object Date]' || isNaN(d.getTime())) return;
        if (Utilities.formatDate(d, tz, 'HH:mm:ss') === '00:00:00') return;
        v[0] = Utilities.parseDate(Utilities.formatDate(d, scriptTz, 'yyyy-MM-dd'), tz, 'yyyy-MM-dd'); n++;
      });
      if (n) { rng.setValues(vals); rng.setNumberFormat('dd-mmm-yyyy'); }
      fixed[job[0] + ' ' + h] = n;
    });
  });
  markDirty_();
  Logger.log('Dates repaired: ' + JSON.stringify(fixed) + ' (script time zone ' + scriptTz + ', sheet time zone ' + tz + ')');
  return fixed;
}

function code_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (/^\d+(\.0+)?$/.test(s)) s = String(parseInt(s, 10));
  return s;
}

function codeCell_(s) {
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** Ratings from a form: exactly Q_ASKED answers 1-5, padded with blanks to Q_COUNT columns. null if incomplete. */
function asked_(arr) {
  var q = (Array.isArray(arr) ? arr : []).slice(0, Q_ASKED).map(rating_);
  if (q.length !== Q_ASKED || q.some(function (v) { return v === ''; })) return null;
  while (q.length < Q_COUNT) q.push('');
  return q;
}

function rating_(v) {
  var n = Number(v);
  return n >= 1 && n <= 5 && Math.round(n) === n ? n : '';
}

/* ------------------------------------------------------------------ auth */

function hash_(password, salt) {
  var h = salt + '|' + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function sign_(payload) {
  var sig = Utilities.computeHmacSha256Signature(payload, secret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function makeToken_(email) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: Date.now() + TOKEN_DAYS * 864e5 })).replace(/=+$/, '');
  return payload + '.' + sign_(payload);
}

function auth_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) throw new Error('AUTH: Please log in again.');
  var pad = parts[0] + '==='.slice((parts[0].length + 3) % 4);
  var info = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
  if (!info.x || info.x < Date.now()) throw new Error('AUTH: Your session expired. Please log in again.');
  var u = findUser_(info.e);
  if (!u || !u.active) throw new Error('AUTH: Your account is not active. Contact the admin.');
  return u;
}

function admin_(me) {
  if (me.role !== 'admin') throw new Error('Only an admin can do this.');
}

function editor_(me) {
  if (me.role === 'viewer') throw new Error('Your access is view-only.');
}

/** Understands the role however it is typed: admin; spoc / L&D SPOC; viewer / Head HR / COO / Branch, Regional or Ops Head; anything else = L&D (trainer). */
function roleOf_(v) {
  var r = String(v || '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (/spoc/.test(r)) return 'spoc';
  if (/viewer|view only|head|coo|hr/.test(r)) return 'viewer';
  return 'trainer';
}

function findUser_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  var t = table_(SH.US);
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    if (String(r[col_(t, 'Email')]).trim().toLowerCase() === email) {
      return {
        row: i + 2,
        name: String(r[col_(t, 'Name')]).trim(),
        email: email,
        role: roleOf_(r[col_(t, 'Role')]),
        active: String(r[col_(t, 'Active')]).trim().toLowerCase() !== 'no',
        access: optCol_(t, 'Access') >= 0 ? String(r[optCol_(t, 'Access')]).trim() : '',
        linkHash: optCol_(t, 'Link Key Hash') >= 0 ? String(r[optCol_(t, 'Link Key Hash')]) : '',
        hash: String(r[col_(t, 'Password Hash')]),
        salt: String(r[col_(t, 'Salt')]),
        newPassword: String(r[col_(t, 'New Password')])
      };
    }
  }
  return null;
}

/** Hashes any password typed into the "New Password" column, then clears it. */
function applyNewPasswords_() {
  var t = table_(SH.US), n = 0;
  var cNew = col_(t, 'New Password'), cHash = col_(t, 'Password Hash'), cSalt = col_(t, 'Salt');
  t.rows.forEach(function (r, i) {
    var pw = String(r[cNew] || '');
    if (pw) {
      var salt = Utilities.getUuid();
      t.sh.getRange(i + 2, cHash + 1).setValue(hash_(pw, salt));
      t.sh.getRange(i + 2, cSalt + 1).setValue(salt);
      t.sh.getRange(i + 2, cNew + 1).setValue('');
      n++;
    }
  });
  return n;
}

function login_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var key = 'fail_' + email;
  var fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('Too many wrong attempts. Wait 10 minutes and try again.');
  ensureCols_(SH.US, USER_COLS);
  var u = findUser_(email);
  if (u && u.newPassword) { withLock_(applyNewPasswords_); u = findUser_(email); }
  var ok = u && u.active && u.hash && u.salt && hash_(String(p.password || ''), u.salt) === u.hash;
  if (!ok) {
    cache.put(key, String(fails + 1), 600);
    throw new Error('Wrong email or password.');
  }
  cache.remove(key);
  return { ok: true, token: makeToken_(u.email), name: u.name, role: u.role, email: u.email };
}

/* ------------------------------------------------------------------ view links (one-click sign-in) */

function keyHash_(key) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'link|' + key, Utilities.Charset.UTF_8));
}

function linkLogin_(p) {
  var key = String(p.key || '').trim();
  if (key.length < 40) throw new Error('This link is not valid. Ask the admin for a new link.');
  var h = keyHash_(key);
  var t = table_(SH.US), c = optCol_(t, 'Link Key Hash');
  for (var i = 0; c >= 0 && i < t.rows.length; i++) {
    if (String(t.rows[i][c]) === h) {
      var u = findUser_(t.rows[i][col_(t, 'Email')]);
      if (!u || !u.active) throw new Error('This account is not active. Contact the admin.');
      return { ok: true, token: makeToken_(u.email), name: u.name, role: u.role, email: u.email };
    }
  }
  throw new Error('This link is no longer valid. Ask the admin for a new link.');
}

function makeLink_(p) {
  ensureCols_(SH.US, USER_COLS);
  var u = findUser_(p.email);
  if (!u) throw new Error('User not found. Save the user first.');
  var key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var t = table_(SH.US);
  t.sh.getRange(u.row, col_(t, 'Link Key Hash') + 1).setValue(keyHash_(key));
  return { ok: true, key: key };
}

function revokeLink_(p) {
  var u = findUser_(p.email);
  if (!u) throw new Error('User not found.');
  var t = table_(SH.US), c = optCol_(t, 'Link Key Hash');
  if (c >= 0) t.sh.getRange(u.row, c + 1).setValue('');
  return { ok: true };
}

/* ------------------------------------------------------------------ common feedback QR (one QR for all sessions) */
// The chauffeur enters code + name + mobile (checked against Chauffeurs), picks the L&D person and the module,
// and rates Q1-Q8. The ratings go onto their attendance row for that L&D + module in the last FB_MATCH_DAYS days.
// If the attendance is not entered yet, the feedback waits in the "Feedback Inbox" tab and is attached
// automatically when the session is saved (see addTraining_).

var FB_MATCH_DAYS = 7;
var INBOX_COLS = ['Received At', 'Code', 'Name', 'L&D', 'Module'].concat(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8']).concat(['Status', 'Entry ID', 'Mobile']);

function inbox_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.FI);
  if (!sh) { sh = ss.insertSheet(SH.FI); sh.getRange(1, 1, 1, INBOX_COLS.length).setValues([INBOX_COLS]); }
  return sh;
}

function digits_(v) { return String(v == null ? '' : v).replace(/\D/g, '').slice(-10); }
function firstWord_(v) { return String(v || '').trim().split(/\s+/)[0].toUpperCase(); }

/** Finds the chauffeur and checks the mobile (or, when the master has no mobile, the first name). */
function fbVerify_(p) {
  var code = code_(p.code);
  if (!code) throw new Error('FB_CODE');
  fbLimit_('fbv_' + code, 10, 3600);
  var ch = table_(SH.CH), cc = col_(ch, 'Code'), cn = col_(ch, 'Name'), cl = col_(ch, 'Location'), cm = optCol_(ch, 'Mobile');
  for (var i = 0; i < ch.rows.length; i++) {
    var r = ch.rows[i];
    if (code_(r[cc]) !== code) continue;
    var mob = cm >= 0 ? digits_(r[cm]) : '';
    var ok = mob.length === 10 ? digits_(p.mobile) === mob : firstWord_(p.name) !== '' && firstWord_(p.name) === firstWord_(r[cn]);
    if (!ok) throw new Error('FB_CODE');
    return { code: code, name: String(r[cn]).trim(), location: String(r[cl]).trim() };
  }
  throw new Error('FB_CODE');
}

/** Public: lists for the form's dropdowns (active L&D people and active modules). */
function fbOptions_() {
  var us = table_(SH.US);
  var trainers = us.rows.filter(function (r) {
    return String(r[col_(us, 'Name')]).trim() && String(r[col_(us, 'Active')]).trim().toLowerCase() !== 'no' && roleOf_(r[col_(us, 'Role')]) !== 'viewer' && roleOf_(r[col_(us, 'Role')]) !== 'admin';
  }).map(function (r) { return String(r[col_(us, 'Name')]).trim(); });
  // the admin can also train; add admin names too
  us.rows.forEach(function (r) { if (roleOf_(r[col_(us, 'Role')]) === 'admin' && String(r[col_(us, 'Name')]).trim() && String(r[col_(us, 'Name')]).trim().toLowerCase() !== 'admin') trainers.push(String(r[col_(us, 'Name')]).trim()); });
  if (trainers.indexOf('External Trainer') < 0) trainers.push('External Trainer');
  var mo = table_(SH.MO);
  var modules = mo.rows.filter(function (r) { return String(r[0]).trim() && String(r[col_(mo, 'Active')]).trim().toLowerCase() !== 'no'; }).map(function (r) { return String(r[0]).trim(); });
  return { ok: true, trainers: trainers.filter(function (t, i, a) { return a.indexOf(t) === i; }).sort(), modules: modules };
}

/** Public: step 1 of the form - confirm who the chauffeur is. Returns their name and location only. */
function fbCheck_(p) {
  var c = fbVerify_(p);
  return { ok: true, name: c.name, location: c.location };
}

/** Public: save ratings from the common form. */
function fbSubmitCommon_(p) {
  var c;
  try { c = fbVerify_(p); } catch (err) {
    if (!p.unverified || String(err.message) !== 'FB_CODE') throw err;
    return fbUnverified_(p);
  }
  var tr = String(p.trainer || '').trim(), mod = String(p.module || '').trim();
  if (!tr || !mod) throw new Error('FB_INCOMPLETE');
  var q = asked_(p.q);
  if (!q) throw new Error('FB_INCOMPLETE');
  var at = table_(SH.AT);
  var cId = col_(at, 'Entry ID'), cD = col_(at, 'Date'), cC = col_(at, 'Code'), cM = col_(at, 'Module'), cT = col_(at, 'Trainer');
  var Q = qHeaders_().map(function (h) { return col_(at, h); });
  var since = new Date(); since.setDate(since.getDate() - FB_MATCH_DAYS); var sinceIso = iso_(since), todayIso = iso_(new Date());
  var best = -1, bestDate = '', ratedRecently = false;
  at.rows.forEach(function (r, i) {
    if (code_(r[cC]) !== c.code) return;
    if (String(r[cM]).trim().toLowerCase() !== mod.toLowerCase() || String(r[cT]).trim().toLowerCase() !== tr.toLowerCase()) return;
    var d = iso_(r[cD]);
    if (d < sinceIso || d > todayIso) return;
    var rated = Q.some(function (k) { return rating_(r[k]) !== ''; });
    if (rated) { ratedRecently = true; return; }
    if (d > bestDate) { bestDate = d; best = i; }
  });
  if (best >= 0) {
    var first = Math.min.apply(null, Q), last = Math.max.apply(null, Q);
    if (last - first === Q_COUNT - 1) at.sh.getRange(best + 2, first + 1, 1, Q_COUNT).setValues([q]);
    else Q.forEach(function (k, j) { at.sh.getRange(best + 2, k + 1).setValue(q[j]); });
    return { ok: true, name: c.name, matched: true };
  }
  if (ratedRecently) throw new Error('FB_DONE');
  // no attendance yet: keep it in the inbox (one pending entry per chauffeur + L&D + module)
  var sh = inbox_();
  if (sh.getLastRow() >= 2) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, INBOX_COLS.length).getValues();
    var dupe = rows.some(function (r) { return code_(r[1]) === c.code && String(r[3]).trim().toLowerCase() === tr.toLowerCase() && String(r[4]).trim().toLowerCase() === mod.toLowerCase() && String(r[13]) === 'Pending'; });
    if (dupe) throw new Error('FB_DONE');
  }
  sh.appendRow([new Date(), codeCell_(c.code), c.name, tr, mod].concat(q, ['Pending', '']));
  return { ok: true, name: c.name, matched: false };
}

/** Feedback from someone not (yet) in the master: held as "Unverified" until the admin adds them. */
function fbUnverified_(p) {
  var code = code_(p.code), name = String(p.name || '').trim().toUpperCase().slice(0, 80);
  var tr = String(p.trainer || '').trim(), mod = String(p.module || '').trim();
  var q = asked_(p.q);
  if (!code || !name || !tr || !mod || !q) throw new Error('FB_INCOMPLETE');
  fbLimit_('fbu_' + code, 3, 86400);
  var sh = inbox_();
  if (sh.getLastColumn() < INBOX_COLS.length) sh.getRange(1, 1, 1, INBOX_COLS.length).setValues([INBOX_COLS]);
  sh.appendRow([new Date(), codeCell_(code), name, tr, mod].concat(q, ['Unverified', '', digits_(p.mobile)]));
  return { ok: true, name: name, matched: false, unverified: true };
}

/** Called while saving a session: fills ratings from pending inbox feedback for the same chauffeur + L&D + module. */
function attachInbox_(rows, at, trainer, module, dateIso) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.FI);
  if (!sh || sh.getLastRow() < 2) return 0;
  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 1, n, INBOX_COLS.length).getValues();
  var cC = col_(at, 'Code'), cId = col_(at, 'Entry ID');
  var Q = qHeaders_().map(function (h) { return col_(at, h); });
  var attached = 0, changed = false;
  rows.forEach(function (row) {
    for (var i = 0; i < n; i++) {
      var v = vals[i];
      if (String(v[13]) !== 'Pending') continue;
      if (code_(v[1]) !== code_(row[cC])) continue;
      if (String(v[3]).trim().toLowerCase() !== String(trainer).toLowerCase() || String(v[4]).trim().toLowerCase() !== String(module).toLowerCase()) continue;
      var rec = v[0] instanceof Date ? v[0] : new Date(v[0]);
      var gap = Math.abs((toDate_(dateIso) - new Date(rec.getFullYear(), rec.getMonth(), rec.getDate())) / 864e5);
      if (gap > FB_MATCH_DAYS) continue;
      Q.forEach(function (k, j) { row[k] = rating_(v[5 + j]); });
      v[13] = 'Matched'; v[14] = row[cId];
      attached++; changed = true;
      break;
    }
  });
  if (changed) sh.getRange(2, 1, n, INBOX_COLS.length).setValues(vals);
  return attached;
}

/* ------------------------------------------------------------------ chauffeur feedback links (QR / WhatsApp) */
// A trainer creates a link for the entries of one session. Chauffeurs open it on their phone (no login),
// pick their name, confirm with their chauffeur code and rate Q1-Q8. Ratings are written onto their
// attendance row. Links are random 12-character ids stored in the FeedbackLinks sheet and expire.

var FB_DAYS = 3;
var FB_COLS = ['Link ID', 'Created By', 'Created At', 'Expires', 'Entry IDs', 'Module', 'Date', 'L&D'];

function fbSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.FL);
  if (!sh) { sh = ss.insertSheet(SH.FL); sh.getRange(1, 1, 1, FB_COLS.length).setValues([FB_COLS]); }
  return sh;
}

function fbId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var out = '';
  for (var i = 0; i < 12; i++) out += chars.charAt(parseInt(hex.substr(i * 4, 4), 16) % chars.length);
  return out;
}

function makeFeedbackLink_(me, p) {
  var ids = (Array.isArray(p.ids) ? p.ids : []).map(String).filter(String);
  if (!ids.length) throw new Error('Select the entries of the session first.');
  if (ids.length > 300) throw new Error('Too many entries for one link (max 300).');
  var want = {}; ids.forEach(function (id) { want[id] = true; });
  var sc = scope_(me), locOf = {};
  if (sc) {
    var chs = table_(SH.CH), cc = col_(chs, 'Code'), cl = col_(chs, 'Location');
    chs.rows.forEach(function (r) { locOf[code_(r[cc])] = String(r[cl]).trim().toUpperCase(); });
  }
  var at = table_(SH.AT);
  var cId = col_(at, 'Entry ID'), cD = col_(at, 'Date'), cC = col_(at, 'Code'), cM = col_(at, 'Module'), cT = col_(at, 'Trainer'), cBy = col_(at, 'Entered By');
  var okIds = [], mods = {}, dates = {}, trs = {};
  at.rows.forEach(function (r) {
    var id = String(r[cId]);
    if (!want[id]) return;
    var mine = String(r[cBy]).trim().toLowerCase() === me.email || String(r[cT]).trim().toLowerCase() === me.name.toLowerCase();
    if (me.role !== 'admin' && (!mine || (sc && !sc[locOf[code_(r[cC])]]))) return;
    okIds.push(id);
    mods[String(r[cM]).trim()] = 1; dates[iso_(r[cD])] = 1; trs[String(r[cT]).trim()] = 1;
  });
  if (!okIds.length) throw new Error('None of the selected entries can be used (they must be yours or carry your name).');
  var id = fbId_();
  var exp = new Date(); exp.setDate(exp.getDate() + FB_DAYS);
  fbSheet_().appendRow([id, me.email, new Date(), exp, okIds.join(','), Object.keys(mods).join(' / '), Object.keys(dates).join(' / '), Object.keys(trs).join(' / ')]);
  return { ok: true, id: id, expires: iso_(exp), count: okIds.length, skipped: ids.length - okIds.length };
}

function fbLink_(linkId) {
  var key = String(linkId || '').trim();
  if (!/^[A-Za-z0-9]{12}$/.test(key)) throw new Error('FB_INVALID');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.FL);
  if (!sh || sh.getLastRow() < 2) throw new Error('FB_INVALID');
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, FB_COLS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === key) {
      var exp = rows[i][3];
      if (exp && new Date(exp).getTime() < Date.now()) throw new Error('FB_EXPIRED');
      return { ids: String(rows[i][4]).split(',').filter(String), module: String(rows[i][5]), date: String(rows[i][6]), trainer: String(rows[i][7]) };
    }
  }
  throw new Error('FB_INVALID');
}

function fbLimit_(key, max, seconds) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0);
  if (n >= max) throw new Error('FB_BUSY');
  cache.put(key, String(n + 1), seconds);
}

/** Public: the session behind a link - names only (no codes, no phone numbers). */
function fbSession_(p) {
  fbLimit_('fbs_' + String(p.s || '').slice(0, 12), 2000, 3600);
  var link = fbLink_(p.s);
  var want = {}; link.ids.forEach(function (id) { want[id] = true; });
  var chs = table_(SH.CH), cc = col_(chs, 'Code'), cn = col_(chs, 'Name'), cl = col_(chs, 'Location');
  var info = {};
  chs.rows.forEach(function (r) { info[code_(r[cc])] = { name: String(r[cn]).trim(), loc: String(r[cl]).trim() }; });
  var at = table_(SH.AT);
  var cId = col_(at, 'Entry ID'), cC = col_(at, 'Code');
  var Q = qHeaders_().map(function (h) { return col_(at, h); });
  var items = [], locs = {};
  at.rows.forEach(function (r) {
    var id = String(r[cId]);
    if (!want[id]) return;
    var c = info[code_(r[cC])] || { name: '?', loc: '' };
    locs[c.loc] = (locs[c.loc] || 0) + 1;
    items.push({ e: id, name: c.name, done: Q.some(function (q) { return rating_(r[q]) !== ''; }) });
  });
  items.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var loc = Object.keys(locs).sort(function (a, b) { return locs[b] - locs[a]; })[0] || '';
  return { ok: true, module: link.module, date: link.date, trainer: link.trainer, location: loc, items: items };
}

/** Public: save one chauffeur's ratings. The code must match the chauffeur on that entry. */
function fbSubmit_(p) {
  var link = fbLink_(p.s);
  var entry = String(p.e || '');
  if (link.ids.indexOf(entry) < 0) throw new Error('FB_INVALID');
  fbLimit_('fbw_' + p.s + '_' + entry, 6, 3600); // at most 6 tries per person per hour (wrong codes)
  var q = asked_(p.q);
  if (!q) throw new Error('FB_INCOMPLETE');
  var at = table_(SH.AT);
  var cId = col_(at, 'Entry ID'), cC = col_(at, 'Code');
  var Q = qHeaders_().map(function (h) { return col_(at, h); });
  for (var i = 0; i < at.rows.length; i++) {
    var r = at.rows[i];
    if (String(r[cId]) !== entry) continue;
    if (code_(r[cC]) !== code_(p.code)) throw new Error('FB_CODE');
    if (Q.some(function (c) { return rating_(r[c]) !== ''; })) throw new Error('FB_DONE');
    var first = Math.min.apply(null, Q), last = Math.max.apply(null, Q);
    if (last - first === Q_COUNT - 1) {
      at.sh.getRange(i + 2, first + 1, 1, Q_COUNT).setValues([q]);
    } else {
      Q.forEach(function (c, k) { at.sh.getRange(i + 2, c + 1).setValue(q[k]); });
    }
    return { ok: true };
  }
  throw new Error('FB_INVALID');
}

/* ------------------------------------------------------------------ feedback import (admin) */
// rows: [{id: 'H00012', q: [Q1..Q7]}]. clearAll = true empties Q1-Q8 on every attendance row first (full replace).
function importFeedback_(p) {
  var rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw new Error('The file has no feedback rows.');
  var at = table_(SH.AT), n = at.rows.length;
  if (!n) throw new Error('The Attendance sheet is empty.');
  var cId = col_(at, 'Entry ID');
  var Q = qHeaders_().map(function (h) { return col_(at, h); });
  var first = Math.min.apply(null, Q), last = Math.max.apply(null, Q);
  if (last - first !== Q_COUNT - 1) throw new Error('Q1-Q8 columns must be next to each other in the Attendance sheet.');
  var block = at.sh.getRange(2, first + 1, n, Q_COUNT).getValues();
  var idx = {}; at.rows.forEach(function (r, i) { idx[String(r[cId]).trim()] = i; });
  var cleared = 0;
  if (p.clearAll) block.forEach(function (b) { if (b.some(function (v) { return v !== '' && v !== null; })) cleared++; for (var k = 0; k < Q_COUNT; k++) b[k] = ''; });
  var written = 0, notFound = [], invalid = [];
  rows.forEach(function (x) {
    var id = String(x.id || '').trim();
    if (!(id in idx)) { notFound.push(id); return; }
    var q = asked_(x.q);
    if (!q) { invalid.push(id); return; }
    block[idx[id]] = q; written++;
  });
  at.sh.getRange(2, first + 1, n, Q_COUNT).setValues(block);
  return { ok: true, written: written, cleared: cleared, notFound: notFound, invalid: invalid };
}

/* ------------------------------------------------------------------ weekly master update */
// Admin uploads the latest master (parsed in the browser). Rows are matched by Code: new codes are added,
// existing ones get the non-empty fields from the file. Optionally, chauffeurs missing from the file are
// marked as left (DOL = leftDate) - never those whose Status is "Added from CCR" or who already have a DOL.
function syncMaster_(p) {
  var list = Array.isArray(p.rows) ? p.rows : [];
  if (!list.length) throw new Error('The file has no chauffeur rows.');
  if (list.length > 6000) throw new Error('Too many rows (max 6000).');
  // optional extra columns from the file (duty counts, incidents) are added to the sheet when missing
  var extraH = [];
  list.forEach(function (x) {
    if (!x || !x.extra) return;
    Object.keys(x.extra).forEach(function (h) { h = String(h).trim(); if (EXTRA_RE.test(h) && !/training/i.test(h) && h.length <= 40 && extraH.indexOf(h) < 0 && extraH.length < 12) extraH.push(h); });
  });
  var std = ['Code', 'Name', 'Chauffeur ID', 'Location', 'Driver Type', 'Status', 'DOJ', 'DOL', 'Category', 'Mobile'];
  ensureCols_(SH.CH, std.concat(extraH));
  var t = table_(SH.CH);
  var C = {}; std.concat(extraH).forEach(function (h) { C[h] = col_(t, h); });
  var width = t.width, rows = t.rows.map(function (r) { var x = r.slice(); while (x.length < width) x.push(''); return x; });
  var idx = {}; rows.forEach(function (r, i) { var c = code_(r[C.Code]); if (c) idx[c] = i; });
  var seen = {}, added = 0, updated = 0, unchanged = 0, left = 0, newCodes = {};
  var setIf = function (r, col, v) { if (v === undefined || v === null || v === '') return false; if (String(r[col]) === String(v)) return false; r[col] = v; return true; };
  list.forEach(function (x) {
    var code = code_(x.code);
    if (!code || seen[code]) return;
    seen[code] = true;
    var name = String(x.name || '').trim().toUpperCase();
    var doj = x.doj ? toDate_(x.doj) : null, dol = x.dol ? toDate_(x.dol) : null;
    var vals = {};
    vals[C.Name] = name; vals[C.Location] = String(x.location || '').trim().toUpperCase(); vals[C['Driver Type']] = String(x.type || '').trim();
    vals[C.Status] = String(x.status || '').trim(); vals[C.Category] = String(x.category || '').trim(); vals[C.Mobile] = String(x.mobile || '').replace(/\D/g, '').slice(-10);
    if (name) vals[C['Chauffeur ID']] = name + '__' + code;
    extraH.forEach(function (h) { var v = x.extra ? extraVal_(x.extra[h]) : ''; if (v !== '') vals[C[h]] = v; });
    if (code in idx) {
      var r = rows[idx[code]], changed = false;
      Object.keys(vals).forEach(function (k) { if (setIf(r, Number(k), vals[k])) changed = true; });
      if (doj && iso_(r[C.DOJ]) !== iso_(doj)) { r[C.DOJ] = doj; changed = true; }
      if (dol && iso_(r[C.DOL]) !== iso_(dol)) { r[C.DOL] = dol; changed = true; }
      if (String(r[C.Status]).trim() === 'Added from CCR' && vals[C.Status] === '') { r[C.Status] = 'Active'; changed = true; }
      changed ? updated++ : unchanged++;
    } else {
      if (!name) return;
      var nr = new Array(width); for (var k = 0; k < width; k++) nr[k] = '';
      nr[C.Code] = codeCell_(code);
      Object.keys(vals).forEach(function (k2) { nr[Number(k2)] = vals[k2]; });
      if (!nr[C.Status]) nr[C.Status] = 'Active';
      nr[C.DOJ] = doj || ''; nr[C.DOL] = dol || '';
      rows.push(nr); idx[code] = rows.length - 1; added++; newCodes[code] = true;
      promoteInbox_(code);
    }
  });
  if (p.markMissing) {
    var leftDate = toDate_(p.leftDate) || new Date();
    rows.forEach(function (r) {
      var c = code_(r[C.Code]);
      if (!c || seen[c] || String(r[C.Status]).trim() === 'Added from CCR' || iso_(r[C.DOL])) return;
      r[C.DOL] = leftDate; r[C.Status] = 'Left'; left++;
    });
  }
  if (rows.length) {
    t.sh.getRange(2, 1, rows.length, width).setValues(rows);
    t.sh.getRange(2, C.DOJ + 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy');
    t.sh.getRange(2, C.DOL + 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy');
  }
  var moved = promotePending_(newCodes);
  return { ok: true, added: added, updated: updated, unchanged: unchanged, left: left, pendingMoved: moved };
}

/** When a chauffeur is added to the master, their unverified feedback becomes pending (attached when the session is saved). */
function promoteInbox_(code) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.FI);
  if (!sh || sh.getLastRow() < 2) return 0;
  var n = sh.getLastRow() - 1, w = Math.max(sh.getLastColumn(), INBOX_COLS.length);
  var vals = sh.getRange(2, 1, n, w).getValues(), changed = 0;
  vals.forEach(function (v) { if (code_(v[1]) === code_(code) && String(v[13]) === 'Unverified') { v[13] = 'Pending'; changed++; } });
  if (changed) sh.getRange(2, 1, n, w).setValues(vals);
  return changed;
}

/** Admin: unverified feedback waiting for a decision. */
function listInbox_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.FI);
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };
  var n = sh.getLastRow() - 1, w = Math.max(sh.getLastColumn(), INBOX_COLS.length);
  var items = [];
  sh.getRange(2, 1, n, w).getValues().forEach(function (v, i) {
    if (String(v[13]) !== 'Unverified') return;
    items.push({ row: i + 2, received: iso_(v[0]), code: code_(v[1]), name: String(v[2]), trainer: String(v[3]), module: String(v[4]), mobile: String(v[15] || '') });
  });
  return { ok: true, items: items };
}

function dismissInbox_(p) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.FI);
  var row = Number(p.row);
  if (!sh || !(row >= 2) || row > sh.getLastRow()) throw new Error('Row not found.');
  if (String(sh.getRange(row, 14).getValue()) !== 'Unverified') throw new Error('This feedback is no longer waiting.');
  sh.getRange(row, 14).setValue('Rejected');
  return { ok: true };
}

/* ------------------------------------------------------------------ access scope */

/** Region name (upper case) -> list of locations, from the Regions sheet. */
function regions_() {
  var out = {};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.RG);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var name = String(r[0]).trim().toUpperCase();
    var locs = String(r[1]).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(String);
    if (name && locs.length) out[name] = locs; // rows without locations (notes) are ignored
  });
  return out;
}

/** Locations a user may see: null = everything. Admins and L&D (trainer) see everything;
 *  viewers and L&D SPOCs see only their Access (none if Access is empty). */
function scope_(u) {
  if (u.role !== 'viewer' && u.role !== 'spoc') return null;
  var a = String(u.access || '').trim();
  if (a.toUpperCase() === 'ALL') return null;
  var reg = regions_(), set = {};
  a.split(',').forEach(function (part) {
    var k = part.trim().toUpperCase();
    if (!k) return;
    if (reg[k]) reg[k].forEach(function (l) { set[l] = true; }); else set[k] = true;
  });
  return set;
}

/** Checks an Access value: "All", or a comma list of locations and/or region names. Returns the cleaned value. */
function checkAccess_(access) {
  var a = String(access || '').trim();
  if (!a) return '';
  if (a.toUpperCase() === 'ALL') return 'All';
  var reg = regions_(), locs = {};
  var ch = table_(SH.CH), cL = col_(ch, 'Location');
  ch.rows.forEach(function (r) { locs[String(r[cL]).trim().toUpperCase()] = true; });
  var parts = a.split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(String);
  var bad = parts.filter(function (k) { return !reg[k] && !locs[k]; });
  if (bad.length) throw new Error('Unknown location or region: ' + bad.join(', ') + '. Check the spelling, or add the region in the Regions tab.');
  return parts.join(', ');
}


function changePassword_(me, p) {
  if (!me.hash || hash_(String(p.oldPassword || ''), me.salt) !== me.hash) throw new Error('Current password is wrong.');
  var pw = String(p.newPassword || '');
  if (pw.length < 6) throw new Error('New password must be at least 6 characters.');
  setPassword_(me.row, pw);
  return { ok: true };
}

/* ------------------------------------------------------------------ forgot password */
// Step 1: a 6-digit code (valid 15 minutes) is emailed to the registered address. The reply is the same whether or
// not the email is registered, so nobody can use it to find out who has an account. At most 3 codes per hour.
// Step 2: the right code + a new password sets the password and signs the person in. 5 wrong codes = code void.
var RESET_MINUTES = 15;

function resetRequest_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter the email you sign in with.');
  var cache = CacheService.getScriptCache();
  var sent = Number(cache.get('rsent_' + email) || 0);
  if (sent >= 3) throw new Error('Too many codes asked for this email. Wait an hour, or ask the admin to reset your password.');
  cache.put('rsent_' + email, String(sent + 1), 3600);
  var reply = { ok: true, message: 'If this email is registered, a 6-digit code is on its way. Check your inbox (and spam). The code works for ' + RESET_MINUTES + ' minutes.' };
  var u = findUser_(email);
  if (!u || !u.active) return reply;
  var code = ('00000' + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000)).slice(-6);
  cache.put('rcode_' + email, hash_(code, 'reset|' + email), RESET_MINUTES * 60);
  cache.remove('rtry_' + email);
  var app = String(settings_()['App Name'] || 'CCR Chauffeur L&D Tracker');
  MailApp.sendEmail({
    to: email,
    name: app,
    subject: 'Your password reset code: ' + code,
    body: 'Hello ' + u.name + ',\n\nYour code to set a new password for ' + app + ' is:\n\n    ' + code + '\n\n' +
      'It works for ' + RESET_MINUTES + ' minutes. If you did not ask for this, ignore this email; your password stays the same.'
  });
  return reply;
}

function resetConfirm_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var code = String(p.code || '').replace(/\D/g, '');
  var pw = String(p.newPassword || '');
  var cache = CacheService.getScriptCache();
  var h = cache.get('rcode_' + email), tries = Number(cache.get('rtry_' + email) || 0);
  if (!h || tries >= 5) throw new Error('This code has expired. Ask for a new code.');
  if (hash_(code, 'reset|' + email) !== h) {
    cache.put('rtry_' + email, String(tries + 1), RESET_MINUTES * 60);
    throw new Error(tries + 1 >= 5 ? 'Too many wrong codes. Ask for a new code.' : 'Wrong code. Check the email and try again.');
  }
  if (pw.length < 6) throw new Error('New password must be at least 6 characters.');
  var u = findUser_(email);
  if (!u || !u.active) throw new Error('This account is not active. Contact the admin.');
  setPassword_(u.row, pw);
  cache.remove('rcode_' + email); cache.remove('rtry_' + email); cache.remove('fail_' + email);
  return { ok: true, token: makeToken_(u.email), name: u.name, role: u.role, email: u.email };
}

function setPassword_(row, pw) {
  var t = table_(SH.US);
  var salt = Utilities.getUuid();
  t.sh.getRange(row, col_(t, 'Password Hash') + 1).setValue(hash_(pw, salt));
  t.sh.getRange(row, col_(t, 'Salt') + 1).setValue(salt);
  t.sh.getRange(row, col_(t, 'New Password') + 1).setValue('');
}

/* ------------------------------------------------------------------ read */

function settings_() {
  var t = table_(SH.SE), out = {};
  t.rows.forEach(function (r) { if (r[0] !== '') out[String(r[0]).trim()] = r[1]; });
  return out;
}

var EXTRA_RE = /duty|incident/i;
/** Master columns beyond the standard ones that the app shows (duty counts, incidents), in sheet order. */
function extraCols_(t) {
  return Object.keys(t.head).filter(function (h) { return h && EXTRA_RE.test(h) && !/training/i.test(h); })
    .sort(function (a, b) { return t.head[a] - t.head[b]; }).slice(0, 12);
}
function extraVal_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isNaN(n) ? String(v).trim() : n;
}

function data_(me) {
  var s = settings_();
  var mo = table_(SH.MO);
  var modules = mo.rows.filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    return [String(r[col_(mo, 'Module')]).trim(), Number(r[col_(mo, 'Duration (mins)')]) || 0, String(r[col_(mo, 'Active')]).trim().toLowerCase() !== 'no'];
  });
  var fyStart = iso_(s['FY Start']) || '2026-04-01';
  var fyEndD = toDate_(fyStart); fyEndD.setFullYear(fyEndD.getFullYear() + 1); fyEndD.setDate(fyEndD.getDate() - 1);
  var fyEnd = iso_(fyEndD);
  var sc = scope_(me);
  var ch = table_(SH.CH);
  var C = ['Code', 'Name', 'Location', 'Driver Type', 'Status', 'DOJ', 'DOL', 'Category'].map(function (h) { return col_(ch, h); });
  // extra master columns shown in the Chauffeur Master view: mobile + any "Duty ..." / "Incident ..." columns
  var cMob = optCol_(ch, 'Mobile');
  var extraCols = extraCols_(ch);
  var chauffeurs = [], visible = {}, locOf = {}, inFy = {};
  ch.rows.forEach(function (r) {
    var code = code_(r[C[0]]);
    if (!code) return;
    var loc = String(r[C[2]]).trim(), dol = iso_(r[C[6]]);
    locOf[code] = loc;
    inFy[code] = !(dol && dol < fyStart);
    if (sc && !sc[loc.toUpperCase()]) return;
    visible[code] = true;
    chauffeurs.push([code, String(r[C[1]]).trim(), loc, String(r[C[3]]).trim(), String(r[C[4]]).trim(), iso_(r[C[5]]), dol, String(r[C[7]]).trim(),
      cMob >= 0 ? digits_(r[cMob]) : '',
      extraCols.map(function (h) { return extraVal_(r[ch.head[h]]); })]);
  });
  var at = table_(SH.AT);
  var A = ['Entry ID', 'Date', 'Code', 'Module', 'Trainer', 'Remarks'].map(function (h) { return col_(at, h); });
  var Q = qHeaders_().map(function (h) { return col_(at, h); });
  var cBy = col_(at, 'Entered By');
  var attendance = [], trainedFY = {};
  at.rows.forEach(function (r) {
    var id = String(r[A[0]]).trim();
    if (!id) return;
    var code = code_(r[A[2]]), d = iso_(r[A[1]]);
    if (d >= fyStart && d <= fyEnd) trainedFY[code] = true;
    if (sc && !visible[code]) return;
    attendance.push([id, iso_(r[A[1]]), code_(r[A[2]]), String(r[A[3]]).trim(), String(r[A[4]]).trim(), String(r[A[5]]).trim(),
      Q.map(function (q) { return rating_(r[q]); }), String(r[cBy]).trim().toLowerCase() === me.email ? 1 : 0]);
  });
  var us = table_(SH.US);
  var trainers = us.rows.filter(function (r) {
    // trainers and admins can deliver training; viewers (Head HR, COO, branch heads) cannot
    return String(r[col_(us, 'Name')]).trim() && String(r[col_(us, 'Active')]).trim().toLowerCase() !== 'no' && roleOf_(r[col_(us, 'Role')]) !== 'viewer';
  }).map(function (r) { return String(r[col_(us, 'Name')]).trim(); });
  // PAN-India coverage per location (counts only, no names) so scoped viewers still see their rank
  var cov = {};
  Object.keys(locOf).forEach(function (code) {
    if (!inFy[code]) return;
    var l = locOf[code];
    if (!cov[l]) cov[l] = [l, 0, 0];
    cov[l][1]++;
    if (trainedFY[code]) cov[l][2]++;
  });
  return {
    ok: true,
    me: { name: me.name, role: me.role, email: me.email, access: sc ? Object.keys(sc).sort() : 'All' },
    coverage: Object.keys(cov).sort().map(function (k) { return cov[k]; }),
    fyStart: fyStart,
    appName: String(s['App Name'] || 'Chauffeur Training Tracker'),
    modules: modules,
    trainers: trainers,
    chauffeurs: chauffeurs,
    chCols: extraCols,
    pending: listPending_(me),
    sheetSynced: PropertiesService.getScriptProperties().getProperty('mvStamp') || '',
    attendance: attendance,
    serverTime: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ write: attendance */

function addTraining_(me, p) {
  var date = toDate_(p.date);
  if (!date) throw new Error('Please pick a valid training date.');
  var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (date > tomorrow) throw new Error('The training date cannot be in the future.');
  var dateIso = iso_(p.date);
  var module = String(p.module || '').trim();
  var mo = table_(SH.MO);
  var mod = mo.rows.filter(function (r) { return String(r[0]).trim() === module; })[0];
  if (!mod) throw new Error('Unknown training module: ' + module);
  if (String(mod[col_(mo, 'Active')]).trim().toLowerCase() === 'no') throw new Error('This module is no longer in use: ' + module);
  var trainer = (me.role === 'admin' || me.role === 'spoc') && p.trainer ? String(p.trainer).trim() : me.name;
  var sc = scope_(me);
  var remarks = String(p.remarks || '').slice(0, 500);
  var entries = Array.isArray(p.entries) ? p.entries : [];
  if (!entries.length) throw new Error('Add at least one chauffeur.');
  if (entries.length > 300) throw new Error('Too many chauffeurs in one entry (max 300).');

  var ch = table_(SH.CH), known = {}, inMaster = {};
  var cLoc = col_(ch, 'Location');
  ch.rows.forEach(function (r) {
    var c0 = code_(r[col_(ch, 'Code')]);
    if (c0) inMaster[c0] = true;
    if (sc && !sc[String(r[cLoc]).trim().toUpperCase()]) return; // outside this SPOC's locations
    known[c0] = true;
  });
  var pend = [];
  var at = table_(SH.AT);
  var cD = col_(at, 'Date'), cC = col_(at, 'Code'), cM = col_(at, 'Module');
  var existing = {};
  at.rows.forEach(function (r) { existing[iso_(r[cD]) + '|' + code_(r[cC]) + '|' + String(r[cM]).trim()] = true; });

  var added = [], duplicates = [], unknown = [], seen = {}, newIds = [];
  var rows = [];
  var stamp = new Date();
  entries.forEach(function (en, i) {
    var code = code_(en && en.code);
    if (!code || seen[code]) return;
    seen[code] = true;
    if (!known[code]) {
      // not in the master at all: keep the session aside (not counted) until the chauffeur is added
      if (!inMaster[code] && p.keepUnknown !== false && /^[A-Z0-9-]{2,20}$/i.test(code)) pend.push({ code: code, name: String(en.name || '').trim().toUpperCase().slice(0, 80), q: en.q });
      else unknown.push(code);
      return;
    }
    if (existing[dateIso + '|' + code + '|' + module]) { duplicates.push(code); return; }
    var q = [];
    for (var k = 0; k < Q_COUNT; k++) q.push(rating_(en.q && en.q[k]));
    var row = new Array(at.width);
    for (var c = 0; c < at.width; c++) row[c] = '';
    row[col_(at, 'Entry ID')] = 'E' + stamp.getTime().toString(36) + '-' + i;
    row[cD] = date;
    row[cC] = codeCell_(code);
    row[cM] = module;
    row[col_(at, 'Trainer')] = trainer;
    row[col_(at, 'Remarks')] = remarks;
    qHeaders_().forEach(function (h, k) { row[col_(at, h)] = q[k]; });
    row[col_(at, 'Entered By')] = me.email;
    row[col_(at, 'Entered At')] = stamp;
    row[col_(at, 'Note')] = 'Web app';
    rows.push(row);
    added.push(code);
    newIds.push(row[col_(at, 'Entry ID')]);
  });
  var fromInbox = rows.length ? attachInbox_(rows, at, trainer, module, dateIso) : 0;
  if (rows.length) {
    var start = at.sh.getLastRow() + 1;
    at.sh.getRange(start, 1, rows.length, at.width).setValues(rows);
    at.sh.getRange(start, cD + 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy');
  }
  var pending = pend.length ? addPending_(me, pend, date, module, trainer, remarks) : { kept: [], duplicates: [] };
  return { ok: true, added: added, duplicates: duplicates.concat(pending.duplicates), unknown: unknown, pending: pending.kept, ids: newIds, feedbackAttached: fromInbox };
}

/* ------------------------------------------------------------------ Not in Master (pending sessions) */
var NM_COLS = ['Pending ID', 'Date', 'Code', 'Name', 'Module', 'Trainer', 'Remarks'].concat(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'], ['Entered By', 'Entered At', 'Status', 'Entry ID']);

function nmSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SH.NM);
  if (!sh) { sh = ss.insertSheet(SH.NM); sh.getRange(1, 1, 1, NM_COLS.length).setValues([NM_COLS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

function addPending_(me, list, date, module, trainer, remarks) {
  nmSheet_();
  var t = table_(SH.NM), C = {}; NM_COLS.forEach(function (h) { C[h] = col_(t, h); });
  var dateIso = iso_(date), have = {};
  t.rows.forEach(function (r) { if (String(r[C.Status]) === 'Pending') have[iso_(r[C.Date]) + '|' + code_(r[C.Code]) + '|' + String(r[C.Module]).trim()] = true; });
  var stamp = new Date(), rows = [], kept = [], dup = [];
  list.forEach(function (x, i) {
    if (have[dateIso + '|' + x.code + '|' + module]) { dup.push(x.code); return; }
    have[dateIso + '|' + x.code + '|' + module] = true;
    var row = new Array(t.width); for (var k = 0; k < t.width; k++) row[k] = '';
    row[C['Pending ID']] = 'P' + stamp.getTime().toString(36) + '-' + i;
    row[C.Date] = date; row[C.Code] = codeCell_(x.code); row[C.Name] = x.name; row[C.Module] = module; row[C.Trainer] = trainer; row[C.Remarks] = remarks;
    for (var q = 0; q < Q_COUNT; q++) row[C['Q' + (q + 1)]] = rating_(x.q && x.q[q]);
    row[C['Entered By']] = me.email; row[C['Entered At']] = stamp; row[C.Status] = 'Pending';
    rows.push(row); kept.push(x.code);
  });
  if (rows.length) {
    var start = t.sh.getLastRow() + 1;
    t.sh.getRange(start, 1, rows.length, t.width).setValues(rows);
    t.sh.getRange(start, C.Date + 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy');
  }
  return { kept: kept, duplicates: dup };
}

/** Moves pending sessions of the given codes ({code: true}) into Attendance. Returns how many moved. */
function promotePending_(codes) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.NM);
  if (!sh || sh.getLastRow() < 2 || !Object.keys(codes).length) return 0;
  var t = table_(SH.NM), C = {}; NM_COLS.forEach(function (h) { C[h] = col_(t, h); });
  var at = table_(SH.AT), aD = col_(at, 'Date'), aC = col_(at, 'Code'), aM = col_(at, 'Module');
  var existing = {};
  at.rows.forEach(function (r) { existing[iso_(r[aD]) + '|' + code_(r[aC]) + '|' + String(r[aM]).trim()] = true; });
  var vals = t.sh.getRange(2, 1, t.rows.length, t.width).getValues(), out = [], moved = 0, stamp = new Date();
  vals.forEach(function (r, i) {
    var code = code_(r[C.Code]);
    if (String(r[C.Status]) !== 'Pending' || !codes[code]) return;
    var key = iso_(r[C.Date]) + '|' + code + '|' + String(r[C.Module]).trim();
    if (existing[key]) { r[C.Status] = 'Already recorded'; return; }
    existing[key] = true;
    var row = new Array(at.width); for (var k = 0; k < at.width; k++) row[k] = '';
    var id = 'E' + stamp.getTime().toString(36) + '-p' + i;
    row[col_(at, 'Entry ID')] = id; row[aD] = r[C.Date]; row[aC] = codeCell_(code); row[aM] = String(r[C.Module]).trim();
    row[col_(at, 'Trainer')] = r[C.Trainer]; row[col_(at, 'Remarks')] = r[C.Remarks];
    qHeaders_().forEach(function (h) { row[col_(at, h)] = r[C[h]]; });
    row[col_(at, 'Entered By')] = r[C['Entered By']]; row[col_(at, 'Entered At')] = r[C['Entered At']];
    row[col_(at, 'Note')] = 'From Not in Master';
    out.push(row);
    r[C.Status] = 'Added'; r[C['Entry ID']] = id; moved++;
  });
  t.sh.getRange(2, 1, vals.length, t.width).setValues(vals);
  if (out.length) {
    var start = at.sh.getLastRow() + 1;
    at.sh.getRange(start, 1, out.length, at.width).setValues(out);
    at.sh.getRange(start, aD + 1, out.length, 1).setNumberFormat('dd-mmm-yyyy');
  }
  return moved;
}

/** Pending sessions shown in the app: admin sees all, L&D / SPOC see the ones they entered. */
function listPending_(me) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.NM);
  if (!sh || sh.getLastRow() < 2 || me.role === 'viewer') return [];
  var t = table_(SH.NM), C = {}; NM_COLS.forEach(function (h) { C[h] = optCol_(t, h); });
  return t.rows.filter(function (r) {
    return String(r[C.Status]) === 'Pending' && (me.role === 'admin' || String(r[C['Entered By']]).trim().toLowerCase() === me.email);
  }).map(function (r) {
    return [String(r[C['Pending ID']]), iso_(r[C.Date]), code_(r[C.Code]), String(r[C.Name]), String(r[C.Module]), String(r[C.Trainer]), String(r[C.Remarks]), String(r[C['Entered By']])];
  });
}

function dismissPending_(me, p) {
  var ids = {}; (Array.isArray(p.ids) ? p.ids : []).forEach(function (x) { ids[String(x)] = true; });
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.NM);
  if (!sh || sh.getLastRow() < 2) return { ok: true, dismissed: 0 };
  var t = table_(SH.NM), C = {}; NM_COLS.forEach(function (h) { C[h] = col_(t, h); });
  var vals = t.sh.getRange(2, 1, t.rows.length, t.width).getValues(), n = 0;
  vals.forEach(function (r) {
    if (!ids[String(r[C['Pending ID']])] || String(r[C.Status]) !== 'Pending') return;
    if (me.role !== 'admin' && String(r[C['Entered By']]).trim().toLowerCase() !== me.email) return;
    r[C.Status] = 'Dismissed'; n++;
  });
  if (n) t.sh.getRange(2, 1, vals.length, t.width).setValues(vals);
  return { ok: true, dismissed: n };
}

/** Edits L&D name, module, date and/or remarks on existing entries.
 *  Admin: any entry. L&D and SPOC: entries they entered or that carry their own name (SPOC: own locations only). */
function updateEntries_(me, p) {
  var ids = {};
  (Array.isArray(p.ids) ? p.ids : []).forEach(function (id) { ids[String(id)] = true; });
  var ch = p.changes || {};
  var newDate = null, newMod = null, newTr = null, newRem = null;
  if (ch.date) {
    newDate = toDate_(ch.date);
    if (!newDate) throw new Error('Pick a valid date.');
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (newDate > tomorrow) throw new Error('The training date cannot be in the future.');
  }
  if (ch.module) {
    var mo = table_(SH.MO);
    var ok = mo.rows.some(function (r) { return String(r[0]).trim() === String(ch.module).trim() && String(r[col_(mo, 'Active')]).trim().toLowerCase() !== 'no'; });
    if (!ok) throw new Error('Unknown or inactive module: ' + ch.module);
    newMod = String(ch.module).trim();
  }
  if (ch.trainer) newTr = String(ch.trainer).trim();
  if (typeof ch.remarks === 'string') newRem = ch.remarks.slice(0, 500);
  if (!newDate && !newMod && !newTr && newRem === null) throw new Error('Choose at least one thing to change.');

  var sc = scope_(me), locOf = {};
  if (sc) {
    var chs = table_(SH.CH), cc = col_(chs, 'Code'), cl = col_(chs, 'Location');
    chs.rows.forEach(function (r) { locOf[code_(r[cc])] = String(r[cl]).trim().toUpperCase(); });
  }
  var at = table_(SH.AT);
  var cId = col_(at, 'Entry ID'), cD = col_(at, 'Date'), cC = col_(at, 'Code'), cM = col_(at, 'Module'), cT = col_(at, 'Trainer'), cR = col_(at, 'Remarks'), cBy = col_(at, 'Entered By');
  var n = at.rows.length;
  if (!n) return { ok: true, updated: 0, refused: 0, duplicates: 0 };
  var keyOf = function (r) { return iso_(r[cD]) + '|' + code_(r[cC]) + '|' + String(r[cM]).trim(); };
  var taken = {};
  at.rows.forEach(function (r, i) { if (!ids[String(r[cId])]) taken[keyOf(r)] = i; });
  var D = at.rows.map(function (r) { return [r[cD]]; }), Mo = at.rows.map(function (r) { return [r[cM]]; });
  var T = at.rows.map(function (r) { return [r[cT]]; }), Re = at.rows.map(function (r) { return [r[cR]]; });
  var updated = 0, refused = 0, dup = 0;
  at.rows.forEach(function (r, i) {
    if (!ids[String(r[cId])]) return;
    var mine = String(r[cBy]).trim().toLowerCase() === me.email || String(r[cT]).trim().toLowerCase() === me.name.toLowerCase();
    if (me.role !== 'admin' && (!mine || (sc && !sc[locOf[code_(r[cC])]]))) { refused++; return; }
    var key = (newDate ? iso_(newDate) : iso_(r[cD])) + '|' + code_(r[cC]) + '|' + (newMod || String(r[cM]).trim());
    if (taken[key] !== undefined) { dup++; return; }
    taken[key] = i;
    if (newDate) D[i][0] = newDate;
    if (newMod) Mo[i][0] = newMod;
    if (newTr) T[i][0] = newTr;
    if (newRem !== null) Re[i][0] = newRem;
    updated++;
  });
  if (updated) {
    if (newDate) { at.sh.getRange(2, cD + 1, n, 1).setValues(D); at.sh.getRange(2, cD + 1, n, 1).setNumberFormat('dd-mmm-yyyy'); }
    if (newMod) at.sh.getRange(2, cM + 1, n, 1).setValues(Mo);
    if (newTr) at.sh.getRange(2, cT + 1, n, 1).setValues(T);
    if (newRem !== null) at.sh.getRange(2, cR + 1, n, 1).setValues(Re);
  }
  return { ok: true, updated: updated, refused: refused, duplicates: dup };
}

function deleteEntries_(me, p) {
  var ids = {};
  (Array.isArray(p.ids) ? p.ids : []).forEach(function (id) { ids[String(id)] = true; });
  var at = table_(SH.AT);
  var cId = col_(at, 'Entry ID'), cBy = col_(at, 'Entered By');
  var del = [], refused = 0;
  at.rows.forEach(function (r, i) {
    if (!ids[String(r[cId])]) return;
    if (me.role !== 'admin' && String(r[cBy]).trim().toLowerCase() !== me.email) { refused++; return; }
    del.push(i + 2);
  });
  del.sort(function (a, b) { return b - a; }).forEach(function (row) { at.sh.deleteRow(row); });
  return { ok: true, deleted: del.length, refused: refused };
}

/* ------------------------------------------------------------------ write: admin */

function saveChauffeur_(p) {
  var c = p.chauffeur || {};
  var code = code_(c.code);
  if (!code) throw new Error('Chauffeur code is required.');
  if (!String(c.name || '').trim()) throw new Error('Chauffeur name is required.');
  var t = table_(SH.CH), cCode = col_(t, 'Code');
  var idx = -1;
  t.rows.forEach(function (r, i) { if (code_(r[cCode]) === code) idx = i; });
  if (p.isNew && idx >= 0) throw new Error('Code ' + code + ' already exists.');
  if (!p.isNew && idx < 0) throw new Error('Code ' + code + ' not found.');
  var row = idx >= 0 ? t.rows[idx].slice() : new Array(t.width).map(function () { return ''; });
  for (var k = 0; k < t.width; k++) if (row[k] === undefined) row[k] = '';
  var name = String(c.name).trim().toUpperCase();
  row[cCode] = codeCell_(code);
  row[col_(t, 'Name')] = name;
  row[col_(t, 'Chauffeur ID')] = name + '__' + code;
  row[col_(t, 'Location')] = String(c.location || '').trim().toUpperCase();
  row[col_(t, 'Driver Type')] = String(c.type || '').trim();
  row[col_(t, 'Status')] = String(c.status || 'Active').trim();
  row[col_(t, 'DOJ')] = toDate_(c.doj) || '';
  row[col_(t, 'DOL')] = toDate_(c.dol) || '';
  row[col_(t, 'Category')] = String(c.category || '').trim();
  if (optCol_(t, 'Mobile') >= 0 && c.mobile !== undefined) row[col_(t, 'Mobile')] = digits_(c.mobile);
  var r0 = idx >= 0 ? idx + 2 : t.sh.getLastRow() + 1;
  t.sh.getRange(r0, 1, 1, t.width).setValues([row]);
  var promoted = p.isNew ? promoteInbox_(code) : 0;
  var one = {}; one[code] = true;
  var moved = promotePending_(one);
  return { ok: true, feedbackPending: promoted, pendingMoved: moved };
}

/** Changes a chauffeur code everywhere (e.g. NOID-001 -> real code). */
function replaceCode_(p) {
  var from = code_(p.from), to = code_(p.to);
  if (!from || !to || from === to) throw new Error('Give the old and the new code.');
  var ch = table_(SH.CH), cCode = col_(ch, 'Code');
  var iFrom = -1, iTo = -1;
  ch.rows.forEach(function (r, i) { var c = code_(r[cCode]); if (c === from) iFrom = i; if (c === to) iTo = i; });
  if (iFrom < 0) throw new Error('Code ' + from + ' not found.');
  var at = table_(SH.AT), aC = col_(at, 'Code'), moved = 0;
  if (at.rows.length) {
    var codes = at.sh.getRange(2, aC + 1, at.rows.length, 1).getValues();
    codes.forEach(function (r) { if (code_(r[0]) === from) { r[0] = codeCell_(to); moved++; } });
    at.sh.getRange(2, aC + 1, at.rows.length, 1).setValues(codes);
  }
  var merged = false;
  if (iTo >= 0) {
    ch.sh.deleteRow(iFrom + 2);
    merged = true;
  } else {
    var name = String(ch.rows[iFrom][col_(ch, 'Name')]).trim();
    ch.sh.getRange(iFrom + 2, cCode + 1).setValue(codeCell_(to));
    ch.sh.getRange(iFrom + 2, col_(ch, 'Chauffeur ID') + 1).setValue(name + '__' + to);
  }
  return { ok: true, moved: moved, merged: merged };
}

function listUsers_() {
  ensureCols_(SH.US, USER_COLS);
  var t = table_(SH.US);
  return {
    ok: true,
    users: t.rows.filter(function (r) { return String(r[col_(t, 'Name')]).trim() || String(r[col_(t, 'Email')]).trim(); }).map(function (r) {
      return {
        name: String(r[col_(t, 'Name')]).trim(),
        email: String(r[col_(t, 'Email')]).trim().toLowerCase(),
        role: roleOf_(r[col_(t, 'Role')]),
        active: String(r[col_(t, 'Active')]).trim().toLowerCase() !== 'no',
        access: optCol_(t, 'Access') >= 0 ? String(r[optCol_(t, 'Access')]).trim() : '',
        hasPassword: !!String(r[col_(t, 'Password Hash')]),
        hasLink: optCol_(t, 'Link Key Hash') >= 0 && !!String(r[optCol_(t, 'Link Key Hash')])
      };
    }),
    regions: regions_()
  };
}

/** Many users at once (Admin upload). Each row goes through saveUser_, so the same checks apply; a bad row is
 *  reported and skipped, the others are saved. Existing emails are updated, new ones added. */
function saveUsers_(me, p) {
  var list = Array.isArray(p.users) ? p.users : [];
  if (!list.length) throw new Error('The file has no users.');
  if (list.length > 300) throw new Error('Too many users in one file (max 300).');
  var added = 0, updated = 0, errors = [];
  list.forEach(function (u, i) {
    try {
      var existed = !!findUser_(u && u.email);
      saveUser_(me, { user: u });
      if (existed) updated++; else added++;
    } catch (e) {
      errors.push({ row: (u && u.row) || i + 2, email: String((u && u.email) || ''), error: String(e.message || e) });
    }
  });
  return { ok: true, added: added, updated: updated, errors: errors };
}

function saveUser_(me, p) {
  var u = p.user || {};
  var email = String(u.email || '').trim().toLowerCase();
  var name = String(u.name || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!name) throw new Error('Enter the person\'s name.');
  var role = roleOf_(u.role);
  var scoped = role === 'viewer' || role === 'spoc';
  var access = scoped ? checkAccess_(u.access) : 'All';
  if (scoped && !access) throw new Error('For a viewer or L&D SPOC, enter Access: All, a region, or locations separated by commas.');
  ensureCols_(SH.US, USER_COLS);
  var t = table_(SH.US), idx = -1, blank = -1;
  t.rows.forEach(function (r, i) {
    var e = String(r[col_(t, 'Email')]).trim().toLowerCase();
    if (e === email) idx = i;
    if (blank < 0 && !e && String(r[col_(t, 'Name')]).trim().toLowerCase() === name.toLowerCase()) blank = i;
  });
  if (idx < 0) idx = blank;
  if (email === me.email && (role !== 'admin' || u.active === false)) throw new Error('You cannot remove your own admin access.');
  var rowNum = idx >= 0 ? idx + 2 : t.sh.getLastRow() + 1;
  t.sh.getRange(rowNum, col_(t, 'Name') + 1).setValue(name);
  t.sh.getRange(rowNum, col_(t, 'Email') + 1).setValue(email);
  t.sh.getRange(rowNum, col_(t, 'Role') + 1).setValue(role);
  t.sh.getRange(rowNum, col_(t, 'Access') + 1).setValue(access);
  t.sh.getRange(rowNum, col_(t, 'Active') + 1).setValue(u.active === false ? 'No' : 'Yes');
  if (u.password) {
    if (String(u.password).length < 6) throw new Error('Password must be at least 6 characters.');
    setPassword_(rowNum, String(u.password));
  }
  return { ok: true };
}

function saveModule_(p) {
  var m = p.module || {};
  var name = String(m.name || '').trim();
  var dur = Number(m.duration);
  if (!name) throw new Error('Module name is required.');
  if (!(dur > 0 && dur <= 1440)) throw new Error('Duration must be between 1 and 1440 minutes.');
  var t = table_(SH.MO), idx = -1;
  t.rows.forEach(function (r, i) { if (String(r[0]).trim() === name) idx = i; });
  var rowNum = idx >= 0 ? idx + 2 : t.sh.getLastRow() + 1;
  t.sh.getRange(rowNum, 1, 1, 3).setValues([[name, dur, m.active === false ? 'No' : 'Yes']]);
  return { ok: true };
}

/** Moves every attendance of one module to another (e.g. DARK Hour Edition -> Defensive Driving Training). */
function mergeModule_(p) {
  var from = String(p.from || '').trim(), to = String(p.to || '').trim();
  if (!from || !to || from === to) throw new Error('Pick two different modules.');
  var mo = table_(SH.MO), iFrom = -1, iTo = -1;
  mo.rows.forEach(function (r, i) { var n = String(r[0]).trim(); if (n === from) iFrom = i; if (n === to) iTo = i; });
  if (iTo < 0) throw new Error('Module not found: ' + to);
  var at = table_(SH.AT), cM = col_(at, 'Module'), moved = 0;
  if (at.rows.length) {
    var vals = at.sh.getRange(2, cM + 1, at.rows.length, 1).getValues();
    vals.forEach(function (r) { if (String(r[0]).trim() === from) { r[0] = to; moved++; } });
    at.sh.getRange(2, cM + 1, at.rows.length, 1).setValues(vals);
  }
  if (iFrom >= 0) mo.sh.getRange(iFrom + 2, 3).setValue('No');
  return { ok: true, moved: moved };
}

function saveSettings_(p) {
  var fy = toDate_(p.fyStart);
  if (!fy) throw new Error('Pick a valid FY start date.');
  var t = table_(SH.SE), idx = -1;
  t.rows.forEach(function (r, i) { if (String(r[0]).trim() === 'FY Start') idx = i; });
  var rowNum = idx >= 0 ? idx + 2 : t.sh.getLastRow() + 1;
  t.sh.getRange(rowNum, 1, 1, 2).setValues([['FY Start', fy]]);
  return { ok: true };
}

/* ------------------------------------------------------------------ Master View tab (the sheet's own copy of the app's Chauffeur Master) */
// Rebuilt from Chauffeurs + Attendance + Modules: one row per chauffeur, FY training summary and a count per module.
// A 10-minute trigger (installAutoSync) rebuilds it when something changed - from the app or by editing the sheet -
// and once a day so "Days Since Last Training" stays current. Do not type in this tab: it is overwritten.
var MV_SHEET = 'Master View';
var MV_WRITES = { addTraining: 1, updateEntries: 1, deleteEntries: 1, saveChauffeur: 1, replaceCode: 1, saveModule: 1, mergeModule: 1, syncMaster: 1, saveSettings: 1 };

function markDirty_() { PropertiesService.getScriptProperties().setProperty('mvDirty', '1'); }

/** Simple trigger: a hand edit in a data tab also refreshes the Master View on the next run. */
function onEdit(e) {
  try {
    var n = e && e.range ? e.range.getSheet().getName() : '';
    if (n === SH.CH || n === SH.AT || n === SH.MO || n === SH.SE) markDirty_();
  } catch (err) { /* never block an edit */ }
}

/** Time trigger target: rebuild when flagged, or when the last build was on an earlier day. */
function syncMasterViewIfDirty() {
  var pr = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  if (pr.getProperty('mvDirty') !== '1' && pr.getProperty('mvBuilt') === today) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { rebuildMasterView_(); } finally { lock.releaseLock(); }
}

/** Run once from the Apps Script editor (select installAutoSync, click Run) to switch on automatic sync. */
function installAutoSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncMasterViewIfDirty') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncMasterViewIfDirty').timeBased().everyMinutes(10).create();
  var r = rebuildMasterView_();
  Logger.log('Auto sync on. Master View built: ' + r.rows + ' chauffeurs.');
}

function rebuildMasterView_() {
  var pr = PropertiesService.getScriptProperties();
  pr.setProperty('mvDirty', '');
  var st = settings_();
  var fyStart = iso_(st['FY Start']) || '2026-04-01';
  var fyEndD = toDate_(fyStart); fyEndD.setFullYear(fyEndD.getFullYear() + 1); fyEndD.setDate(fyEndD.getDate() - 1);
  var fyEnd = iso_(fyEndD);
  var mo = table_(SH.MO), dur = {}, mods = [];
  mo.rows.forEach(function (r) {
    var n = String(r[col_(mo, 'Module')]).trim(); if (!n) return;
    dur[n] = Number(r[col_(mo, 'Duration (mins)')]) || 0;
    mods.push({ name: n, active: String(r[col_(mo, 'Active')]).trim().toLowerCase() !== 'no' });
  });
  // FY attendance per chauffeur
  var at = table_(SH.AT), aD = col_(at, 'Date'), aC = col_(at, 'Code'), aM = col_(at, 'Module'), aI = col_(at, 'Entry ID');
  var sum = {}, used = {};
  at.rows.forEach(function (r) {
    if (!String(r[aI]).trim()) return;
    var d = iso_(r[aD]); if (!d || d < fyStart || d > fyEnd) return;
    var c = code_(r[aC]), m = String(r[aM]).trim();
    var x = sum[c] || (sum[c] = { n: 0, mins: 0, first: '', last: '', mods: {} });
    x.n++; x.mins += dur[m] || 0; x.mods[m] = (x.mods[m] || 0) + 1; used[m] = 1;
    if (!x.first || d < x.first) x.first = d;
    if (!x.last || d > x.last) x.last = d;
  });
  var modCols = mods.filter(function (m) { return m.active || used[m.name]; }).map(function (m) { return m.name; });
  var ch = table_(SH.CH);
  var g = function (r, h) { var i = optCol_(ch, h); return i < 0 ? '' : r[i]; };
  var extra = extraCols_(ch);
  var head = ['Location', 'Chauffeur Code', 'Chauffeur Name', 'Mobile No.', 'Driver Type', 'Status'].concat(extra,
    ['DOJ', 'DOL', 'Category', 'In FY Scope?', 'Training Count (FY)', 'First Training (FY)', 'Last Training (FY)', 'Days Since Last Training', 'Manhours (FY)'], modCols);
  var today = toDate_(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
  var out = [], bg = [];
  var base = 6 + extra.length; // index of DOJ
  ch.rows.forEach(function (r) {
    var code = code_(g(r, 'Code')); if (!code) return;
    var dol = iso_(g(r, 'DOL')), inFy = !(dol && dol < fyStart);
    var x = sum[code] || { n: 0, mins: 0, first: '', last: '', mods: {} };
    var row = [String(g(r, 'Location')).trim(), codeCell_(code), String(g(r, 'Name')).trim(), digits_(g(r, 'Mobile')), String(g(r, 'Driver Type')).trim(), String(g(r, 'Status')).trim()]
      .concat(extra.map(function (h) { return extraVal_(r[ch.head[h]]); }),
        [toDate_(iso_(g(r, 'DOJ'))) || '', toDate_(dol) || '', String(g(r, 'Category')).trim() || 'No Category', inFy ? 'Yes' : 'No', x.n,
          toDate_(x.first) || '', toDate_(x.last) || '', x.last ? Math.round((today - toDate_(x.last)) / 864e5) : '', Math.round(x.mins / 6) / 10],
        modCols.map(function (m) { return x.mods[m] || ''; }));
    out.push(row);
    var b = row.map(function () { return null; });
    if (inFy && !x.n) b[base + 4] = '#f6d6d2';
    modCols.forEach(function (m, i) { if (x.mods[m]) b[base + 9 + i] = '#dcefdc'; });
    if (!inFy) b = b.map(function () { return '#eeeeee'; });
    bg.push(b);
  });
  // sort by location then name, keeping each row's colours with it
  var items = out.map(function (row, i) { return { row: row, b: bg[i] }; });
  items.sort(function (p, q) { return String(p.row[0]).localeCompare(String(q.row[0])) || String(p.row[2]).localeCompare(String(q.row[2])); });
  out = items.map(function (it) { return it.row; });
  bg = items.map(function (it) { return it.b; });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MV_SHEET) || ss.insertSheet(MV_SHEET);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#d6001c').setFontColor('#ffffff').setWrap(true);
  if (out.length) {
    var rng = sh.getRange(2, 1, out.length, head.length);
    rng.setValues(out);
    rng.setBackgrounds(bg);
    [base + 1, base + 2, base + 6, base + 7].forEach(function (c) { sh.getRange(2, c, out.length, 1).setNumberFormat('dd-mmm-yyyy'); });
  }
  sh.setFrozenRows(1); sh.setFrozenColumns(3);
  sh.getRange(1, 1, Math.max(out.length + 1, 2), head.length).createFilter();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm') + ' IST';
  sh.getRange(1, 1).setNote('Built automatically from Chauffeurs, Attendance and Modules. Last built ' + stamp + '. Do not edit this tab: it is overwritten.');
  pr.setProperty('mvBuilt', Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
  pr.setProperty('mvStamp', stamp);
  return { ok: true, rows: out.length, built: stamp };
}
