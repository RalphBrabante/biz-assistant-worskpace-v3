# Tax Calculation Request Intent Guide

Last reviewed: 2026-07-08

Use this file whenever a request mentions Philippine tax, VAT, non-VAT, percentage tax, withholding tax, invoices, receipts, sales reports, expense reports, order totals, or any calculation that affects taxable amounts.

The goal is to keep implementation aligned with the tax references and prevent requirements from drifting into mixed VAT/non-VAT behavior.

---

## 1. Intent Classification

Before editing code, classify the request into one primary intent:

| Intent | Meaning | Required reference |
|---|---|---|
| VAT calculation | VAT-registered sales, expenses, input VAT, output VAT, VAT-exclusive extraction | `PH-TAX-RECEIPT-REFERENCE.md` |
| Non-VAT percentage tax | Non-VAT business, `PT`, percentage tax, BIR 2551Q, gross receipts tax | `PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md` |
| Withholding tax | EWT, ATC codes, BIR 2307, withheld amount, net payable | `PH-TAX-RECEIPT-REFERENCE.md` |
| Mixed tax UI | Forms/previews/reports that must support both VAT and non-VAT orgs | Both tax references |
| Historical tax period | Recomputing old transactions or reports by transaction date | Both tax references, especially effective dates |
| Non-tax order math | Quantity, subtotal, discount, service charge, shipping, payment total only | Existing order logic, then check tax references if tax fields are touched |

If the request touches both display and persistence, treat it as a mixed frontend/backend calculation request.

---

## 2. Non-Drift Rules

Every tax-related implementation must follow these rules:

1. Do not invent tax behavior outside the reference Markdown files.
2. Do not reuse VAT formulas for percentage tax.
3. Do not merge VAT amount and percentage tax due into one ambiguous user-facing label.
4. Do not change seeded tax meanings without updating the references and tests.
5. Do not silently alter historical transactions unless a migration is explicitly requested.
6. Do not assume every Philippine business is VAT-registered.
7. Do not assume percentage tax is customer-added VAT; percentage tax is a seller business tax unless a product setting explicitly says it is passed on.
8. Do not add new tax requirements from memory. If the rule is not in the Markdown references, verify it against official/current sources first, then update the Markdown before coding.

---

## 3. Required Reading By Request

For any request related to taxes or calculations:

1. Read this file.
2. Read `PH-TAX-RECEIPT-REFERENCE.md`.
3. If non-VAT, `PT`, or percentage tax is involved, read `PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md`.
4. Inspect the existing frontend and backend calculation code before changing behavior.
5. Add or update tests for every tax mode affected.

This keeps the implementation inline with the documented concept instead of letting requirements spread across forms, previews, reports, and API payloads in slightly different ways.

---

## 4. Implementation Alignment Checklist

Use this checklist before finalizing a tax/calculation change:

- [ ] The request intent is classified.
- [ ] The relevant tax reference files were read.
- [ ] Frontend display labels match the selected tax mode.
- [ ] Backend persisted fields match the selected tax mode.
- [ ] VAT mode still uses VAT extraction only where appropriate.
- [ ] Percentage-tax mode never divides by `1.12`.
- [ ] Reports and previews show the same totals from the same calculation source.
- [ ] Tests include the changed tax mode and at least one contrast case if VAT/PT branching is touched.
- [ ] Documentation was updated if behavior changed.

---

## 5. Canonical Formula Boundaries

VAT mode:

```
vat_exclusive_amount = vat_inclusive_amount / 1.12
vat_amount = vat_inclusive_amount * (12 / 112)
```

Percentage-tax mode:

```
percentage_tax_base = gross_receipts
percentage_tax_due = gross_receipts * 0.03
vat_amount = 0
```

Never combine these formula families in one transaction calculation path.

---

## 6. When To Ask Or Verify

Ask the user or verify against official/current sources when:

- The request changes a legal tax rate, threshold, filing rule, or effective date.
- The request asks for a tax treatment not covered by the current Markdown references.
- The request involves special industries with percentage-tax rates other than the general 3% Section 116 rate.
- The requested UI behavior would pass percentage tax to the customer as if it were VAT.
- Historical reports must be recomputed across the 2020-07-01 to 2023-06-30 temporary 1% percentage-tax period.

---

## 7. Related References

- `PH-TAX-RECEIPT-REFERENCE.md`
- `PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md`
