# Philippine BIR Filing Reports Implementation Reference

Last reviewed: 2026-07-08

Use this file before implementing report sections related to BIR filing, tax worksheets, income tax, VAT, percentage tax, withholding tax, or filing calendars.

This is an engineering reference, not legal advice. The app should present these as filing summaries or worksheets unless it generates exact BIR form files and validates every form line.

---

## 1. Report Section Concept

Add a top-level reports area named `BIR Filing Center`.

The section groups existing sales and expense data into filing-oriented worksheets:

| Area | Purpose | Primary users |
|---|---|---|
| Business Tax Returns | VAT or percentage-tax summary by organization tax type | Owners, accountants |
| Income Tax Returns | Gross income less deductible expenses worksheet | Owners, accountants |
| Withholding Tax Reports | EWT remittance and certificate preparation | Accountants |
| Attachments & Schedules | Supporting schedules such as SAWT/QAP/SLSP where applicable | Accountants |
| Filing Calendar | Quarter/month/year obligations by tax type | Owners, admins |

---

## 2. Initial Implementation Scope

The first implementation should be a worksheet section inside the existing Reports page.

Use already-generated quarterly reports:

- Quarterly sales reports
- Quarterly expense reports
- Active organization tax type
- Selected year and quarter filters

Do not create final BIR returns yet. Label the section as `worksheet`, `summary`, or `filing preparation`.

---

## 3. Business Tax Worksheet

Branch by organization tax type.

### 3.1 VAT Organization

Relevant forms:

- BIR 2550Q - Quarterly VAT Return
- BIR 2550M - Monthly VAT Declaration, if monthly filing support is later added

Worksheet fields:

```
output_vat = quarterly_sales_report.taxAmount
input_vat = quarterly_expense_report.taxAmount
net_vat_payable = max(output_vat - input_vat, 0)
input_vat_carryover_estimate = max(input_vat - output_vat, 0)
```

Display labels:

- Output VAT
- Input VAT
- Net VAT Payable
- Input VAT Excess / Review

### 3.2 Non-VAT Percentage-Tax Organization

Relevant form:

- BIR 2551Q - Quarterly Percentage Tax Return

Worksheet fields:

```
gross_receipts = quarterly_sales_report.subtotalAmount
percentage_tax_rate = organization.taxType.percentage
percentage_tax_due = gross_receipts * (percentage_tax_rate / 100)
vat_amount = 0
```

Display labels:

- Gross Receipts / Percentage Tax Base
- Percentage Tax Rate
- Percentage Tax Due
- VAT Amount, always zero

Do not divide gross receipts by `1.12`.

---

## 4. Income Tax Worksheet

Relevant forms depend on taxpayer type:

- BIR 1701Q - Quarterly Income Tax Return for individuals, estates, trusts
- BIR 1702Q - Quarterly Income Tax Return for corporations and partnerships
- BIR 1701 / 1701A - Annual Income Tax Return for individuals
- BIR 1702RT - Annual Income Tax Return for corporations, partnerships, and other non-individual taxpayers

Implemented worksheet fields:

```
gross_income = bir_filing_summary.sales.grossReceipts
deductible_expenses_estimate = bir_filing_summary.expenses.deductibleExpenses
net_taxable_income_estimate = max(gross_income - deductible_expenses_estimate, 0)
```

Important: this is only a worksheet. Real income tax computation depends on taxpayer classification, allowable deductions, optional standard deduction, graduated/corporate rates, prior-quarter payments, tax credits, and other adjustments.

---

## 5. Withholding Tax Reports

Relevant forms and outputs:

- BIR 0619-E - Monthly Remittance Form for Creditable Income Taxes Withheld
- BIR 1601-EQ - Quarterly Remittance Return of Creditable Income Taxes Withheld
- BIR 2307 - Certificate of Creditable Tax Withheld at Source

Implemented summary aggregates source expense transactions by:

- ATC code
- withholding tax type
- payee/vendor/customer
- gross/taxable base
- amount withheld
- month and quarter

The Reports page also shows BIR 2307 preparation by payee/vendor and allows CSV export of the payee summary.

---

## 6. Attachments And Schedules

Only treat schedule sections as supported when source data exists.

| Schedule | Applies when | Notes |
|---|---|---|
| SAWT | Sales invoices include creditable withholding from customers | CSV export is generated from invoice-level withholding lines |
| QAP | Expenses include withholding tax type/payee data | CSV export is generated from expense-level EWT lines |
| SLSP / VAT Relief | VAT organization with sales/purchase detail | CSV export is generated from sales invoice and expense detail lines |

Keep unsupported schedules labeled as unavailable or zero-line instead of estimating missing source details.

---

## 7. Filing Calendar

The first calendar can be a simple obligation list for the selected quarter:

| Tax type | Filing item |
|---|---|
| VAT | VAT return worksheet, income tax worksheet, EWT worksheet if withholding exists |
| PT | Percentage tax return worksheet, income tax worksheet, EWT worksheet if withholding exists |

Avoid exact due-date automation until the app has a maintained due-date rules table.

---

## 8. UI Requirements

The `BIR Filing Center` should:

1. Use the same selected year and quarter as the existing reports page.
2. Show a clear `Worksheet` or `Filing preparation` label.
3. Show missing data states when sales or expense reports have not been generated.
4. Use `VAT` labels only for VAT organizations.
5. Use `Percentage Tax` labels only for non-VAT `PT` organizations.
6. Keep `Income Tax` as an estimate until taxpayer classification and rate rules are implemented.
7. Avoid showing final-form language such as `ready to file` unless the output is fully validated.

---

## 9. Source Links

- [BIR Forms](https://www.bir.gov.ph/bir-forms)
- [BIR Income Tax](https://www.bir.gov.ph/income-tax)
- [BIR Percentage Tax](https://www.bir.gov.ph/percentage-tax)
- [BIR Value-Added Tax](https://www.bir.gov.ph/value-added-tax)
- [BIR Withholding Tax](https://www.bir.gov.ph/withholding-tax)
