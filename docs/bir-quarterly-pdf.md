# Quarterly BIR PDFs and report documents

Research checked on 5 October 2026 against the Bureau of Internal Revenue (BIR), under the Philippine Department of Finance.

## Official templates

| Organization business tax | Return | Bundled official PDF |
| --- | --- | --- |
| VAT | 2550Q, Quarterly Value-Added Tax Return | [April 2024 ENCS](https://bir-cdn.bir.gov.ph/BIR/pdf/2550Q%20%20April%202024%20ENCS_Final.pdf) |
| General Section 116 percentage tax | 2551Q, Quarterly Percentage Tax Return, ATC PT010 | [January 2018 ENCS](https://bir-cdn.bir.gov.ph/local/pdf/2551Q%20Jan%202018%20ENCS%20final%20rev%203_copy.pdf) |
| Individual / estate / trust income tax | 1701Q, Quarterly Income Tax Return | [January 2018 ENCS](https://bir-cdn.bir.gov.ph/local/pdf/1701Q%20Jan%202018%20final%20rev2_copy.pdf) |
| Ordinary domestic corporate income tax | 1702Q, Quarterly Income Tax Return | [January 2018 ENCS](https://bir-cdn.bir.gov.ph/local/pdf/1702Q%202018ENCS%20final2.pdf) |
| Expanded withholding agent | 1601-EQ, Quarterly Remittance Return | [January 2019 ENCS](https://bir-cdn.bir.gov.ph/local/pdf/1601-EQ%20January%202019%20ENCS%20final.pdf) |
| Supplier with recorded expanded withholding | 2307, Certificate of Creditable Tax Withheld at Source | [January 2018 ENCS](https://bir-cdn.bir.gov.ph/local/pdf/2307%20Jan%202018%20ENCS%20v3.pdf) |

The six templates are stored in `api/assets/bir`. They are static PDFs without AcroForm fields. The generator overlays text on the original vector pages, retaining form lines, barcodes, guides, and page dimensions. New document templates are embedded as vector backgrounds to isolate their original graphics/clipping state. Every official page is retained, including the third instruction page on 1702Q. Outputs are unsigned drafts suitable for preview, download and printing. Print using the form's original size or your printer's fit-to-page setting.

TIN positions are measured separately for each template and page. All nine taxpayer digits and five branch digits are centered individually; printed branch zeros are replaced inside the cells while preserving the grid borders.

## Tax rules affecting this implementation

- VAT registration determines the VAT return; turnover alone does not determine the form. VAT returns generally remain required until registration is cancelled, including zero-transaction quarters. The normal VAT rate is 12%; zero-rated and exempt sales must be classified separately. See [BIR VAT guidance](https://www.bir.gov.ph/value-addedtax) and the [BIR forms directory](https://www.bir.gov.ph/bir-forms).
- General Section 116 percentage tax is 3% of the quarterly sales base. It temporarily fell to 1% from 1 July 2020 through 30 June 2023. Eligible individuals electing 8% income tax and qualifying cooperatives are excepted. The generator supports PT010; it does not infer special industry ATCs from a generic organization tax type. See [RMC 69-2023](https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No.%2069-2023%20v2.pdf), [RMC 67-2021](https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No.%2067-2021.pdf), and [2551Q instructions](https://bir-cdn.bir.gov.ph/local/pdf/2551Q_%20Jan%202018%20Guide.pdf).
- Both quarterly returns normally fall due within 25 days after the taxable quarter. Fiscal quarters follow the taxpayer's registered accounting period. Extensions and holidays can affect the actual deadline; this generator does not calculate a filing deadline. See the [BIR forms directory](https://www.bir.gov.ph/bir-forms).
- EOPT changed service recognition from receipts to gross sales/billing. Historical service receipts and transitional receivables need reconciliation rather than assuming invoice dates always represent the correct historical tax base. See [RR 3-2024 digest](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%203-2024%20%28final%29.pdf).
- April 2024 2550Q added adjustments for qualifying uncollected/recovered receivables and unpaid/settled payables. Qualification is not inferred from ordinary unpaid status. See [RMC 68-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2068-2024.pdf).
- The printed 2550Q Item 59 formula adds Items 57 and 58 even though Item 58 describes restoration of previously deducted input VAT. This generator rejects nonzero Item 58 rather than silently selecting a treatment for that discrepancy.

### Quarterly income tax and withholding

- 1701Q covers the first three quarters, with cumulative income and credits. Ordinary deadlines are May 15, August 15 and November 15. Compensation belongs in the annual return. Individual OSD is 40% of gross sales. The eligible non-VAT 8% election uses gross sales plus other non-operating income, with a ₱250,000 reduction for purely self-employed filers; mixed-income filers do not receive that reduction. Eligibility and the annual election require confirmation. See the [1701Q instructions](https://bir-cdn.bir.gov.ph/local/pdf/1701Q%20Guide%20Jan%202018_copy.pdf).
- 1702Q also covers Q1–Q3; its ordinary deadline is within 60 days after the quarter. Corporate fiscal periods are possible under BIR rules, but this implementation supports calendar years only. See the [official 1702Q and instructions](https://bir-cdn.bir.gov.ph/local/pdf/1702Q%202018ENCS%20final2.pdf).
- Current ordinary domestic corporate tax is 25%, or 20% when annual net taxable income is at most ₱5 million **and** qualifying assets are at most ₱100 million, excluding specified business land. MCIT is currently 2%, starting in the fourth taxable year after the commencement year. The generator compares regular tax with applicable MCIT. The old 30% printed in the January 2018 guide is not used for current calculations. See [RR 5-2021](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%205-2021.pdf).
- 1601-EQ consolidates expanded withholding for the quarter; first- and second-month remittances are separate credits. Its ordinary deadline is the last day of the following month, subject to the applicable filing rules. The platform requires actual WI/WC ATCs and checks recorded bases/rates against withheld amounts. See the [1601-EQ instructions](https://bir-cdn.bir.gov.ph/local/pdf/1601-EQ%20Guide%20January%202019%20ENCS%20rev.pdf).
- 2307 records monthly income payments within the selected quarter and their withheld tax. Generated certificates are outgoing supplier certificates. Received customer certificates substantiate incoming income-tax credits; these two directions are kept separate. The official [2307 template](https://bir-cdn.bir.gov.ph/local/pdf/2307%20Jan%202018%20ENCS%20v3.pdf) preserves both signature sections.

There is no Q4 1701Q/1702Q. Q4 income belongs in the annual return, while business-tax and applicable withholding returns still cover Q4. Annual forms appear as clearly marked references, not quarterly generators. Generating a PDF does not electronically file a return, make a payment, or provide BIR confirmation.

### Supporting reports researched and included

| Report | Records used | Available output and limits |
| --- | --- | --- |
| SAWT: Summary Alphalist of Withholding Agents | Customer income-tax withholding | Alphabetical PDF review schedule and existing CSV worksheet; verify against received 2307s. |
| QAP: Quarterly Alphalist of Payees | Supplier income-tax withholding | Alphabetical PDF review schedule and existing CSV worksheet; supports 1601-EQ preparation. |
| SLS / SLP: Summary Lists of Sales / Purchases | VAT organization sales and purchases | PDF transaction review schedules and existing XLSX worksheets. |
| Quarterly Sales / Expense Report | Current quarter transactions | Paginated PDFs with totals and repeated period labels. |

SAWT/QAP PDFs and CSV worksheets are **not validated BIR DAT submissions**. BIR publishes prescribed electronic structures: [SAWT, RMC 15-2025 Annex A](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20A.pdf) and [QAP/alphalists, RMC 25-2024 Annex A](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf). SLS/SLP review PDFs likewise do not replace validated RELIEF data; sales classifications and importation data need separate preparation. See [BIR VAT guidance](https://www.bir.gov.ph/value-addedtax).

Other relevant forms include monthly 0619-E remittances, payroll 1601-C, annual 1604-C/1604-E alphalists and employee 2316 certificates. Automatic preparation needs verified remittance/payroll records beyond the present invoice/expense data. Annual 1701/1701A and 1702-RT need full-year reconciliation and applicable schedules. BIR introduced optional 1701-MS for eligible micro/small filers in 2026; 1701/1701A remain valid according to the [official 1701-MS FAQs](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%2020-2026%20Annex%20C%20(3).pdf). These additional annual/monthly forms are research references, not implemented generators. See the [BIR forms directory](https://www.bir.gov.ph/bir-forms).

## Report-page flow

1. Select an organization, calendar year and quarter on Reports.
2. Choose a document in Business tax, Income tax, Withholding, Supporting schedules or Transaction reports. Business tax automatically selects 2550Q or 2551Q using the organization's tax type; other cards explain their applicability. Every card, editor and preview identifies the quarter/year and the editor shows exact dates.
3. Review the prefilled registered details and amounts. Official returns require an RDO code; VAT returns also require the BIR taxpayer size classification (Micro/Small/Medium/Large), distinct from individual/corporation classification.
4. For business tax, classify unallocated sales/purchases and verify credits/adjustments. For income tax, confirm the annual election/deduction method, filed prior-quarter income, verified 2307 credits and payments. Corporate filers also confirm calendar-year scope, the applicable rate, commencement year and each MCIT gross-income amount. For 2307, choose the supplier.
5. Choose Generate PDF. The populated PDF appears inline with Download PDF, Print and Open PDF controls. Changes to details, organization, document or quarter clear the previous preview and cancel pending requests.
6. Saved sales/expense report actions include Prepare PDF, which opens the corresponding quarter's current transaction report in the document center. Saved totals remain separately managed; PDFs describe current records, rather than claiming to be immutable snapshots of saved totals.

PDF details apply only to that generation and are not saved to the organization or a filing-history table. Refreshing the summary resets the draft. Existing totals/estimates and CSV/XLSX worksheets are available in a collapsed section. Year-end references have their own section. Saved sales/expense reports remain available below the document center.

## Data and scope

- The source is live, organization-scoped quarterly records: invoices excluding draft/void, and expenses excluding cancelled entries, with inclusive date boundaries.
- Sales use persisted `taxableAmount`, avoiding the differing meanings of legacy and order-workflow invoice subtotals. Expense purchase bases use supplier receipt totals less supplier VAT, before income-tax withholding. Discounts already included in recorded bases are not deducted again.
- Customer income-tax EWT and supplier EWT are not automatically treated as VAT or percentage-tax credits. Such credits require verified documentation and explicit entry.
- Sales with positive VAT initially appear as VATable; sales without VAT remain unclassified until allocated. Purchases initially appear as domestic and can be reallocated. Input VAT eligibility and special relief remain subject to taxpayer review.
- Signed excess input tax/credits are preserved. Credits, carryovers and penalties default to zero rather than being inferred from saved report totals or unrelated payments.
- Supported scope: Philippine organizations, PHP source transactions, calendar quarters, ordinary VAT from Q2 2024 onward, and general Section 116 percentage tax from 2018 onward. Historical VAT templates, fiscal periods, special industry ATCs, special relief computation, capital-goods amortization and detailed supporting schedules need separate preparation.
- New income-tax scope: 1701Q from 2018, one individual/estate/trust filer without spouse income or foreign tax credits; 1702Q for ordinary domestic corporations in 2024–2099. Partnerships, foreign corporations, exempt/special regimes and transitional historical corporate rates require separate preparation. The generators do not infer tax elections solely from an organization rate.
- Income-tax defaults use year-to-date records through the chosen quarter; future-quarter records are excluded from their source revision. Prior-quarter book suggestions must be reconciled to filed returns. Income-tax form values use whole-peso rounding; signed losses/overpayments are retained. Corporate OSD applies to gross income after cost of sales, unlike individual OSD.
- 1601-EQ has six ATC/rate rows; 2307 has ten income-description rows. Generation rejects overflow with a continuation/separate-certificate explanation rather than omitting records. Transaction/schedule PDFs paginate automatically.
- `POST /api/v1/reports/bir-tax-return/pdf?organizationId=...` requires `reports.generate`, year, quarter, the summary's `sourceRevision`, and reviewed `details`. It returns `application/pdf` with `private, no-store`. Existing organization access rules apply; normal users cannot override organization scope. A source revision mismatch requires refreshing the summary.
- `POST /api/v1/reports/bir-document/pdf?organizationId=...` has the same permissions/cache/scope rules and additionally accepts `documentId`. Its source revision includes the records relevant to that document and period.
- `GET /api/v1/reports/bir-filing-summary` supplies business-tax preparation under `taxReturn` and the document catalog/defaults/availability reasons under `documents`. It requires `reports.read` and uses a fresh client request.
- Templates are packaged with Docker builds and the combined Hostinger release; PDF generation does not download templates at runtime.

## Validation

API regression tests cover tax bases, historical percentage rates, individual brackets/8%/OSD, corporate 20%/25% thresholds and MCIT, credit direction, monthly certificate bases, whole-peso rounding, required taxpayer details, template sizes/page counts, exact TIN centers/grid preservation, organization scoping, cumulative source selection and stale-source rejection. Client tests cover document selection, saved-report quarter routing, preview invalidation, downloads, print, delayed blob errors and cancellation. Sample PDFs were rendered and visually checked against the original layouts, including TIN cells, decimal/whole-peso columns and footer visibility. No live BIR submission or production deployment was performed.
