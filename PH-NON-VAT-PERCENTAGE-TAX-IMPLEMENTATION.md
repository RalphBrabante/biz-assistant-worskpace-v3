# Philippine Non-VAT Percentage Tax Implementation Reference

Last reviewed: 2026-07-08

Use this file before implementing or reviewing frontend/backend tax calculations for Philippine businesses that are non-VAT and subject to percentage tax.

For request scoping, start with [TAX-CALCULATION-REQUEST-INTENT.md](TAX-CALCULATION-REQUEST-INTENT.md), then use this file when the request involves non-VAT, `PT`, percentage tax, BIR 2551Q, or gross receipts calculations.

This is an engineering reference, not legal advice. If BIR rules change, update this file, the seeded `PT` tax type, and calculation tests together.

---

## 1. Current Rule Summary

For a Philippine business that is not VAT-registered and whose sales/receipts are VAT-exempt under the small-business VAT threshold, percentage tax applies instead of 12% VAT.

As of 2026-07-08:

| Item | Rule |
|---|---|
| Tax type | Percentage Tax (`PT`) |
| Current rate | 3% |
| Tax base | Gross quarterly sales or receipts |
| VAT threshold reference | Gross annual sales and/or receipts do not exceed PHP 3,000,000 |
| Filing return | BIR Form 2551Q, Quarterly Percentage Tax Return |
| Historical trap | The 1% CREATE Act rate applied only from 2020-07-01 through 2023-06-30. Do not use 1% for current-period calculations unless calculating an old period inside that range. |

Primary law reference: CREATE Act amendment to NIRC Section 116 says persons exempt from VAT under Section 109(CC) and not VAT-registered pay 3% of gross quarterly sales or receipts, with the temporary 1% rate effective only from 2020-07-01 until 2023-06-30.

---

## 2. Eligibility Checks

Treat an organization/customer context as non-VAT percentage-tax only when all are true:

1. Organization tax type is `PT` / Percentage Tax.
2. Organization is not VAT-registered.
3. Gross annual sales/receipts are within the VAT-exempt threshold, currently PHP 3,000,000 under Section 109(CC).
4. The transaction is not one of the special percentage-tax industries with a different rate under Title V of the NIRC.

Implementation assumption for GIMO: the seeded `PT` tax type at 3.00% represents the general small non-VAT taxpayer under NIRC Section 116, not special industries such as banks, carriers, franchises, insurance, or amusement businesses.

---

## 3. Calculation Rules

### 3.1 Non-VAT Sale

For non-VAT percentage-tax sellers, do not extract VAT and do not divide by 1.12.

```
gross_sales = sum(line_item_amounts)
vatable_sales = 0
vat_amount = 0
vat_exempt_sales = gross_sales
percentage_tax_base = gross_sales
percentage_tax_due = gross_sales * 0.03
customer_total_due = gross_sales - discounts + service_charge
```

Important: percentage tax is a seller business tax. It is not the same as output VAT. Unless the product explicitly chooses to display or pass it on, the customer's payable total should not automatically become `gross_sales + percentage_tax_due`.

### 3.2 Non-VAT Expense From a Non-VAT Supplier

For purchases from a non-VAT supplier:

```
receipt_total = amount paid or billed
input_vat = 0
vatable_purchase = 0
vat_exempt_purchase = receipt_total
percentage_tax_due_by_supplier = not recorded as buyer input VAT
```

The buyer cannot claim input VAT from a non-VAT receipt/invoice.

### 3.3 Discounts and Service Charges

Use the actual gross receipts/sales basis for percentage tax reporting. In app calculations, keep these fields separate:

```
gross_sales_before_discount
discount_amount
service_charge
gross_receipts_for_pt = gross_sales_before_discount - discount_amount + taxable_service_charge_if_applicable
percentage_tax_due = gross_receipts_for_pt * 0.03
```

If the receipt/reporting model cannot reliably classify service charges, keep `percentage_tax_base` explicit and auditable rather than hiding it inside `total_amount`.

### 3.4 Rounding

Use decimal arithmetic, not binary floating point.

Recommended:

1. Store money in cents/centavos or use a decimal library.
2. Round display amounts to 2 decimal places.
3. Round persisted tax amounts to 2 decimal places at transaction/report finalization.
4. For quarterly reports, prefer summing unrounded source amounts then rounding the final tax due, unless existing BIR form/report requirements or accounting policy require per-transaction rounding.

---

## 4. Frontend Requirements

When organization tax type is `PT`:

1. Show `Percentage Tax (3%)`, not `VAT (12%)`.
2. Hide or zero out VAT extraction lines:
   - `VATable Sales`
   - `VAT Amount`
   - `Input VAT`
   - `Output VAT`
   - `Price Excl. of VAT`
