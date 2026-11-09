/**
 * Shalom PG – resident details Google Forms
 *
 * Creates ONE Google Form for the PG owner below, with its own response spreadsheet.
 * Residents fill in their own basic details; the money fields (rent, deposit,
 * maintenance, due day, paid up to) are NOT on the form — they are extra columns
 * in the response sheet that only the owner fills in.
 *
 * When the sheet is ready: File → Download → Microsoft Excel (.xlsx), then in
 * Shalom PG: Residents → Import from Excel. The column names already match the app.
 *
 * How to run: script.google.com → New project → paste this file → select
 * `createForm` → Run → allow access → open View → Logs (or Execution log) for the links.
 */

// The owner and their houses, exactly as named in the app (the house names must match for the import).
// For Karunakar instead, use: houses: ['Francis Court', 'Kodikal', 'Kottara', 'Ladies', 'Mahima', 'Safal', 'Shiva']
const OWNER = {
  owner: 'Blossom',
  houses: ['Anugraha', 'Green House', 'Nandana', 'Pais Mansion', 'Pereira L PG', 'Pink House', 'Shishira', 'Whitehouse'],
};

// Same lists the app uses.
const ID_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving licence', 'Voter ID', 'College / office ID', 'Other'];
const REMINDER_CHOICES = ['WhatsApp', 'Email', 'Both'];

// Owner-only columns added to the response sheet (filled by the owner, never by residents).
const OWNER_COLUMNS = ['Monthly rent', 'Deposit', 'Maintenance', 'Maintenance type', 'Due day', 'Paid up to'];

// Indian mobile: 10 digits starting 6–9; allows +91 / 0 prefix and a space or dash in the middle.
const MOBILE_PATTERN = '^(\\+?91[ -]?|0)?[6-9][0-9]{4}[ -]?[0-9]{5}$';

function createForm() {
  Logger.log('\n' + createFormFor_(OWNER))
}

function createFormFor_(cfg) {
  const title = `Shalom PG – Resident details (${cfg.owner})`;
  const form = FormApp.create(title);
  form
    .setDescription(
      'Please fill in your details for our records. It takes about 2 minutes.\n' +
      'Fields marked * are required. Your information is seen only by the PG owner.',
    )
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false)
    .setProgressBar(false)
    .setConfirmationMessage('Thank you! Your details were sent to the PG owner.');

  // ---- About you ----
  form.addListItem()
    .setTitle('House')
    .setHelpText('Which PG house are you staying in?')
    .setChoiceValues(cfg.houses)
    .setRequired(true);

  form.addTextItem()
    .setTitle('Name')
    .setHelpText('Full name, as on your ID')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Please enter your full name (up to 120 characters).')
      .requireTextLengthLessThanOrEqualTo(120)
      .build());

  form.addTextItem()
    .setTitle('Mobile')
    .setHelpText('10-digit mobile number. Rent reminders come here on WhatsApp.')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Enter a valid 10-digit Indian mobile number, e.g. 98765 43210')
      .requireTextMatchesPattern(MOBILE_PATTERN)
      .build());

  form.addTextItem()
    .setTitle('Email')
    .setHelpText('Optional')
    .setRequired(false)
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Please enter a valid email address, or leave it empty.')
      .requireTextIsEmail()
      .build());

  form.addTextItem()
    .setTitle('Occupation')
    .setHelpText('Optional, e.g. student at…, works at…')
    .setRequired(false);

  // ---- Your stay ----
  form.addSectionHeaderItem().setTitle('Your stay');

  form.addDateItem()
    .setTitle('Moved in')
    .setHelpText('The date you moved in (or will move in)')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Room')
    .setHelpText('Optional, if you know your room / bed number')
    .setRequired(false);

  // ---- Safety ----
  form.addSectionHeaderItem().setTitle('ID & emergency contact');

  form.addListItem()
    .setTitle('ID type')
    .setHelpText('Which ID will you show the owner? (Please do not type your ID number here.)')
    .setChoiceValues(ID_TYPES)
    .setRequired(false);

  form.addTextItem()
    .setTitle('Emergency contact')
    .setHelpText('Name of a parent or guardian')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Emergency phone')
    .setHelpText('Their 10-digit mobile number')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Enter a valid 10-digit Indian mobile number')
      .requireTextMatchesPattern(MOBILE_PATTERN)
      .build());

  form.addMultipleChoiceItem()
    .setTitle('Reminders')
    .setHelpText('How should we send your rent reminders? (Optional, WhatsApp if left empty)')
    .setChoiceValues(REMINDER_CHOICES)
    .setRequired(false);

  form.addCheckboxItem()
    .setTitle('Consent')
    .setChoiceValues(['I agree that the PG owner may store these details for my stay and send me rent reminders.'])
    .setRequired(true);

  // ---- Response spreadsheet with owner-only money columns ----
  const ss = SpreadsheetApp.create(`${title} – responses`);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  Utilities.sleep(3000); // give Google a moment to create the "Form Responses" tab

  const sheet = SpreadsheetApp.openById(ss.getId()).getSheets().find((s) => s.getFormUrl()) || ss.getSheets()[0];
  const firstOwnerCol = sheet.getLastColumn() + 1;
  const header = sheet.getRange(1, firstOwnerCol, 1, OWNER_COLUMNS.length);
  header.setValues([OWNER_COLUMNS])
    .setBackground('#fff3e3')
    .setFontWeight('bold')
    .setNote('Owner only: fill these in yourself before importing into Shalom PG.');

  const rows = 1000;
  const col = (name) => sheet.getRange(2, firstOwnerCol + OWNER_COLUMNS.indexOf(name), rows, 1);
  const number = (min) => SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(min).setAllowInvalid(false).build();
  col('Monthly rent').setDataValidation(number(1)).setNumberFormat('#,##0');
  col('Deposit').setDataValidation(number(0)).setNumberFormat('#,##0');
  col('Maintenance').setDataValidation(number(0)).setNumberFormat('#,##0');
  col('Maintenance type').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['One-time', 'Monthly'], true).setAllowInvalid(false).build());
  col('Due day').setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberBetween(1, 30).setAllowInvalid(false)
      .setHelpText('Day of the month rent is due: 1–30').build());
  col('Paid up to').setNumberFormat('@').setNote(
    'Optional. For people who joined a while back: last month already paid, e.g. Oct 2026. Leave empty if nothing is paid yet.');

  sheet.setFrozenRows(1);
  // Remove the empty default tab if Google created one.
  ss.getSheets().filter((s) => s.getSheetId() !== sheet.getSheetId() && s.getLastRow() === 0).forEach((s) => ss.deleteSheet(s));

  const formLink = form.shortenFormUrl(form.getPublishedUrl());
  return `${cfg.owner}\n  Form to send residents: ${formLink}\n  Responses sheet (keep private): ${ss.getUrl()}`;
}
