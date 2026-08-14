/**
 * ============================================================================
 *  BUSINESS BREAKFAST — The AI Compass · Inschrijvingen-backend
 * ----------------------------------------------------------------------------
 *  Wat dit script doet (gekoppeld aan een Google Sheet):
 *   1. Ontvangt inschrijvingen van de landingspagina (doPost)
 *   2. Bewaakt de capaciteit: max. 6 plaatsen per sessie — vol is vol
 *   3. Schrijft elke inschrijving als rij in het tabblad "Inschrijvingen"
 *   4. Stuurt de deelnemer een bevestigingsmail mét agenda-uitnodiging (.ics)
 *   5. Stuurt jou een notificatie per inschrijving (met stand van de teller)
 *   6. Optioneel: stuurt elke lead door naar GoHighLevel (inbound webhook)
 *   7. Geeft de live bezetting terug aan de pagina (doGet ?action=availability)
 *
 *  Installatie: zie SETUP-GIDS.md (5 minuten).
 *  Handmatige inschrijving toevoegen? Voeg gewoon een rij toe in de sheet met
 *  de juiste sessie-code in kolom B (bv. 2026-09-10) — die telt automatisch mee.
 * ============================================================================
 */

var CONFIG = {
  SHEET_NAME: 'Inschrijvingen',

  // Meldingen voor jou:
  NOTIFY_EMAIL: 'thierry@aicompass.ai',

  // Bevestigingsmail naar de deelnemer:
  SEND_CONFIRMATION: true,
  SENDER_NAME: 'Thierry Moubax — AI Compass',
  REPLY_TO: 'thierry@aicompass.ai',

  // GoHighLevel/Rainmaker-koppeling: elke inschrijving wordt als contact (met tags)
  // in het CRM gezet via de API. De token staat NIET in deze code maar in
  // Projectinstellingen → Scriptversheimen ("Script properties") onder de sleutel GHL_TOKEN.
  GHL_LOCATION_ID: '7JCSAkytJkcWButQOduL',
  // Alternatief (niet nodig als GHL_TOKEN is ingesteld): een Inbound-Webhook-URL.
  GHL_WEBHOOK_URL: '',

  // Sessies + capaciteit + locatie. Datum sluiten? Zet cap op 0. Extra datum?
  // Voeg een regel toe (en zet dezelfde code ook in de landingspagina).
  // icsStart/icsEnd staan in UTC: 06:00Z = 08:00 Belgische zomertijd.
  SESSIONS: {
    '2026-09-10': { label: 'donderdag 10 september 2026 — Mechelen', cap: 6,
                    venue: 'Van der Valk Hotel Mechelen', adres: 'Rode-Kruisplein 1, 2800 Mechelen',
                    icsStart: '20260910T060000Z', icsEnd: '20260910T083000Z' },
    '2026-09-11': { label: 'vrijdag 11 september 2026 — Antwerpen', cap: 6,
                    venue: 'Van der Valk Hotel Antwerpen', adres: 'Luitenant Lippenslaan 66, 2140 Antwerpen',
                    icsStart: '20260911T060000Z', icsEnd: '20260911T083000Z' },
    '2026-09-17': { label: 'donderdag 17 september 2026 — Brugge (Oostkamp)', cap: 6,
                    venue: 'Van der Valk Hotel Brugge-Oostkamp', adres: 'Kapellestraat 146, 8020 Oostkamp',
                    icsStart: '20260917T060000Z', icsEnd: '20260917T083000Z' },
    '2026-09-18': { label: 'vrijdag 18 september 2026 — Mechelen', cap: 6,
                    venue: 'Van der Valk Hotel Mechelen', adres: 'Rode-Kruisplein 1, 2800 Mechelen',
                    icsStart: '20260918T060000Z', icsEnd: '20260918T083000Z' },
    'wachtlijst': { label: 'wachtlijst', cap: null }
  }
};

var HEADERS = ['Tijdstip', 'Sessie', 'Datum', 'Voornaam', 'Achternaam', 'Bedrijf', 'Functie', 'E-mail', 'GSM', 'Opmerkingen', 'Bron'];

