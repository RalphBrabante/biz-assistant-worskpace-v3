# Philippine Tax & Receipt Breakdown Reference

This document captures the standard Philippine BIR-compliant receipt structure, VAT computation rules, withholding tax (EWT) mechanics, and how they map to the GIMO Biz Assistant data models. It serves as the single source of truth for implementing accurate sales and expense recording.

For tax/calculation request scoping, start with [TAX-CALCULATION-REQUEST-INTENT.md](TAX-CALCULATION-REQUEST-INTENT.md) so implementation stays aligned with the correct VAT, non-VAT, percentage-tax, or withholding-tax path.

For non-VAT businesses using percentage tax, check [PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md](PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md) before implementing calculations. Do not apply VAT extraction formulas (`/ 1.12`, `12/112`, or `* 0.12`) to percentage-tax transactions.

---

## 1. Receipt Analysis (Source Image)

The receipt from the image follows the standard Philippine POS/BIR format:

```
LINE ITEMS
------------------------------------------------------------
Item Name               Qty   Unit Price     Amount
------------------------------------------------------------
(Various food items)     1     125.00        125.00
                         1     125.00        125.00
                         1     195.00        195.00
                         1     585.00        585.00
                         1     585.00        585.00
                         1     575.00        575.00
                         1     575.00        575.00
                         1     325.00        325.00
                         1     325.00        325.00
                         1     495.00        495.00
                         1     695.00        695.00
                         1     295.00        295.00
------------------------------------------------------------

BREAKDOWN SECTION
------------------------------------------------------------
Gross Sales (VAT-inclusive)          5,190.00
Less 12% VAT                         (556.07)
Price Excl. of VAT                  4,633.93
Less: Promo/Discount/Free Items      (233.69) [if applicable]
Net Amount                          4,102.25  [after discounts, before recomputed VAT]
Add 12% VAT                           417.05  [VAT on net amount]
Service Charge                        449.22  [if applicable]
------------------------------------------------------------
Total Amount Due                    5,210.00
Cash                                5,210.00
CHANGE                                290.47

TAX SUMMARY SECTION
------------------------------------------------------------
Number of Transactions      14
VATAble Sales           4,795.45
VAT Amount                417.05
VAT Exempt Sales        1,192.55
Zero-Rated Sales            0.00
------------------------------------------------------------
```

---

## 2. BIR-Compliant Computation Flow

### 2.1 For SALES (Output VAT)

When a business sells goods or services and the price shown is **VAT-inclusive**:

```
Step 1: Gross Sales (VAT-inclusive)       = Sum of all line item amounts
Step 2: VAT Component (from gross)        = Gross Sales / 1.12 * 0.12
                                          = Gross Sales * (12/112)
Step 3: VAT-Exclusive Amount              = Gross Sales - VAT Component
                                          = Gross Sales / 1.12
Step 4: Less Discount                     = Any promo, SC/PWD, or other discounts
Step 5: Net of Discount (VATable Sales)   = VAT-Exclusive Amount - Discount
Step 6: Output VAT                        = Net of Discount * 0.12
Step 7: Total Amount Due                  = Net of Discount + Output VAT
```

**Important:** If discounts apply (e.g., Senior Citizen / PWD), the discount is applied to the VAT-exclusive amount first, then VAT is recomputed on the discounted base. This is why "Less 12% VAT" appears before the discount line.

### 2.2 For EXPENSES (Input VAT + EWT)

Expense semantics verified on 2026-09-21 for GIMO (VAT) and FBC (PT). The user confirmed that `amount` is the **final invoice total after discounts**, including any service charge. Discount and service-charge fields are informational components already reflected in that total; neither is applied again.

```
receipt_total = final invoice total after discounts, including service charges
receipt_vat = VAT actually shown on the supplier invoice
non_vat_portion = exempt / non-VAT portion of that final invoice
net_purchase_portion = receipt_total - non_vat_portion - receipt_vat
withholding_base = receipt_total - receipt_vat
withholding_tax = round(withholding_base * selected_EWT_rate, 2)
net_payable = receipt_total - withholding_tax
claimable_input_vat = receipt_vat for a VAT-registered buyer, otherwise 0
```

When VAT is calculated rather than transcribed, first subtract the exempt portion from the final receipt total, then extract VAT from the remaining gross amount. Preserve the centavo split by calculating VAT as gross minus the rounded net amount. Never divide the exempt portion by 1.12.

Supplier VAT and buyer tax registration are separate. FBC may record supplier VAT to calculate EWT accurately, but cannot claim it as input VAT. A non-VAT supplier invoice has zero supplier VAT even when the buyer is GIMO. VAT exemption does not itself exempt a payment from EWT. Selecting an EWT type applies that rate to all income on the receipt net of supplier VAT; payments with different withholding treatments must be recorded separately.

