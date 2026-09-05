# TODO

This file contains the long-lived roadmap and the recipe for adding Fortnox
resources. [GitHub Issues](https://github.com/Magnus-Gille/noxctl/issues) are the
canonical operational backlog; [STATUS.md](STATUS.md) contains the current
execution handoff. Current release and capability information belongs in the
package metadata, changelog, and README rather than as snapshots here.

## API Drift Detection

Weekly GitHub Actions workflow (`api-drift.yml`) fetches the Fortnox OpenAPI spec and compares it against the committed **fingerprint** (`api-spec/openapi-fingerprint.json` — opaque hashes only; the full spec is not stored in the repo, per Fortnox Developer Agreement cl. 6.1/6.3). Opens a GitHub issue labeled `api-drift` when endpoints/schemas change. Run locally with `npm run check:api`. Can also be triggered manually from the Actions tab.

After fetching the local, git-ignored cache, run `npm run audit:schemas` to inventory
every discovered mutating MCP tool and recursively compare every mapped structured
input with its OpenAPI payload component. Normal output and
`api-spec/tool-schema-coverage.json` contain stable IDs, counts, result classes, and
opaque hashes only. Use
`npm run audit:schemas -- --show-fields` for an explicit local diagnostic, and update
the baseline with `npm run audit:schemas -- --update` only after reviewing an intended
specification or tool-schema change. The weekly workflow runs this audit after fetching
the spec.

`npm run audit:api-coverage` verifies the complete operation inventory against
`api-spec/api-implementation-map.json`, including real operation exports, MCP tool
discovery, and CLI help. The committed map and baseline are opaque; raw paths and
operation IDs are available only with `--show-details`. The release gate runs the
offline evidence check, while the weekly workflow also detects new or removed upstream
families and operations.

## Roadmap

### Tier 2 — Usability

1. ~~Better confirmation preview (show payload before y/N prompt)~~ ✅ Done
2. ~~Selective analytics MCP tools (overdue invoices, unpaid totals, top customers, VAT summary)~~ ✅ Done
3. ~~Shell completions~~ ✅ Done
4. ~~Natural date periods (`Q1`, `march`)~~ ✅ Done (calendar-year based; fiscal-year awareness still open)
5. Claude Desktop auto-registration in `init`

### Tier 3 — More API Coverage

6. ~~**Projects / Cost Centers**~~ ✅ Done
7. ~~**Contracts** — recurring invoicing automation~~ ✅ Done
8. ~~**Tax Reductions (ROT/RUT)**~~ ✅ Done
9. ~~**Price Lists / Prices**~~ ✅ Done
10. ~~**Financial Years / Locked Period**~~ ✅ Done
17. ~~**Payroll / Lön** — employees, salary/attendance/absence transactions, schedule times (opt-in `salary` scope)~~ ✅ Done
18. ~~**Core API lifecycle parity** — complete current resource operations with explicit product-boundary exclusions~~ ✅ Done (#153)
19. ~~**Reference/setup reads** — currencies, units, payment/delivery settings, voucher series, account charts and customer references~~ ✅ Done (#154)
20. ~~**Accruals** — invoice, supplier-invoice and contract accrual CRUD~~ ✅ Done (#155)
21. ~~**Archive, inbox and file connections** — binary-safe downloads and complete selected attachment lifecycles~~ ✅ Done (#156)

### Tier 4 — Backlog

11. ~~CLI `dashboard` command~~ ✅ Done
12. Bilingual MCP descriptions (Swedish primary + English keywords)
13. MCP capability resource
14. Bank transactions — **still blocked upstream, but the premise has changed.** As of
    the 2026-08-17 spec, Fortnox *does* publish bank endpoints — but they are
    `/api/bank-process-orders/v1`, `/api/bank-process-start-orders/v1` and
    `/api/bank-process-webhooks/v1`: a company-formation / bank-account-onboarding
    and KYC document flow for partners, not an accounting surface. There is still
    **no** bank transaction, statement or feed endpoint anywhere in the spec, so
    there remains nothing to implement for reading bank transactions. Re-check when
    the drift workflow reports a genuinely transactional bank path. See issue #13.
15. ~~File attachments (underlag) — upload receipts, attach to vouchers~~ ✅ Done (#37) — `noxctl vouchers attach`; live use needs the **archive** scope
16. Live mutation test coverage — only read paths tested live
17. Evaluate moving `fortnox_income_statement` and `fortnox_balance_sheet`
    onto the SIE export (`src/sie.ts`, added for `fortnox_general_ledger`) to
    avoid their per-voucher detail requests. `fortnox_tax_report` does not
    perform that detail walk (see `src/operations/tax.ts`) and needs a separate
    assessment of whether SIE would help. Keep SRU-based report grouping as a
    separate design task:
    mappings can require multiple codes and sign-dependent handling, while
    the current SIE parser retains only one SRU code per account. Verify the
    reported `fortnox_income_statement` table/`includeRaw` `netResult` sign
    discrepancy separately before changing its report contract.

## Adding a New Resource

Each Fortnox resource follows the same pattern — 5 files:

1. `src/operations/<resource>.ts` — API calls (list, get, create, update, etc.)
2. `src/tools/<resource>.ts` — MCP tool registrations with Zod schemas (Swedish descriptions)
3. `src/views.ts` — add column definitions for list/detail/confirm views
4. `src/cli.ts` — Commander subcommands mirroring the MCP tools 1:1
5. `src/index.ts` — register the tools

Tests (3 files):
- `tests/operations/<resource>.test.ts` — unit tests for operations (mock fetch)
- `tests/tools/<resource>.test.ts` — MCP integration tests (in-memory transport)
- `tests/cli.test.ts` — add smoke tests for `--help` output

Also update `src/fortnox-client.ts` endpoint-to-scope mapping if the resource uses a new scope.