/* ============================== ENDPOINTS ============================== */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'availability') {
    return json_({ ok: true, availability: availability_() });
  }
  return json_({ ok: true, service: 'Business Breakfast inschrijvingen', hint: 'gebruik ?action=availability' });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'ongeldig verzoek' });
  }

  // Honeypot: bots vullen het verborgen veld in → stil laten "slagen".
  if (data.website) return json_({ ok: true });

  var session = String(data.session || '').trim();
  var sess = CONFIG.SESSIONS[session];
  var voornaam = clean_(data.voornaam), achternaam = clean_(data.achternaam);
  var bedrijf = clean_(data.bedrijf), functie = clean_(data.functie);
  var email = clean_(data.email).toLowerCase(), gsm = clean_(data.gsm);
  var opmerkingen = clean_(data.opmerkingen), bron = clean_(data.bron) || 'landingspagina';

  if (!sess) return json_({ ok: false, error: 'onbekende sessie' });
  if (!voornaam || !achternaam || !bedrijf || !email || email.indexOf('@') < 0) {
    return json_({ ok: false, error: 'verplichte velden ontbreken' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // voorkomt dubbele boeking van de laatste plaats
  var result;
  try {
    var sheet = getSheet_();
    var counts = counts_(sheet);
    var count = counts[session] || 0;

    if (sess.cap !== null && count >= sess.cap) {
      result = { ok: false, reason: 'full', availability: availability_(counts) };
    } else if (isDuplicate_(sheet, session, email)) {
      result = { ok: true, duplicate: true, availability: availability_(counts) };
    } else {
      sheet.appendRow([new Date(), session, sess.label, voornaam, achternaam, bedrijf, functie, email, gsm, opmerkingen, bron]);
      SpreadsheetApp.flush();
      counts[session] = count + 1;
      result = { ok: true, availability: availability_(counts) };
    }
  } finally {
    lock.releaseLock();
  }

  if (result.ok) {
    var reg = { session: session, label: sess.label, voornaam: voornaam, achternaam: achternaam,
                bedrijf: bedrijf, functie: functie, email: email, gsm: gsm,
                opmerkingen: opmerkingen, bron: bron };
    try { if (CONFIG.SEND_CONFIRMATION && !result.duplicate) sendConfirmation_(reg); } catch (err) { log_('bevestiging mislukt: ' + err); }
    try { if (!result.duplicate) notifyOwner_(reg, result.availability); } catch (err) { log_('notificatie mislukt: ' + err); }
    try { if (!result.duplicate) pushToGhl_(reg); } catch (err) { log_('GHL-koppeling mislukt: ' + err); }
  }

  return json_(result);
}

/* ============================== KERN ============================== */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function counts_(sheet) {
  var counts = {};
  var last = sheet.getLastRow();
  if (last < 2) return counts;
  var vals = sheet.getRange(2, 2, last - 1, 1).getValues(); // kolom B = Sessie
  for (var i = 0; i < vals.length; i++) {
    var id = String(vals[i][0]).trim();
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function isDuplicate_(sheet, session, email) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var vals = sheet.getRange(2, 2, last - 1, 7).getValues(); // B..H (Sessie..E-mail)
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === session && String(vals[i][6]).trim().toLowerCase() === email) return true;
  }
  return false;
}

function availability_(countsOpt) {
  var counts = countsOpt || counts_(getSheet_());
  var out = {};
  for (var id in CONFIG.SESSIONS) {
    if (id === 'wachtlijst') continue;
    var s = CONFIG.SESSIONS[id];
    var c = counts[id] || 0;
    out[id] = { label: s.label, count: c, cap: s.cap, full: s.cap !== null && c >= s.cap };
  }
  return out;
}

/* ============================== E-MAILS ============================== */

function sendConfirmation_(reg) {
  var isWaitlist = reg.session === 'wachtlijst';
  var subject = isWaitlist
    ? 'Je staat op de wachtlijst — Business Breakfast · The AI Compass'
    : 'Bevestigd: Business Breakfast ' + reg.label + ' · The AI Compass';

  var sess = CONFIG.SESSIONS[reg.session] || {};
  var praktisch = isWaitlist ? '' :
    '<table cellpadding="0" cellspacing="0" style="margin:18px 0;border-left:3px solid #e8a838;background:#faf6ef;width:100%"><tr><td style="padding:14px 18px;font:14px/1.7 Arial,sans-serif;color:#0c1a2e">' +
    '<strong>' + cap_(reg.label) + '</strong><br>' +
    'Onthaal vanaf 8u00 &middot; sessie van 8u30 tot 10u30<br>' +
    sess.venue + ' &mdash; ' + sess.adres + '<br>' +
    'Parkeren kan aan het hotel &middot; koffie &amp; verse croissants voorzien</td></tr></table>';

  var body = isWaitlist
    ? '<p>Beste ' + esc_(reg.voornaam) + ',</p>' +
      '<p>Alle tafels van de septemberreeks zijn op dit moment volzet — maar je staat op de wachtlijst. ' +
      'Zodra er een plaats vrijkomt of er nieuwe datums bijkomen, hoor jij het als eerste.</p>' +
      '<p>Tot binnenkort!</p>'
    : '<p>Beste ' + esc_(reg.voornaam) + ',</p>' +
      '<p>Je plaats aan tafel is gereserveerd. Fijn dat je erbij bent!</p>' +
      praktisch +
      '<p>In bijlage vind je de agenda-uitnodiging. Het blijft bewust intiem — maximaal zes CEO’s per tafel — ' +
      'en je gaat niet met lege handen naar huis: je persoonlijk gesigneerd exemplaar van <em>The AI Compass</em> ligt klaar.</p>' +
      '<p>Lukt het toch niet? Laat het me even weten (gewoon antwoorden op deze mail), dan geef ik je stoel aan iemand op de wachtlijst.</p>' +
      '<p>Tot dan!</p>';

  var html =
    '<div style="font:15px/1.7 Arial,sans-serif;color:#1c2b3a;max-width:560px">' + body +
    '<p style="margin-top:26px">Hartelijke groet,<br><strong>Thierry Moubax</strong><br>' +
    'Auteur van <em>The AI Compass</em> &middot; CEO &amp; co-founder AI Compass<br>' +
    '+32 472 180 365 &middot; <a href="https://www.aicompass.ai" style="color:#007BDC">aicompass.ai</a></p></div>';

  var options = { htmlBody: html, name: CONFIG.SENDER_NAME, replyTo: CONFIG.REPLY_TO };

  if (!isWaitlist) {
    var s = CONFIG.SESSIONS[reg.session];
    options.attachments = [Utilities.newBlob(ics_(reg, s), 'text/calendar', 'business-breakfast.ics')];
  }
  MailApp.sendEmail(Object.assign({ to: reg.email, subject: subject }, options));
}

function notifyOwner_(reg, availability) {
  var isWaitlist = reg.session === 'wachtlijst';
  var stand = '';
  if (!isWaitlist && availability && availability[reg.session]) {
    var a = availability[reg.session];
    stand = ' · plaats ' + a.count + '/' + a.cap + (a.full ? ' → VOLZET' : '');
  }
  var subject = (isWaitlist ? 'Wachtlijst: ' : 'Nieuwe inschrijving: ') +
    reg.voornaam + ' ' + reg.achternaam + ' (' + reg.bedrijf + ') → ' + reg.label + stand;

  var rows = [
    ['Sessie', reg.label], ['Naam', reg.voornaam + ' ' + reg.achternaam],
    ['Bedrijf', reg.bedrijf], ['Functie', reg.functie || '—'],
    ['E-mail', reg.email], ['GSM', reg.gsm || '—'],
    ['Opmerkingen', reg.opmerkingen || '—'], ['Bron', reg.bron]
  ].map(function (r) {
    return '<tr><td style="padding:5px 14px 5px 0;color:#54657c;white-space:nowrap">' + r[0] + '</td><td style="padding:5px 0;color:#0b2447"><strong>' + esc_(r[1]) + '</strong></td></tr>';
  }).join('');

  var overzicht = '';
  if (availability) {
    overzicht = '<p style="margin-top:18px;color:#54657c">Stand van de tellers:<br>' +
      Object.keys(availability).map(function (id) {
        var a = availability[id];
        return a.label + ': <strong>' + a.count + '/' + a.cap + '</strong>' + (a.full ? ' (volzet)' : '');
      }).join('<br>') + '</p>';
  }

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: subject,
    htmlBody: '<div style="font:14px/1.7 Arial,sans-serif"><table cellpadding="0" cellspacing="0">' + rows + '</table>' + overzicht +
      '<p style="color:#54657c">Alle inschrijvingen: open je Google Sheet → tabblad "' + CONFIG.SHEET_NAME + '".</p></div>',
    name: 'Business Breakfast — inschrijvingen'
  });
}