`receiptVatAmount` stores supplier VAT and `withholdingTaxBase` stores the actual EWT base. Nullable values identify historical records; reports use the recorded legacy base when the new base is absent. No blanket historical recomputation is performed.

Official basis: [BIR RR 16-2005, sections 4.106-9 and 4.110-1–2](https://bir-cdn.bir.gov.ph/BIR/pdf/26116rr16-2005.pdf) separates invoiced discounts and creditable input VAT; [RR 2-2006, section 5(G)(8)](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/11/54503) specifies the VAT-exclusive income-payment base for VAT suppliers and gross income-payment base for non-VAT suppliers.

---

## 3. VAT Classification Categories

Every sale or expense amount falls into one of three BIR-mandated categories:

| Category | VAT Rate | Description | Examples |
|---|---|---|---|
| **VATable Sales** | 12% | Standard taxable goods/services | Most commercial goods, restaurant meals, professional fees |
| **VAT-Exempt Sales** | 0% (no input credit) | Exempt by law, no VAT charged, no input tax credit allowed | Agricultural products (unprocessed), educational services, health services, residential rent <= PHP 15,000/mo |
| **Zero-Rated Sales** | 0% (input credit allowed) | Taxable at 0%, seller can still claim input VAT credits | Export sales, services to non-residents, BOI/PEZA-registered enterprises |

**Key difference:** VAT-Exempt means no VAT at all (seller cannot claim input credits). Zero-Rated means VAT is 0% but the transaction is still "taxable" (seller CAN claim input credits on related purchases).

---

## 4. Expanded Withholding Tax (EWT)

EWT is deducted by the buyer/payor from payments to suppliers and remitted to BIR on behalf of the supplier.

### 4.1 Common EWT Rates

| ATC Code | Description | Rate |
|---|---|---|
| WI010 | Purchase of goods (general) | 1% |
| WI011 | Purchase of goods by Top Withholding Agents | 1% |
| WC010 | Purchase of services (general) | 2% |
| WC011 | Purchase of services by Top Withholding Agents | 2% |
| WI100 | Professional fees (individuals) | 5% or 10% |
| WI120 | Professional fees (juridical/corporations) | 10% or 15% |
| WC100 | Rental of real property | 5% |
| WC120 | Rental of personal property (poles, satellites, etc.) | 5% |
| WI160 | Income payments to partners | 10% or 15% |

### 4.2 EWT Computation Rule

**EWT is always computed on the VAT-exclusive amount (net of VAT).**

```
Example:
  Invoice Total (VAT-inclusive):      PHP 11,200.00
  VAT-Exclusive Amount:               PHP 10,000.00   (11,200 / 1.12)
  VAT (12%):                          PHP  1,200.00
  EWT (2% on services):               PHP    200.00   (10,000 * 0.02)
  Net Amount Payable to Vendor:        PHP 11,000.00   (11,200 - 200)
```

---

## 5. Mapping to GIMO Biz Assistant Data Models

### 5.1 SalesInvoice Model

| DB Column | BIR Receipt Line | Computation |
|---|---|---|
| `amount` | Gross Sales (VAT-inclusive) | Sum of all line items (VAT-inclusive prices) |
| `taxable_amount` | VATable Sales | `amount / 1.12` minus any exempt/zero-rated portions, minus discounts |
| `vat_exempt_amount`* | VAT-Exempt Sales | Portion of sale that is VAT-exempt |
| `tax_amount` | VAT Amount (Output VAT) | `taxable_amount * 0.12` |
| `discount_amount` | Less: Discount | Promo, SC/PWD (20% of VAT-exclusive), volume discounts |
| `service_charge` | Service Charge | Optional service charge added to total |
| `withholding_tax_amount` | Withholding Tax | If buyer withheld EWT |
| `subtotal_amount` | Price Excl. of VAT | `amount / 1.12` (before discount) |
| `total_amount` | Total Amount Due | `taxable_amount + tax_amount + service_charge - withholding_tax_amount` |

### 5.2 Expense Model

| Field | Meaning |
|---|---|
| `amount` | Final invoice total after discounts, including service charges |
| `receiptVatAmount` | Actual supplier VAT, regardless of buyer registration |
| `vatExemptAmount` | Exempt/non-VAT portion of the final invoice |
| `taxableAmount` | Remaining purchase portion net of supplier VAT; not the EWT base |
| `taxAmount` | Claimable input VAT; zero for a non-VAT buyer |
| `withholdingTaxBase` | Final invoice total minus supplier VAT |
| `withHoldingTaxAmount` | Rounded withholding base times the selected EWT rate |
| `discountAmount` | Discount already reflected in `amount`; informational |
| `serviceCharge` | Service charge already included in `amount`; informational |
| `totalAmount` | Final invoice total minus EWT |


---

## 6. Recommended Form Field Flow

### 6.1 Sales Invoice Create/Edit

The form should guide the user through the BIR receipt structure:

```
Section: Amount Entry
  [Gross Sales (VAT-inclusive)]        <-- User enters this (sum from receipt)
  [Discount Amount]                    <-- Optional: promo, SC/PWD, etc.

Section: Auto-Computed Breakdown (read-only display)
  VAT-Exclusive Amount                 = Gross Sales / 1.12
  Less: Discount                       = (entered above)
  Taxable Amount (VATable Sales)       = VAT-Exclusive - Discount
  VAT Amount (12%)                     = Taxable Amount * 0.12
  Withholding Tax                      = Taxable Amount * EWT Rate (if applicable)
  -----------------------------------------
  Total Amount Due                     = Taxable Amount + VAT - Withholding Tax
```

### 6.2 Expense Create/Edit

Enter the final invoice total, the exempt portion, and supplier VAT shown on the invoice. A blank supplier VAT field uses the selected organization's VAT rate as a calculation aid; non-VAT organizations default to zero. Enter zero explicitly for a non-VAT invoice. Enter actual supplier VAT for a VAT invoice received by a non-VAT company. Always compare against the invoice.

Show supplier VAT, claimable input VAT, and the EWT base separately. Discount and service charge are informational; do not subtract or add them a second time. Block saving until the organization's tax settings and selected withholding rate have loaded. Do not estimate supplier percentage tax from the buyer's expense.

---

## 7. BIR Filing Forms Reference

| Form | Purpose | Frequency |
|---|---|---|
| **BIR 2550M** | Monthly VAT Declaration | Monthly (within 25 days after month end) |
| **BIR 2550Q** | Quarterly VAT Return | Quarterly (within 25 days after quarter end) |
| **BIR 0619-E** | Monthly Remittance of EWT | Monthly (on or before 10th of following month) |
| **BIR 1601-EQ** | Quarterly Remittance of EWT | Quarterly |
| **BIR 2307** | Certificate of Creditable Tax Withheld at Source | Issued to vendor per transaction/period |

---

## 8. Key Rules to Remember

1. **Standard VAT is 12%** for VAT-registered calculations in the Philippines (as of 2026); non-VAT percentage-tax businesses use separate percentage-tax rules.
2. **VAT-inclusive to exclusive:** Divide by 1.12 (not multiply by 0.88).
3. **VAT extraction formula:** `VAT = Amount * (12/112)` or equivalently `Amount / 1.12 * 0.12`.
4. **Discounts before VAT:** SC/PWD and promo discounts are applied to the VAT-exclusive amount BEFORE recomputing VAT.
5. **EWT on VAT-exclusive:** Withholding tax is always computed on the VAT-exclusive (net of VAT) amount.
6. **Three sales categories** must be tracked: VATable, VAT-Exempt, Zero-Rated.
7. **Receipts must show** the breakdown of VATable Sales, VAT Amount, VAT-Exempt Sales, and Zero-Rated Sales.

---

## Sources

- [How to Compute VAT and EWT in the Philippines - FilePino](https://www.filepino.com/how-to-compute-vat-and-ewt-in-the-philippines/)
- [How to Compute VAT and EWT in the Philippines - Triple-i Consulting](https://www.tripleiconsulting.com/how-compute-vat-ewt-philippines-a-guide/)
- [Philippines VAT and BIR Complete Guide - Deskera](https://www.deskera.com/blog/philippines-vat-bir/)
- [VAT in the Philippines: Rates, Registration & Compliance - Acclime](https://philippines.acclime.com/guides/vat/)
- [Withholding Taxes in the Philippines - iScale Solutions](https://iscale-solutions.com/withholding-taxes-in-the-philippines/)
- [Withholding Taxes Guide - Forvis Mazars Philippines](https://www.forvismazars.com/ph/en/insights/tax-alerts/withholding-taxes-in-the-philippines-transactions)
- [BIR Official Receipts and Sales Invoices - Tax Acctg Center](https://taxacctgcenter.ph/bir-official-receipts-and-sales-invoices-in-the-philippines/)
- [BIR Tax Compliance Philippines 2026 Guide](https://philippinehubpartners.com/bir-tax-compliance-philippines-2026-guide/)
- [VAT Philippines 2026 Guide - CloudCFO](https://cloudcfo.ph/resources/ph-taxes/vat/)
- [How to Calculate VAT and EWT Philippines - Business Registration PH](https://businessregistrationphilippines.com/how-calculate-vat-ewt-philippines-detailed-approach/)
- [List of BIR ATC Codes - Taxumo](https://www.taxumo.com/blog/list-of-bir-atc-for-income-tax-filing-and-withholding-tax/)
- [BIR Withholding Tax Official Page](https://www.bir.gov.ph/WithHoldingTax)