3. Do not show formulas using `/ 1.12`, `12/112`, or `* 0.12`.
4. Label sales as non-VAT or VAT-exempt sales where a BIR-style breakdown is needed.
5. Show `Percentage Tax Base` and `Percentage Tax Due` in reports/admin accounting views.
6. Do not automatically add percentage tax to customer total unless a business setting explicitly says tax is passed on and the receipt wording supports it.

Suggested sale preview for `PT`:

```
Gross Sales / Receipts       PHP 10,000.00
VAT Amount                   PHP      0.00
VAT-Exempt / Non-VAT Sales   PHP 10,000.00
Percentage Tax Base          PHP 10,000.00
Percentage Tax Due (3%)      PHP    300.00
Total Amount Due             PHP 10,000.00
```

---

## 5. Backend Requirements

When tax type code is `PT`:

1. Branch calculations by tax type code/rate category, not only by numeric percentage.
2. Set VAT fields to zero:
   - `tax_amount`
   - output VAT
   - input VAT
3. Do not calculate `taxable_amount = amount / 1.12`.
4. Calculate percentage tax separately from VAT:

```
percentage_tax_base = gross_receipts
percentage_tax_amount = round(gross_receipts * (percentage / 100), 2)
```

5. Reports should aggregate:
   - total gross receipts
   - non-VAT/VAT-exempt sales
   - percentage tax base
   - percentage tax due
6. Preserve the seeded system tax type:
   - `code = PT`
   - `name = Percentage Tax`
   - `percentage = 3.00`

If historical reports are introduced, use an effective-dated tax rate table:

| Period | General Section 116 PT rate |
|---|---:|
| before 2020-07-01 | 3% |
| 2020-07-01 to 2023-06-30 | 1% |
| 2023-07-01 onward | 3% |

---

## 6. Acceptance Test Cases

### Current Non-VAT Sale

Input:

```
tax_type = PT
amount = 10000.00
discount = 0.00
service_charge = 0.00
transaction_date = 2026-07-08
```

Expected:

```
vat_amount = 0.00
vatable_sales = 0.00
vat_exempt_sales = 10000.00
percentage_tax_base = 10000.00
percentage_tax_amount = 300.00
customer_total_due = 10000.00
```

### Current VAT Sale, For Contrast

Input:

```
tax_type = VAT
amount = 11200.00
transaction_date = 2026-07-08
```

Expected:

```
vatable_sales = 10000.00
vat_amount = 1200.00
customer_total_due = 11200.00
```

### Historical CREATE-Period Non-VAT Sale

Only needed if the app supports historical recomputation by tax period.

Input:

```
tax_type = PT
amount = 10000.00
transaction_date = 2022-01-15
```

Expected:

```
percentage_tax_rate = 1.00
percentage_tax_amount = 100.00
```

### Post-CREATE Non-VAT Sale

Input:

```
tax_type = PT
amount = 10000.00
transaction_date = 2023-07-01
```

Expected:

```
percentage_tax_rate = 3.00
percentage_tax_amount = 300.00
```

---

## 7. Implementation Checklist For Codex

Before changing calculations:

- [ ] Check this file and `PH-TAX-RECEIPT-REFERENCE.md`.
- [ ] Locate every frontend formula using `/ 1.12`, `12/112`, `0.12`, or `VAT`.
- [ ] Locate every backend formula using `/ 1.12`, `12/112`, `0.12`, or `tax_amount`.
- [ ] Confirm whether the organization tax type is loaded into create/edit/preview/report screens.
- [ ] Add a tax calculation helper/service if VAT and PT formulas are duplicated.
- [ ] Add tests for both `VAT` and `PT`; never test only one tax type.
- [ ] Verify reports do not mix VAT amount and percentage tax due in the same field unless the field is explicitly a generic business tax amount.
- [ ] Keep existing user data intact; do not rewrite historical transactions unless a migration is specifically requested.

---

## 8. Source Links

- [Republic Act No. 11534 (CREATE Act), Lawphil](https://lawphil.net/statutes/repacts/ra2021/ra_11534_2021.html)
- [BIR Percentage Tax page](https://www.bir.gov.ph/percentage-tax)
- [BIR Forms page](https://www.bir.gov.ph/bir-forms)
- [National Internal Revenue Code / RA 8424, Lawphil](https://lawphil.net/statutes/repacts/ra1997/ra_8424_1997.html)
- [Republic Act No. 10963 (TRAIN Law), Lawphil](https://lawphil.net/statutes/repacts/ra2017/ra_10963_2017.html)
