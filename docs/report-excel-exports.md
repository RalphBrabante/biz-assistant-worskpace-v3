# Quarterly report Excel exports

Open a saved expense or sales report from **Reports & Tax Documents**, then choose **Export Excel** on its preview. Exports use a fresh authenticated preview request and include every returned transaction, with no table/template capacity limit (subject to Excel's worksheet limit). Changing reports clears old data and cancels the old request. Pending, failed, and duplicate downloads are guarded.

Each XLSX contains:

- **Summary**: report identity, dates, saved snapshot, actual exported count and current totals grouped by currency. Stored optional expense receipt VAT/withholding base values stay blank when absent; their totals sum recorded values only.
- **Expenses** or **Invoices**: all preview rows, numeric money/dates, and text TINs/references preserving leading zeros. User text is stored as an inline string, never a formula.
- **BIR Guide**: reporting period, filer identity, candidate return, PHP-only withholding totals, scope and conversion instructions.
- **QAP Details** (expenses) or **SAWT Details** (sales): withholding rows in the prescribed BIR detail field order. These include a separate nine-digit TIN and four-digit branch, ATC, rate, tax base and withheld amount.
- **BIR Review**: missing/invalid TIN or branch, individual names/taxpayer type, registered names longer than 50 characters, RDO, target return, internal rather than BIR ATCs, rates, unposted transactions and foreign currencies requiring review.

Expenses use the stored withholding base when available; the legacy fallback is receipt total less supplier receipt VAT (or stored input VAT), including exempt portions. Sales use the stored taxable amount (or subtotal only if taxable amount is absent). Compare sales income payments with the source Form 2307, especially for discounts/exempt income. An issued invoice's frozen buyer identity takes precedence over a later customer edit in the SAWT worksheet.

The main transaction sheets include all non-cancelled expenses/non-void sales, as the existing preview does. That includes drafts; the BIR review sheet flags draft/submitted withholding rows. The withholding sheets include only recorded nonzero withholding, not every transaction. They do not infer exempt QAP Schedule 2 payments, final-withholding QAP schedules, individual name parts, currency conversion or unsupported customs importation records. Names for individual parties stay blank for manual completion; an unclassified party's display/registered name is a review candidate, not a confirmed business identity. No branch is assumed for a bare nine-digit TIN. Three-digit suffixes are padded to four; a five-digit suffix is accepted only when its leading digit is zero, so normalization loses no significant digits.

Sales SAWT candidates are 1701Q for an individual and 1702Q for a corporation/partnership in Q1–Q3. Other classifications and Q4 require selecting the target form manually. A Q4 report does not supply full-year data for an annual attachment. Review applicable form scope and credits with an accountant.

## Reviewed BIR alphalist files

The standard **Export Excel** download is a preparation workbook. For a complete filing-format file, choose **BIR Alphalist Export** beside it. This opens a native modal dialog to review the filer, counterparties, separate individual names, TINs/branches, RDO, target return, ATCs and applicable rates. The editor never changes stored records; changing reports clears its draft and confirmations. Amounts come from the report source and cannot be edited here.

Supported downloads after confirming review and coverage:

- **Download BIR DAT**: ASCII, no BOM, CRLF record delimiters, header/detail/control records and `<TIN><4-digit branch><MMYYYY><FORM>.DAT` filename. QAP uses 7/14/7 fields (HQAP, D1, C1); SAWT uses 10/15/7 (HSAWT, DSAWT, CSAWT). Identities/ATCs/rates are grouped with exact cent totals and separate branch identities, then names are sorted for the alphalist. No extra empty trailing columns are appended.
- **Download Reviewed Excel**: the same reviewed, complete header/detail/control records on **BIR Records**, plus a guide sheet. Direct native XLSX import is not claimed; use the companion DAT for the BIR validation workflow.

This targets the current official **Alphalist 7.4**, verified on the live BIR download page on 2026-10-06, including the current published ATC patch. Supported scope is QAP 1601EQ Schedule 1 and SAWT 1701Q/1702Q/2551Q. An income-tax form must match the filer classification; Q4 income attachments and years before 2023 are rejected. QAP Schedule 2, final withholding and full-year attachments require data outside this feature; the user must explicitly confirm coverage before export. Unknown/internal/final ATCs, missing identities or branch codes, foreign currencies, unposted records, invalid/out-of-period dates, unsupported forms and invalid monetary precision/field limits block the download. The creditable ATC list is sourced from the official module's `DATA/LOVAL/regatc.dbf` (`TAX_TYPE=WE`) plus the creditable additions in its published patch; applicable rates are reviewed, not automatically guessed. Non-ASCII and the name punctuation rejected by the official validator also block export; the reviewer must supply the BIR-compatible representation rather than having names silently altered.

The posted RMC 15-2025 SAWT control table is incomplete. The seven-field SAWT control structure, four-digit branches, filename and name restrictions were instead verified against the generator and validator code embedded in the official 7.4 package, extracted read-only on macOS without executing its Windows installer. The actual Windows validation module has **not** been run here. Always validate the downloaded DAT in the latest official module with its current ATC patch before submission; these exports are not evidence of BIR acceptance or filing.

Version and the verified date are centralized in the exporter. Future BIR releases need checking against the official download page/package and corresponding code/fixture updates; this feature does not silently claim compatibility with an unverified future release. No remote tax data is transmitted during export.

QAP/SAWT are withholding alphalists. RELIEF Summary Lists of Sales/Purchases/Importations are a separate VAT reporting format; these withholding detail sheets are not RELIEF import files. Ordinary expense records do not contain the customs data needed for the Summary List of Importations.

Official references checked on 2026-10-06:

- [BIR RMC 15-2025 digest](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Digest.pdf): Alphalist 7.4, ATC/rate updates and prescribed structure/naming requirements.
- [RMC 15-2025 Annex A](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20A.pdf): SAWT header/detail field order. The published control table is incomplete; the official 7.4 package resolves it.
- [RMC 25-2024 Annex A](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf): QAP 1601EQ Schedule 1 detail fields, separate from Schedule 2 and final-withholding forms.
- [BIR downloadables](https://www.bir.gov.ph/Downloadables): latest Alphalist and RELIEF modules.
- [Official Alphalist 7.4 package](https://bir-cdn.bir.gov.ph/BIR/pdf/Alphalist%20Data%20Entry%20and%20Validation%20ver.%207.4.zip): embedded `genfilesawt`, `schedsawt`, `testfieldsawt`, QAP generation and `valname` routines verify complete records/filename/name restrictions.
- [Current official ATC patch](https://bir-cdn.bir.gov.ph/BIR/pdf/ATC-Patch.zip): creditable additions WI/WC156, 820, 830, 840, 850, 860. Final WC810 and VAT WV codes are excluded.

No migration or new dependencies are required. Preview APIs supply the existing organization tax identity, customer legal name/type and withholding ATC/rate associations. Organization authorization and the current report period/status filters remain enforced.

## Verification

The 62 focused export, report-preview, report-year and BIR-document tests pass. Client production and API TypeScript builds pass; the client retains an initial-bundle size warning. Browser checks against the production client with a local synthetic API downloaded the expense and sales workbooks, both reviewed workbooks, QAP DAT and SAWT DAT. Downloaded XLSX XML/relationships parsed successfully, and the DAT files matched the expected record widths, CRLF delimiters and control totals. These checks do not use live accounting records or establish acceptance by the Windows BIR validation module.
