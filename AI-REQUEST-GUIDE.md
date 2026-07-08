# AI Request Guide

Last reviewed: 2026-07-08

This is the main Markdown file to check before handling any AI prompt request in this workspace.

Use it as the routing and alignment guide. It does not replace the detailed references; it tells the agent which references to read and what guardrails must stay true.

---

## 1. First Step For Every Request

Before planning or editing:

1. Read this file.
2. Identify the request type.
3. Read the required reference files for that request type.
4. Inspect existing code before changing behavior.
5. Keep changes scoped to the request.
6. Update documentation when behavior, workflow, or assumptions change.

---

## 2. Request Routing

| Request mentions | Required references |
|---|---|
| Tax, VAT, non-VAT, percentage tax, withholding, BIR, invoices, receipts, sales reports, expense reports, taxable totals | `TAX-CALCULATION-REQUEST-INTENT.md`, then the relevant tax reference |
| BIR filing reports, income tax reports, filing calendar, SAWT/QAP/SLSP, BIR form worksheets | `PH-BIR-FILING-REPORTS-IMPLEMENTATION.md`, then the relevant tax reference |
| VAT, output VAT, input VAT, VAT-exclusive, `/ 1.12`, `12/112`, EWT | `PH-TAX-RECEIPT-REFERENCE.md` |
| Non-VAT, `PT`, percentage tax, BIR 2551Q, gross receipts | `PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md` |
| Backend API, database, models, migrations, seeders, services | `CLAUDE.md`, `api/src/ARCHITECTURE.md` if architecture context is needed |
| Frontend UI, Angular pages, forms, previews, reports | `CLAUDE.md`, then inspect the target component and related services |
| Deployment, Docker, Nginx, production setup | `README.md`, compose files, nginx configs |
| General code change with no special domain | `CLAUDE.md`, then inspect the relevant files |

If a request falls into multiple rows, read all matching references.

---

## 3. Global Guardrails

Every implementation must follow these rules:

1. Do not invent business rules when a reference file already defines them.
2. Do not let frontend, backend, reports, and previews calculate the same concept differently.
3. Do not change seeded system meanings without updating docs and tests.
4. Do not rewrite historical data unless the user explicitly asks for a migration or backfill.
5. Do not mix unrelated refactors into a focused request.
6. Do not overwrite user changes in the working tree.
7. Prefer existing project patterns over new abstractions.
8. Add focused tests when changing calculations, persistence, permissions, or user-facing workflow.

---

## 4. Tax And Calculation Guardrails

For tax/calculation requests, always start with `TAX-CALCULATION-REQUEST-INTENT.md`.

Keep these formula boundaries intact:

```text
VAT:
vat_exclusive_amount = vat_inclusive_amount / 1.12
vat_amount = vat_inclusive_amount * (12 / 112)

Percentage tax:
percentage_tax_base = gross_receipts
percentage_tax_due = gross_receipts * 0.03
vat_amount = 0
```

Never apply VAT extraction to non-VAT percentage-tax transactions.

---

## 5. Completion Checklist

Before final response:

- [ ] Correct reference files were checked.
- [ ] Code changes match existing project patterns.
- [ ] Tax/calculation behavior, if touched, matches the Markdown references.
- [ ] Relevant tests or verification were run, or the reason they were not run is stated.
- [ ] New or changed behavior is documented.
- [ ] Final response names the important files changed.

---

## 6. Reference Index

- `CLAUDE.md` - main workspace business and architecture context loaded by Claude Code.
- `TAX-CALCULATION-REQUEST-INTENT.md` - tax/calculation request classifier and anti-drift guide.
- `PH-TAX-RECEIPT-REFERENCE.md` - VAT, receipt, expense, and EWT reference.
- `PH-NON-VAT-PERCENTAGE-TAX-IMPLEMENTATION.md` - non-VAT percentage-tax implementation guide.
- `PH-BIR-FILING-REPORTS-IMPLEMENTATION.md` - BIR filing worksheet/reporting guide.
- `README.md` - workspace setup, Docker, and deployment reference.
- `api/src/ARCHITECTURE.md` - backend architecture notes.
