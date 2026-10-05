const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { TaxReturnError } = require('./bir-tax-return');
const { drawTin, TIN_LAYOUTS } = require('./bir-pdf-layout');

// Coordinates are in PDF points from the top-left of the official, unscaled
// templates. No rasterization: BIR text, lines, barcodes and page sizes survive.
async function renderTaxReturnPdf(returnData) {
  const vat = returnData.form === '2550Q';
  const template = vat ? '2550Q-april-2024.pdf' : '2551Q-january-2018.pdf';
  const document = await PDFDocument.load(await fs.readFile(path.join(__dirname, '../../assets/bir', template)));
  const font = await document.embedFont(StandardFonts.CourierBold);
  const pages = document.getPages();
  const v = returnData.values;
  const c = returnData.computed;
  function text(page, value, x, top, width = 560, size = 10) {
    const content = String(value || '').toUpperCase();
    try { font.encodeText(content); } catch { throw new TaxReturnError('The PDF template supports Latin characters. Use the registered Latin spelling for taxpayer details.'); }
    const fit = content ? Math.min(size, width / font.widthOfTextAtSize(content, 1)) : size;
    if (fit < 6) throw new TaxReturnError('A taxpayer detail is too long to fit legibly on the BIR form.');
    pages[page].drawText(content, { x, y: pages[page].getHeight() - top - fit, size: fit, font, color: rgb(0, 0, 0) });
  }
  function boxes(page, value, x, top, step = 14.2, size = 10) {
    [...String(value)].forEach((digit, index) => text(page, digit, x + index * step, top, step, size));
  }
  function money(page, value, top, column = 'B') {
    const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
    const signed = value < 0 ? '-' + whole : whole;
    if (signed.length > 12) throw new TaxReturnError('An amount exceeds the space available on the official form.');
    const decimalLeft = !vat && page === 1 ? (column === 'A' ? 278 : 533.5) : (column === 'A' ? 333.25 : 547.1);
    boxes(page, signed, decimalLeft - signed.length * 14.2 + 4, top, 14.2);
    boxes(page, fraction, decimalLeft + 18.2, top, 14.2);
  }
  function tick(page, x, top) { text(page, 'X', x + 2, top, 10, 10); }
  const tin = v.tin;
  if (vat) {
    tick(0, 75.5, 110.2); // calendar year
    boxes(0, '12' + returnData.year, 308.5, 110.2);
    tick(0, [435.2, 470.7, 513.2, 553.5][returnData.quarter - 1], 110.2);
    const date = value => value.slice(5, 7) + value.slice(8, 10) + value.slice(0, 4);
    boxes(0, date(returnData.periodStart), 67.5, 140);
    boxes(0, date(returnData.periodEnd), 207.8, 140);
    tick(0, v.amended ? 347.3 : 389.8, 140); tick(0, 533.2, 140);
    drawTin(pages[0], font, tin, TIN_LAYOUTS['2550Q'][0]);
    boxes(0, v.rdoCode, 551, 173);
    text(0, v.registeredName, 28, 201, 558);
    text(0, v.registeredAddress, 28, 231, 558);
    text(0, v.zipCode, 535, 250, 52);
    text(0, v.phone, 28, 273, 178); text(0, v.email, 210, 273, 377);
    tick(0, { micro: 163, small: 232.5, medium: 302, large: 389.5 }[v.taxpayerSize], 294);
    // Relief election is not inferred; leave the relief boxes for taxpayer review.
    const first = [c.taxDue, v.creditableTax, v.advanceVat, v.previousPayment, v.otherCredits,
      c.credits, c.stillPayable, v.surcharge, v.interest, v.compromise, c.penalties, c.totalPayable];
    first.forEach((amount, index) => money(0, amount, index === 0 ? 348 : 377.1 + (index - 1) * 18.25));
    text(0, v.otherCreditsDescription, 207, 432, 164, 8);
    drawTin(pages[1], font, tin, TIN_LAYOUTS['2550Q'][1]);
    text(1, v.registeredName, 224, 93, 362, 9);
    money(1, v.vatableSales, 135, 'A'); money(1, v.outputVat, 135);
    money(1, v.zeroRatedSales, 151, 'A'); money(1, v.exemptSales, 167, 'A');
    money(1, c.totalSales, 185, 'A'); money(1, v.outputVat, 185);
    money(1, v.uncollectedOutputVat, 201); money(1, v.recoveredOutputVat, 217); money(1, c.adjustedOutput, 233);
    [v.inputCarryover, 0, v.transitionalInput, v.presumptiveInput, 0, c.priorInput].forEach((amount, i) => money(1, amount, 259 + i * 15.95));
    const purchases = [[v.domesticPurchases, v.domesticInputVat], [v.nonresidentPurchases, v.nonresidentInputVat],
      [v.importPurchases, v.importInputVat], [0, 0], [v.purchasesWithoutInputVat], [v.exemptImports]];
    purchases.forEach((amounts, i) => { money(1, amounts[0], 369 + i * 15.95, 'A'); if (amounts.length > 1) money(1, amounts[1], 369 + i * 15.95); });
    money(1, c.totalPurchases, 466, 'A'); money(1, c.currentInput, 466);
    money(1, c.priorInput + c.currentInput, 483);
    money(1, 0, 508);
    [v.exemptInputVat, v.refundInputVat, v.unpaidInputVat, 0, c.inputDeductions, v.settledInputVat,
      c.adjustedDeductions, c.allowableInput, c.taxDue].forEach((amount, i) => money(1, amount, 526.5 + i * 15.95));
  } else {
    tick(0, 85.2, 114); boxes(0, '12' + returnData.year, 141.5, 132);
    tick(0, [244, 287, 329, 371][returnData.quarter - 1], 129);
    tick(0, v.amended ? 425.5 : 467.5, 132);
    text(0, '0', 574, 132, 12);
    drawTin(pages[0], font, tin, TIN_LAYOUTS['2551Q'][0]);
    boxes(0, v.rdoCode, 552, 166);
    text(0, v.registeredName, 28, 194, 558);
    text(0, v.registeredAddress, 28, 224, 558);
    text(0, v.zipCode, 537, 242, 48);
    text(0, v.phone, 28, 267, 160); text(0, v.email, 195, 267, 390);
    if (returnData.individual && returnData.quarter === 1) tick(0, 180, 329);
    const rows = [c.taxDue, v.creditableTax, v.previousPayment, v.otherCredits, c.credits, c.stillPayable,
      v.surcharge, v.interest, v.compromise, c.penalties, c.totalPayable];
    const tops = [365, 395, 413.3, 431.5, 449.8, 468, 497.6, 515.9, 534.1, 552.4, 571.1];
    rows.forEach((amount, i) => money(0, amount, tops[i]));
    text(0, v.otherCreditsDescription, 225, 431.5, 146, 8);
    drawTin(pages[1], font, tin, TIN_LAYOUTS['2551Q'][1]);
    text(1, v.registeredName, 228, 113, 356, 9);
    text(1, 'PT010', 41, 166, 65);
    money(1, v.percentageSales, 166, 'A');
    text(1, String(returnData.rate), 337, 166, 20);
    money(1, c.taxDue, 166); money(1, c.taxDue, 276);
  }
  for (let i = 0; i < pages.length; i++) text(i, `PREPARED DRAFT - REVIEW AND SIGN BEFORE FILING | ${returnData.form} Q${returnData.quarter} ${returnData.year}`, 28, vat ? 955 : 919, 558, 7);
  document.setTitle(`BIR ${returnData.form} Q${returnData.quarter} ${returnData.year}`);
  document.setSubject('Prepared quarterly return; no electronic filing or payment has been made.');
  return Buffer.from(await document.save());
}

module.exports = { renderTaxReturnPdf };
