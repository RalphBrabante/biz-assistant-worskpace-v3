const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { TaxReturnError } = require('./bir-tax-return');
const { drawTin, TIN_LAYOUTS } = require('./bir-pdf-layout');

const black = rgb(0, 0, 0);
const asciiLabel = value => String(value ?? '').replace(/[–—]/g, '-').replace(/·/g, '|').replace(/₱/g, 'PHP ');
const templates = { '1701Q': '1701Q-january-2018.pdf', '1702Q': '1702Q-january-2018.pdf', '1601EQ': '1601EQ-january-2019.pdf', '2307': '2307-january-2018.pdf' };

function writer(pages, font) {
  function text(page, value, x, top, width = 560, size = 10, min = 6) {
    const content = asciiLabel(value).toUpperCase();
    try { font.encodeText(content); } catch { throw new TaxReturnError('Use the registered Latin spelling for names and addresses in this PDF.'); }
    const fit = content ? Math.min(size, width / font.widthOfTextAtSize(content, 1)) : size;
    if (fit < min) throw new TaxReturnError('A detail is too long to fit legibly on this BIR form.');
    pages[page].drawText(content, { x, y: pages[page].getHeight() - top - fit, size: fit, font, color: black });
  }
  function cells(page, value, firstCenter, top, step = 15.16, count) {
    const content = String(value);
    if (count && content.length > count) throw new TaxReturnError('An amount or detail exceeds the available boxes on the official BIR form.');
    [...content].forEach((digit, i) => text(page, digit, firstCenter + i * step - font.widthOfTextAtSize(digit, 10) / 2, top, step));
  }
  function whole(page, value, top, lastCenter = 586.6, count = 12, step = 15.16) {
    const content = String(value);
    cells(page, content, lastCenter - (content.length - 1) * step, top, step, count);
  }
  function decimal(page, value, top, firstFractionCenter = 571.72, decimalX = 549.1, step = 14.53, count = 10) {
    const [integer, fraction] = Math.abs(value).toFixed(2).split('.');
    const content = value < 0 ? '-' + integer : integer;
    cells(page, content, decimalX - (content.length - .5) * step, top, step, count);
    cells(page, fraction, firstFractionCenter, top, step);
  }
  function tick(page, x, top) { text(page, 'X', x + 2, top, 10); }
  return { text, cells, whole, decimal, tick };
}

