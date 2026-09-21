# Expense tax audit — 2026-09-21

Scope: local GIMO/FBC database and Add Expense, edit, import, transfer, previews, and withholding report calculations.

User-confirmed entry convention: `amount` is the final invoice total after discounts, including service charges.

## Existing records

- GIMO: 12% VAT, PHP. 245 expenses checked; no arithmetic mismatch in the saved VAT split or payable totals. This check does not verify invoices or input-VAT eligibility against supporting documents.
- FBC: 3% percentage tax, PHP. One historical expense incorrectly extracts percentage tax into input VAT.

## Historical discrepancy — left unchanged by user request

Expense ID: `b19bb83c-9219-463b-b587-f82875f1d0a2`
Company: FBC
Expense date: 2025-01-14

| Field | Recorded | Corrected |
|---|---:|---:|
| Receipt total | 5,888.18 | 5,888.18 |
| Recorded purchase amount excluding the erroneous 3% split | 5,716.68 | 5,888.18 |
| Claimable input VAT | 171.50 | 0.00 |
| EWT | 0.00 | 0.00 |
| Net payable | 5,888.18 | 5,888.18 |

The historical row's supplier VAT has not been verified from an invoice; leave the new supplier-VAT field null. This correction removes the invalid percentage-tax extraction, preserves the actual receipt/payable total, and does not file or amend a tax return. The user explicitly chose to leave this historical expense unchanged. No correction was applied.

The project guide, `TAX-CALCULATION-REQUEST-INTENT.md`, says: “Do not silently alter historical transactions unless a migration is explicitly requested.”

## Corrected calculation contract

- Receipt total already includes discounts and service charges. Do not apply them twice.
- Extract VAT only from the portion remaining after the exempt portion, or use actual supplier VAT entered from the invoice.
- Supplier VAT is separate from buyer-claimable input VAT; FBC always has zero claimable input VAT.
- EWT base is final receipt total less supplier VAT. Exemption from VAT alone does not remove income from the selected EWT base.
- Preserve centavo splits using integer arithmetic.
- Percentage tax is not calculated on a buyer's expense.

References: [BIR RR 16-2005](https://bir-cdn.bir.gov.ph/BIR/pdf/26116rr16-2005.pdf), [RR 2-2006, section 5(G)(8)](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/11/54503).

## Verification

- 38 expense tests passed: API calculation/controller regressions and frontend/API parity across VAT, PT and NON_VAT (more than 4,000 centavo-boundary inputs). Eight organization-message regressions also passed.
- Real database create/edit checks for standard and mixed receipts in both companies passed inside a rolled-back transaction. Clearing EWT restored the full receipt total.
- Rollback verified: 246 expenses and 109 vendors remained; no test records or notifications were retained.
- Live browser checks on localhost passed for GIMO mixed receipts, non-VAT suppliers, clearing EWT, FBC with and without supplier VAT, and invalid supplier-VAT validation. No forms were saved.
- Angular production and API TypeScript builds passed. Angular reports an initial bundle budget warning and a Bootstrap selector warning.
- The additive nullable-column migration was applied locally; no historical monetary values were recalculated.

Re-run from the workspace root: `npm --prefix api run test:expenses` and `npm --prefix client run test:expenses`. Frontend/API parity tests require both submodules to be present.