/* ============================== INTEGRATIES ============================== */

function pushToGhl_(reg) {
  var tags = ['business-breakfast', 'boek-launch', reg.session];

  // Voorkeursroute: rechtstreeks via de API (Private Integration-token in Script properties).
  var token = PropertiesService.getScriptProperties().getProperty('GHL_TOKEN');
  if (token) {
    var resp = UrlFetchApp.fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, Version: '2021-07-28' },
      payload: JSON.stringify({
        locationId: CONFIG.GHL_LOCATION_ID,
        firstName: reg.voornaam,
        lastName: reg.achternaam,
        email: reg.email,
        phone: reg.gsm || null,
        companyName: reg.bedrijf,
        source: 'Business Breakfast landingspagina',
        tags: tags
      }),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) log_('GHL-upsert antwoordde ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
    return;
  }

  // Alternatief: inbound webhook (als er geen token is ingesteld).
  if (!CONFIG.GHL_WEBHOOK_URL) return;
  UrlFetchApp.fetch(CONFIG.GHL_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      first_name: reg.voornaam,
      last_name: reg.achternaam,
      email: reg.email,
      phone: reg.gsm,
      company_name: reg.bedrijf,
      job_title: reg.functie,
      notes: reg.opmerkingen,
      source: 'Business Breakfast landingspagina',
      tags: tags,
      session: reg.session,
      session_label: reg.label
    }),
    muteHttpExceptions: true
  });
}