async function renderReportDocumentPdf(data) {
  if (!templates[data.id]) return renderSchedulePdf(data);
  const template = await PDFDocument.load(await fs.readFile(path.join(__dirname, '../../assets/bir', templates[data.id])));
  const document = await PDFDocument.create();
  // Isolate the original page's graphics/clipping state inside a vector form.
  // Some BIR templates leave clipping active at the end of their content stream.
  const backgrounds = await document.embedPages(template.getPages());
  for (const background of backgrounds) document.addPage([background.width, background.height]).drawPage(background);
  const font = await document.embedFont(StandardFonts.CourierBold);
  const pages = document.getPages(), v = data.values, c = data.computed;
  const { text, cells, whole, decimal, tick } = writer(pages, font);
  if (data.id === '1701Q') {
    cells(0, data.year, 95, 96, 14.3);
    tick(0, [189, 233, 291][data.quarter - 1], 96);
    tick(0, v.amended ? 422.8 : 465, 96);
    drawTin(pages[0], font, v.tin, TIN_LAYOUTS['1701Q'][0]); cells(0, v.rdoCode, 541, 128.5, 15.5);
    tick(0, { business: 116.5, profession: 220.5, estate: 322.5, trust: 409 }[v.activity], 146);
    const eight = v.incomeTaxElection === 'eight_percent';
    tick(0, v.mixedIncome ? 464.5 : v.activity === 'profession' ? 302 : 155.5, eight ? 176 : 162);
    // Estate and trust use graduated rates, with the selected filer type.
    text(0, v.registeredName, 21, 205, 567);
    text(0, v.registeredAddress, 21, 233, 567);
    text(0, v.zipCode, 540, 247, 48);
    cells(0, v.dateOfBirth ? v.dateOfBirth.slice(5, 7) + v.dateOfBirth.slice(8, 10) + v.dateOfBirth.slice(0, 4) : '', 24, 276, 13.2);
    text(0, v.email, 132, 276, 456); text(0, v.citizenship, 21, 302, 218);
    tick(0, 550, 305); // no foreign tax credits
    tick(0, 60.5, eight ? 353 : 330);
    if (!eight) tick(0, v.deductionMethod === 'osd' ? 358.5 : 227.5, 330);
    [c.taxDue, c.credits, c.stillPayable, c.penalties, c.totalPayable].forEach((value, i) => whole(0, value, 589 + i * 15.95, 469, 8, 15.05));
    whole(0, c.totalPayable, 669);
    drawTin(pages[1], font, v.tin, TIN_LAYOUTS['1701Q'][1]); text(1, v.registeredName, 213, 100.8, 377, 9);
    const line = (value, top) => whole(1, value, top, 468.6, 8, 15.05);
    if (!eight) {
      const rows = [[v.sales, 164], [v.deductionMethod === 'osd' ? 0 : v.costSales, 180], [c.grossIncome, 196],
        [v.deductionMethod === 'itemized' ? c.deduction : 0, 224], [v.deductionMethod === 'osd' ? c.deduction : 0, 249],
        [c.currentIncome, 265], [v.priorIncome, 282], [v.otherIncome, 298], [v.gppIncome, 314], [c.taxableIncome, 330], [c.taxDue, 346]];
      rows.forEach(([value, top]) => line(value, top)); text(1, v.otherIncomeDescription, 170, 298, 175, 7);
    } else {
      [v.sales, v.otherIncome, c.currentIncome, v.priorGrossIncome, c.cumulativeGross, c.reduction, c.taxableIncome, c.taxDue].forEach((value, i) => line(value, [378, 394, 410, 426, 442, 459, 475, 491][i]));
      text(1, v.otherIncomeDescription, 170, 394, 175, 7);
    }
    [v.priorYearCredits, v.priorPayments, v.priorWithholding, v.currentWithholding, v.previousPayment, 0, v.otherCredits, c.credits].forEach((value, i) => line(value, 523 + i * 15.96));
    text(1, v.otherCreditsDescription, 175, 619, 169, 7);
    line(c.stillPayable, 654);
    [v.surcharge, v.interest, v.compromise, c.penalties].forEach((value, i) => line(value, 686 + i * 15.96));
    line(c.totalPayable, 753);
  } else if (data.id === '1702Q') {
    tick(0, 48.5, 123); cells(0, '12', 40.5, 149.5, 13.38); cells(0, String(data.year).slice(2), 89.22, 149.5, 12.84);
    tick(0, [154.5, 183.5, 211.5][data.quarter - 1], 139); tick(0, v.amended ? 255.8 : 299.5, 139);
    if (c.mcitApplicable && c.mcit > c.normalTax) tick(0, 561.5, 131);
    else { text(0, 'IC010', 355, 144, 35, 8); text(0, 'DOMESTIC CORPORATION', 407, 144, 143, 8); tick(0, 561.5, 144); }
    drawTin(pages[0], font, v.tin, TIN_LAYOUTS['1702Q'][0]); cells(0, v.rdoCode, 541, 181, 15.2);
    const registeredName = String(v.registeredName).toUpperCase();
    if (registeredName.length > 76) throw new TaxReturnError('Registered name exceeds the 76 boxes on 1702Q.');
    cells(0, registeredName.slice(0, 38), 25.6, 209, 15.16); cells(0, registeredName.slice(38), 25.6, 226, 15.16);
    text(0, v.registeredAddress, 24, 261, 562); text(0, v.zipCode, 542, 278, 48);
    text(0, v.phone, 24, 307, 152); text(0, v.email, 190, 307, 395);
    tick(0, v.deductionMethod === 'osd' ? 351 : 135, 326); tick(0, 220.5, 345);
    [Math.max(c.normalTax, c.mcit), v.excessMcitCredit, c.taxDue, 0, c.taxDue, c.credits, c.stillPayable,
      v.surcharge, v.interest, v.compromise, c.penalties, c.totalPayable].forEach((value, i) => whole(0, value, 382 + i * 19.4));
    drawTin(pages[1], font, v.tin, TIN_LAYOUTS['1702Q'][1]); text(1, v.registeredName, 237, 94, 351, 9);
    [v.sales, v.costSales, c.grossIncome, v.otherIncome, c.totalGrossIncome, c.deduction, c.currentIncome, v.priorIncome, c.taxableIncome].forEach((value, i) => whole(1, value, 381.8 + i * 17.1));
    cells(1, v.corporateRate, 556, 536, 15.16);
    [c.normalTax, c.mcit, Math.max(c.normalTax, c.mcit)].forEach((value, i) => whole(1, value, [553, 570, 588][i]));
    [1, 2, 3].forEach((q, i) => { if (q <= data.quarter) whole(1, v[`grossIncomeQ${q}`], 621 + i * 17.1); });
    whole(1, c.mcitGrossIncome, 673); whole(1, c.mcit, 709);
    [v.priorYearCredits, v.priorPayments, v.priorMcitPayments, v.priorWithholding, v.currentWithholding, v.previousPayment].forEach((value, i) => whole(1, value, 743 + i * 17.1));
    whole(1, v.otherCredits, 855); text(1, v.otherCreditsDescription, 42, 855, 358, 8); whole(1, 0, 872); whole(1, c.credits, 892);
    text(2, `CURRENT COMPUTATION: REGULAR ${v.corporateRate}% | MCIT 2% IF APPLICABLE | RR 5-2021`, 23, 12, 564, 8);
  } else if (data.id === '1601EQ') {
    if (c.groups.length > 6) throw new TaxReturnError('The official 1601-EQ has six computation rows. More ATC/rate groups require a separately prepared continuation attachment.');
    cells(0, data.year, 37, 117, 14.2); tick(0, [116.5, 160, 203, 248][data.quarter - 1], 114);
    tick(0, v.amended ? 305 : 349, 114); tick(0, c.taxDue > 0 ? 405 : 449, 114);
    // This template uses grouped TIN cells separated by slash cells.
    drawTin(pages[0], font, v.tin, { centers: [243.5, 257.7, 271.9, 300.3, 314.5, 328.7, 357.1, 371.3, 385.5, 413.9, 428.1, 442.3, 456.5, 470.7], top: 146.5 });
    cells(0, v.rdoCode, 557, 146.5, 14.2);
    text(0, v.registeredName, 23, 175, 565); text(0, v.registeredAddress, 23, 205, 565);
    text(0, v.zipCode, 535, 220, 54); text(0, v.phone, 23, 252, 248); text(0, v.email, 110, 266, 478);
    tick(0, v.agentCategory === 'private' ? 448 : 520, 238.5);
    c.groups.forEach((group, i) => {
      const top = 299.5 + i * 17.45;
      cells(0, group.atc, 39, top, 14.5); decimal(0, group.base, top, 297.53, 275.93, 14.3); text(0, group.rate.toFixed(2), 340, top, 44);
      decimal(0, group.tax, top);
    });
    [c.taxDue, v.firstMonthRemittance, v.secondMonthRemittance, v.previousPayment, v.overRemittance, v.otherCredits,
      c.credits, c.stillPayable, v.surcharge, v.interest, v.compromise, c.penalties, c.totalPayable].forEach((value, i) => decimal(0, value, 404 + i * 17.45));
  } else if (data.id === '2307') {
    const groups = c.groups;
    const descriptions = groups.map(group => {
      const lines = []; let line = '';
      for (const character of asciiLabel(group.description)) {
        if (font.widthOfTextAtSize(line + character, 8) > 147) { lines.push(line); line = character; } else line += character;
      }
      lines.push(line); return lines;
    });
    if (descriptions.reduce((n, lines) => n + lines.length, 0) > 10) throw new TaxReturnError('The 2307 income-payment descriptions exceed its ten rows. Prepare separate certificates for additional ATCs.');
    const date = value => value.slice(5, 7) + value.slice(8, 10) + value.slice(0, 4);
    cells(0, date(data.periodStart), 158, 107, 13.15); cells(0, date(data.periodEnd), 406, 107, 13.15);
    const tinCenters = [213.7, 226.8, 239.9, 266.2, 279.4, 292.5, 318.8, 332, 345.1, 371.4, 384.5, 397.7, 410.8, 424];
    drawTin(pages[0], font, v.payeeTin, { centers: tinCenters, top: 138.5 });
    drawTin(pages[0], font, v.tin, { centers: tinCenters, top: 254 });
    text(0, v.payeeName, 37, 165, 549); text(0, v.payeeAddress, 37, 194, 496); text(0, v.payeeZip, 545, 194, 42, 9);
    text(0, v.registeredName, 37, 280, 549); text(0, v.registeredAddress, 37, 309, 496); text(0, v.zipCode, 545, 309, 42, 9);
    const number = (value, x, top, width) => text(0, value.toFixed(2), x + Math.max(0, width - font.widthOfTextAtSize(value.toFixed(2), 8)), top, width, 8);
    let certificateRow = 0;
    groups.forEach((group, i) => {
      const top = 368 + certificateRow * 13.7;
      descriptions[i].forEach((line, index) => text(0, line, 22, top + index * 13.7, 149, 8));
      certificateRow += descriptions[i].length;
      text(0, group.atc, 181, top, 35, 8);
      group.months.forEach((value, m) => number(value, 223 + m * 73, top, 65));
      number(group.base, 443, top, 64); number(group.tax, 515, top, 76);
    });
    c.months.forEach((value, m) => number(value, 223 + m * 73, 505, 65)); number(c.base, 443, 505, 64); number(c.taxDue, 515, 505, 76);
  }
  for (let i = 0; i < pages.length; i++) {
    const top = data.id === '1701Q' && i === 0 ? 926.5 : data.id === '1601EQ' && i === 0 ? 921 : 917;
    const footerSize = data.id === '1701Q' && i === 0 ? 6 : 7;
    text(i, `PREPARED DRAFT - REVIEW AND SIGN | ${data.id} | ${data.periodLabel}`, 23, top, 565, footerSize);
  }
  document.setTitle(`${data.title} | ${data.periodLabel}`);
  document.setSubject('Prepared draft. No return has been filed or tax remitted.');
  return Buffer.from(await document.save());
}

