# Philippine Tax & Receipt Breakdown Reference

This document captures the standard Philippine BIR-compliant receipt structure, VAT computation rules, withholding tax (EWT) mechanics, and how they map to the GIMO Biz Assistant data models. It serves as the single source of truth for implementing accurate sales and expense recording.

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

When recording a purchase/expense from a vendor's receipt:

```
Step 1: Total on Receipt (VAT-inclusive)  = Amount paid or billed
Step 2: VAT-Exclusive Amount              = Total / 1.12
Step 3: Input VAT (12%)                   = VAT-Exclusive Amount * 0.12
                                          = Total * (12/112)
Step 4: VAT-Exempt Portion                = Any line items exempt from VAT
Step 5: Taxable Amount                    = VAT-Exclusive - VAT-Exempt Portion
Step 6: Withholding Tax (EWT)             = Taxable Amount * EWT Rate
Step 7: Net Amount Payable                = Total - Withholding Tax
```

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

| DB Column | Receipt Line | Computation |
|---|---|---|
| `amount` | Total on Receipt (VAT-inclusive) | What appears on the vendor's receipt/invoice |
| `taxable_amount` | VATable portion (net of VAT) | `(amount - vat_exempt_amount) / 1.12` |
| `vat_exempt_amount` | VAT-Exempt portion | Amount of items/services exempt from VAT |
| `tax_amount` | Input VAT | `taxable_amount * 0.12` |
| `discount_amount` | Discount | Any discount received from vendor |
| `service_charge` | Service Charge | Service charge shown on receipt (included in total) |
| `withholding_tax_amount` | EWT Deducted | `taxable_amount * ewt_rate` |
| `withholding_tax_type_id` | ATC Code reference | Links to WithholdingTaxType for rate and ATC code |
| `tax_type_id` | VAT Type reference | Links to TaxType for the applicable VAT rate |
| `total_amount` | Net Amount Payable | `amount - withholding_tax_amount` |

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

```
Section: Amount Entry
  [Total on Receipt (VAT-inclusive)]   <-- User enters this
  [VAT-Exempt Amount]                  <-- Portion that is VAT-exempt (if any)
  [Discount Amount]                    <-- Optional

Section: Withholding Tax
  [Withholding Tax Type]               <-- Select ATC code (auto-fills rate)
  [Withholding Tax Rate]               <-- Auto-filled from selected type

Section: Auto-Computed Breakdown (read-only display)
  VAT-Inclusive Amount                 = Total on Receipt
  Less: VAT-Exempt                     = (entered above)
  VATable Amount (inclusive)            = Total - VAT-Exempt
  VAT-Exclusive (Taxable Amount)       = VATable Amount / 1.12
  Input VAT (12%)                      = Taxable Amount * 0.12
  Withholding Tax (EWT)                = Taxable Amount * EWT Rate
  -----------------------------------------
  Net Amount Payable                   = Total - Withholding Tax
```

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

1. **VAT is always 12%** in the Philippines (as of 2026).
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