/**
 * Eenmalig uitvoeren na het instellen van GHL_TOKEN: zet Peter Pintens
 * (eerste inschrijving, vr 18/9 Mechelen) als getagd contact in het CRM.
 */
function syncPeterNaarCrm() {
  pushToGhl_({
    session: '2026-09-18', label: CONFIG.SESSIONS['2026-09-18'].label,
    voornaam: 'Peter', achternaam: 'Pintens', bedrijf: 'La Lorraine Bakery Group',
    functie: 'VP Marketing', email: 'p.pintens@llbg.com', gsm: '+32473610411',
    opmerkingen: '', bron: 'e-mail (eerste inschrijving)'
  });
  console.log('Klaar — controleer het contact in Rainmaker (Contacts).');
}

/* ============================== HELPERS ============================== */

function ics_(reg, s) {
  var uid = reg.session + '-' + reg.email.replace(/[^a-z0-9]/g, '') + '@aicompass.ai';
  var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Compass//Business Breakfast//NL', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + stamp,
    'DTSTART:' + s.icsStart,
    'DTEND:' + s.icsEnd,
    'SUMMARY:Business Breakfast — The AI Compass (Thierry Moubax)',
    'LOCATION:' + (s.venue + ', ' + s.adres).replace(/,/g, '\\,'),
    'DESCRIPTION:Onthaal vanaf 8u00 · sessie 8u30–10u30 · max. 6 CEO’s per tafel.\\nJe gesigneerd exemplaar van The AI Compass ligt klaar.\\nVragen? thierry@aicompass.ai · +32 472 180 365',
    'STATUS:CONFIRMED',
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Morgen: Business Breakfast — The AI Compass', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function clean_(v) { return v == null ? '' : String(v).trim().slice(0, 500); }
function esc_(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function cap_(v) { return v.charAt(0).toUpperCase() + v.slice(1); }
function log_(m) { console.error(m); }

/* ============================== TESTS ============================== */

/**
 * Kies deze functie in de editor en klik "Run" om jezelf een testbevestiging
 * (mét agenda-bijlage) te sturen. De eerste keer vraagt Google om toestemming.
 */
function stuurTestmail() {
  sendConfirmation_({
    session: '2026-09-10', label: CONFIG.SESSIONS['2026-09-10'].label,
    voornaam: 'Test', achternaam: 'Deelnemer', bedrijf: 'AI Compass',
    functie: 'CEO', email: CONFIG.NOTIFY_EMAIL, gsm: '', opmerkingen: '', bron: 'test'
  });
}

/** Toont de huidige tellers in het logvenster. */
function toonBezetting() {
  console.log(JSON.stringify(availability_(), null, 2));
}