async function renderSchedulePdf(data) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const party = row => row.order?.customer || {};
  const n = value => Number(value || 0);
  const money = value => n(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let columns, rows, totals;
  if (data.id === 'SAWT' || data.id === 'QAP') {
    const incoming = data.id === 'SAWT';
    columns = [[incoming ? 'Withholding agent' : 'Payee', 230], ['TIN', 125], ['ATC', 58], ['Rate %', 55], ['Records', 58], ['Income payment', 156], ['Tax withheld', 160]];
    const source = (incoming ? data.invoices : data.expenses).filter(row => n(row.withHoldingTaxAmount) > 0);
    const groups = new Map();
    for (const row of source) {
      const person = incoming ? party(row) : row.vendor || {};
      const name = person.legalName || person.name || 'MISSING REGISTERED NAME', tin = person.taxId || row.vendorTaxId || 'MISSING TIN';
      const atc = row.withholdingTaxType?.code || 'MISSING', rate = row.withholdingTaxType?.percentage ?? '';
      const key = JSON.stringify([tin, name, atc, rate, tin === 'MISSING TIN' ? person.id || row.vendorId || row.id : '']);
      const group = groups.get(key) || { name, tin, atc, rate, count: 0, base: 0, tax: 0 };
      group.count++; group.base += n(incoming ? row.taxableAmount : row.withholdingTaxBase ?? row.taxableAmount); group.tax += n(row.withHoldingTaxAmount);
      groups.set(key, group);
    }
    rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.atc.localeCompare(b.atc)).map(group => [group.name, group.tin, group.atc, group.rate, group.count, money(group.base), money(group.tax)]);
    totals = `Income payments: PHP ${money(source.reduce((s, row) => s + n(incoming ? row.taxableAmount : row.withholdingTaxBase ?? row.taxableAmount), 0))} | Tax withheld: PHP ${money(source.reduce((s, row) => s + n(row.withHoldingTaxAmount), 0))}`;
  } else if (data.id === 'SALES' || data.id === 'SLS') {
    columns = [['Date', 65], ['Invoice', 107], ['Customer', 154], ['TIN', 110], ['Sales excl. VAT', 102], ['Output VAT', 90], ['EWT', 83], ['Receivable', 131]];
    rows = data.invoices.map(row => [row.issueDate, row.invoiceNumber || row.id, party(row).legalName || party(row).name || 'Unclassified customer', party(row).taxId || 'MISSING TIN', money(row.taxableAmount), money(row.taxAmount), money(row.withHoldingTaxAmount), money(row.totalAmount)]);
    totals = `Sales excluding VAT: PHP ${money(data.invoices.reduce((s, row) => s + n(row.taxableAmount), 0))} | Output VAT: PHP ${money(data.invoices.reduce((s, row) => s + n(row.taxAmount), 0))}`;
  } else if (data.id === 'EXPENSES' || data.id === 'SLP') {
    columns = [['Date', 65], ['Expense', 107], ['Supplier', 154], ['TIN', 110], ['Receipt total', 102], ['Receipt VAT', 90], ['Claimable VAT', 83], ['EWT', 64], ['Net payment', 67]];
    rows = data.expenses.map(row => [row.expenseDate, row.expenseNumber || row.id, row.vendor?.legalName || row.vendor?.name || 'Unclassified supplier', row.vendor?.taxId || row.vendorTaxId || 'MISSING TIN', money(row.amount), money(row.receiptVatAmount ?? row.taxAmount), money(row.taxAmount), money(row.withHoldingTaxAmount), money(row.totalAmount)]);
    totals = `Receipt totals: PHP ${money(data.expenses.reduce((s, row) => s + n(row.amount), 0))} | Claimable VAT: PHP ${money(data.expenses.reduce((s, row) => s + n(row.taxAmount), 0))} | EWT: PHP ${money(data.expenses.reduce((s, row) => s + n(row.withHoldingTaxAmount), 0))}`;
  } else throw new TaxReturnError('Unsupported report document.');
  // Fit the table to landscape A4 while retaining full names/references through
  // wrapping. Repeated headers, totals and period labels survive page breaks.
  const width = 842, height = 595, margin = 24;
  const scale = (width - 2 * margin) / columns.reduce((s, column) => s + column[1], 0);
  columns = columns.map(([label, size]) => [label, size * scale]);
  const pages = [];
  let page, cursor;
  function draw(value, x, top, size = 8, face = font) {
    const content = asciiLabel(value);
    try { face.encodeText(content); } catch { throw new TaxReturnError('Use Latin spellings in transaction names and references before generating this PDF.'); }
    page.drawText(content, { x, y: height - top - size, size, font: face, color: black });
  }
  function wrap(value, available, size = 8) {
    const content = asciiLabel(value), lines = []; let line = '';
    for (const character of content) {
      if (character === '\n' || font.widthOfTextAtSize(line + character, size) > available) { lines.push(line); line = character === '\n' ? '' : character; }
      else line += character;
    }
    lines.push(line); return lines;
  }
  function addPage() {
    page = document.addPage([width, height]); pages.push(page); cursor = 108;
    draw(data.title, margin, 22, 16, bold); draw(data.periodLabel, margin, 47, 11, bold);
    draw(`${data.periodStart} to ${data.periodEnd} | ${data.values.registeredName || ''}`, margin, 65, 9);
    draw(`TIN: ${data.values.tin || 'not configured'} | PHP | Prepared from current records`, margin, 80, 9);
    let x = margin;
    for (const [label, size] of columns) { page.drawRectangle({ x, y: height - cursor - 23, width: size, height: 23, color: rgb(.92, .94, .97) }); draw(label, x + 4, cursor + 5, 8, bold); x += size; }
    cursor += 23;
  }
  addPage();
  if (!rows.length) { draw('No transactions recorded for this period.', margin + 4, cursor + 12, 10); cursor += 38; }
  for (const row of rows) {
    const lines = row.map((value, i) => wrap(String(value ?? ''), columns[i][1] - 8));
    const rowHeight = Math.max(23, Math.max(...lines.map(value => value.length)) * 10 + 10);
    if (rowHeight > 370) throw new TaxReturnError('A transaction detail is too long to fit on the report.');
    if (cursor + rowHeight > height - 62) addPage();
    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      lines[i].forEach((value, line) => draw(value, x + 4, cursor + 5 + line * 10));
      page.drawRectangle({ x, y: height - cursor - rowHeight, width: columns[i][1], height: rowHeight, borderWidth: .3, borderColor: rgb(.75, .78, .82) });
      x += columns[i][1];
    }
    cursor += rowHeight;
  }
  if (cursor + 38 > height - 62) addPage();
  draw(totals, margin, cursor + 10, 9, bold);
  for (let i = 0; i < pages.length; i++) {
    page = pages[i];
    draw(`${data.id} | ${data.periodLabel} | Page ${i + 1} of ${pages.length}`, margin, height - 41, 8);
    draw(['SAWT', 'QAP', 'SLS', 'SLP'].includes(data.id) ? 'Review schedule | PDF is not a BIR DAT submission | Verify classifications and supporting certificates.' : 'Prepared transaction report | Review against accounting records.', margin, height - 26, 8);
  }
  document.setTitle(`${data.title} | ${data.periodLabel}`);
  return Buffer.from(await document.save());
}

module.exports = { renderReportDocumentPdf, renderSchedulePdf };
