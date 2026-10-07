const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { unzipSync, strFromU8 } = require('fflate');

function setup(type) {
  const template = fs.readFileSync(path.join(__dirname, '../public/templates', type === 'sales' ? 'gimo-sales.xlsx' : 'GIMO_FS-2026.xlsx'));
  const original = unzipSync(template), captured = [], links = [];
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/core/gimo-financial-statement-export.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require, Blob, Uint8Array,
    fetch: async () => ({ ok: true, arrayBuffer: async () => template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) }),
    URL: { createObjectURL: blob => { captured.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { body: { appendChild() {}, removeChild() {} }, createElement: () => { const link = { click() {} }; links.push(link); return link; } },
  });
  return { original, links, download: lines => module.exports.downloadGimoFinancialStatement(type, lines, 2026, 3),
    output: async () => unzipSync(new Uint8Array(await captured[0].arrayBuffer())) };
}
function cell(xml, ref) { return xml.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`))?.[0] || ''; }

for (const type of ['sales', 'purchases']) {
  test(`${type} real GIMO template contains safe complete address text and retains formulas and other workbook parts`, async () => {
    const e = setup(type), first = type === 'sales' ? 9 : 10;
    const address = '=HYPERLINK("example") & <Address> $& $1 $$ ' + 'Peña Street, Manila '.repeat(8);
    const line = { date: '2026-09-23', referenceNumber: '000001', customerName: 'Client & <Name>', vendorName: 'Vendor & <Name>',
      customerTin: '0010020030000', vendorTin: '0010020030000', customerAddress: address, vendorAddress: address,
      grossSales: 112, taxableSales: 100, outputVat: 12, grossPurchases: 112, taxablePurchases: 100, inputVat: 12 };
    await e.download([line, { ...line, customerAddress: '', vendorAddress: '' }]);
    const archive = await e.output(), xml = strFromU8(archive['xl/worksheets/sheet1.xml']);
    const addressCell = cell(xml, `B${first}`);
    assert.match(addressCell, /t="inlineStr"/); assert.match(addressCell, /&amp; &lt;Name&gt;\n=HYPERLINK\(&quot;example&quot;\) &amp; &lt;Address&gt;/);
    assert.match(addressCell, /Peña Street/); assert.doesNotMatch(addressCell, /<f[ >]/);
    assert.ok(addressCell.includes('$&amp; $1 $$'));
    assert.doesNotMatch(cell(xml, `B${first + 1}`), /undefined|null|HYPERLINK/);
    assert.match(cell(xml, `C${first}`), /0010020030000/);
    assert.match(cell(xml, `${type === 'sales' ? 'M' : 'J'}${first}`), /<v>12<\/v>/);
    const style = Number(addressCell.match(/\bs="(\d+)"/)[1]);
    const styles = strFromU8(archive['xl/styles.xml']).match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
    assert.match(styles[style], /wrapText="1"/); assert.match(styles[style], /borderId="[1-9]\d*"/);
    const row = xml.match(new RegExp(`<row\\b[^>]*\\br="${first}"[^>]*>`))[0];
    assert.ok(Number(row.match(/\bht="([\d.]+)"/)[1]) >= 36);
    const originalXml = strFromU8(e.original['xl/worksheets/sheet1.xml']);
    assert.deepEqual(xml.match(/<f\b[^>]*>[\s\S]*?<\/f>/g), originalXml.match(/<f\b[^>]*>[\s\S]*?<\/f>/g));
    for (const [name, bytes] of Object.entries(e.original)) if (!['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name)) assert.deepEqual(archive[name], bytes, name);
    assert.equal(e.links[0].download, `gimo-${type}-2026-q3.xlsx`);
  });
}
