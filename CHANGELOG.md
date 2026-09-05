# Changelog

All notable changes to noxctl are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Supplier-invoice attachments can now be listed and downloaded.**
  `noxctl supplier-invoices attachments <givenNumber>` and
  `fortnox_list_supplier_invoice_attachments` list files (e.g. the scanned or
  emailed invoice itself) attached to a supplier invoice; `noxctl
  supplier-invoices file <fileId>` and `fortnox_get_supplier_invoice_file`
  download them. Unlike voucher attachments, this reaches the original
  document directly, so it works for `unbooked`/`authorizepending` invoices —
  before they've been bookkept into a voucher. No new scope required.
- **General ledger: bookkeeping transactions with amounts for a date range.**
  `noxctl general-ledger list --from <date> --to <date>` and
  `fortnox_general_ledger` return one row per posting (date, voucher, account,
  debit, credit, text), with optional account and series filters. Reads one
  SIE4 export for the period, with a financial-year lookup when needed.
  This avoids individual voucher-detail requests;
  `fortnox_list_vouchers` does not include transaction amounts.
  Row dates override voucher dates when present. Escaped quotation marks are
  decoded, tab separators are accepted, and malformed amounts or amounts that
  lose cent precision are rejected. Thanks to @hedborg for the implementation
  (#161).

## [0.9.0] - 2026-08-31

### Added

- **Voucher attachments can now be listed and downloaded.**
  `noxctl vouchers attachments <series> <number> [--year]` and
  `fortnox_list_voucher_attachments` list existing receipt/underlag connections;
  `noxctl vouchers file <fileId>` and `fortnox_get_voucher_file` download the
  original PDF, image or other file. Thanks to @hedborg for the implementation
  and byte-for-byte verification against live Fortnox data (#144).
- **Customer-invoice attachments can now be uploaded and listed.**
  `noxctl invoices attach <docNumber> <file...>` and
  `fortnox_attach_invoice_files` upload files through the Fortnox archive and
  attach them to a customer invoice; matching CLI and MCP list operations expose
  current attachments. Uploading requires the opt-in `archive` scope, so existing
  users who need this feature must reauthorize with
  `noxctl init --with-archive`. Thanks to @hedborg for tracing the required
  `inbox_kf` / `ArchiveFileId` flow and covering it with live verification and
  regression tests (#145).

### Internal

- Remediated development-dependency audit findings and strengthened CI so both
  production and development dependency audits must pass (#141).

## [0.8.0] - 2026-08-29

### Added

- **Supported embedded runtime API.** Hosts can import `noxctl/embedded`, inject a
  tenant-authorized Fortnox transport, and create isolated clients, operations and
  MCP servers without importing private `dist/` paths. Concurrent tenant tests cover
  token, data, diagnostic and rate-limit isolation (#118–#122).
- **Privacy-preserving MCP write-schema audit.** Six high-risk create/update schemas
  are compared with the locally fetched Fortnox OpenAPI document while normal output
  exposes only stable mapping IDs, counts and domain-separated hashes. The weekly API
  drift workflow now runs the same audit and opens deduplicated issues without
  publishing the full specification or raw property names (#129, #136).
- **Deterministic version tooling.** `npm run version:set -- <semver>` synchronizes
  package, lockfile, runtime and MCP registry metadata, while `npm run version:check`
  fails CI and the release gate on drift. The setter has no Git, network, tagging or
  publication side effects (#138).

### Changed

- MCP write schemas for supplier-invoice, invoice, offer and order rows now cover all
  fields in the current Fortnox request components while preserving documented legacy
  compatibility. All six audited first-wave mappings report zero missing fields
  (#131).
- MCP input objects reject unknown properties instead of silently stripping misspelled
  or unsupported arguments before a Fortnox mutation (#127).

### Fixed

- Credential recovery now distinguishes available, missing, locked and inaccessible
  keychain state and fails closed when a registered profile is hidden by a sandbox or
  otherwise unreadable. Recovery diagnostics identify the effective profile and
  credential source without replacing credentials automatically (#117).
- Embedded construction fails closed without a host-authorized transport, and invoice
  email/e-invoice delivery is classified as non-retryable so a timeout cannot cause a
  duplicate send (#122).

## [0.7.4] - 2026-08-28

### Changed

- Refreshed the repository front page for first-time visitors with a concise trust model, feature summary, quick start, status badges, and navigation into the full reference.
- Added canonical npm repository, issue, homepage, and discovery metadata so package registries and tooling link back to the correct project surfaces.

### Fixed

- Corrected contributor clone instructions and the private security-advisory link that still used the repository's former `fortnox-mcp` name.

## [0.7.3] - 2026-08-27

### Fixed

- **Income statements and balance sheets no longer fetch every voucher sequentially.** Voucher detail reads now use a five-worker pool while the shared Fortnox client continues to enforce the 25-request-per-5-second limit. This removes round-trip latency as the dominant per-voucher bottleneck for large financial years. Removed voucher rows (`Removed: true`) are also excluded from report totals because Fortnox has replaced those rows. Thanks to @MountRose76 for the report, measurements, diagnosis, and independent result comparison (#108).

## [0.7.2] - 2026-08-19

### Fixed

- **`fortnox_create_voucher` silently dropped per-row fields.** `VoucherRowSchema` declared only `Account`, `Debit`, `Credit` and `Description`, and the MCP SDK strips any argument a schema does not declare — so a per-line note passed as `TransactionInformation` never reached Fortnox, with no error and a voucher that booked fine minus the data. The schema now covers the full `VoucherRowSinglePayloadItem` set: `TransactionInformation`, `CostCenter`, `Project`, `Quantity` and `Removed`. `createVoucher()` already forwarded rows verbatim, so the schema was the only place fields were lost. Same root cause as the Supplier gap in #96; the test asserts the declared property list so it cannot drift again. Thanks to @hedborg (#101).
- Row-level `Description` now documents that Fortnox normally overwrites it with the account's own registered name, and points callers at `TransactionInformation` for per-line free text. **Not independently confirmed against a live account** — reported from real usage and adopted because the guidance is right either way: `TransactionInformation` is unambiguously the per-line free-text field.


## [0.7.1] - 2026-08-19

### Internal

- Raised the CLI subprocess timeout in tests from 10s to 30s (and the Vitest per-test timeout to 45s, which has to exceed it). Spawning `node dist/cli.js` on a cold Windows CI runner regularly approached 10s, so these subprocess assertions flaked intermittently — the failure looked like an empty stderr rather than a timeout, which is unhelpfully misleading.

### Changed

- `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0 (supersedes Dependabot #89).
- **Dropped the `@hono/node-server` override.** SDK 1.30.0 widens its dependency range to `^1.19.9 || ^2.0.5`, so npm now resolves 2.0.11 on its own — exactly the condition the 0.6.1 entry named for removing the pin. Verified: `npm ls @hono/node-server` still resolves 2.0.11 without the override, and `npm audit --omit=dev` reports 0 vulnerabilities, so GHSA-frvp-7c67-39w9 stays closed. The `fast-uri`, `hono` and `ip-address` overrides are unchanged.

### Internal

- Dev tooling: `eslint` 10.0.3 → 10.8.1, `lint-staged` 17.1.0 → 17.3.0, `typescript-eslint` 8.57.0 → 8.67.0 (supersedes Dependabot #91). Dev-only — the published package is unchanged, so this needs no release of its own.


## [0.7.0] - 2026-08-19

### Fixed

- **Windows: the OAuth browser launch sent Fortnox a truncated URL.** `openBrowser()` ran `cmd /c start <url>`, and cmd.exe treats every unescaped `&` in the query string as a command separator — Fortnox only ever received the fragment before the first `&`, with no `redirect_uri`, `scope`, `state`, `response_type` or `access_type`, and correctly rejected it. The remaining parameters were run as commands and printed "not recognized" errors over the fallback URL, and the rejection could tear down the callback listener before that URL could be used. Windows now launches the browser through PowerShell `Start-Process` with the URL as a single quoted argument, and `noxctl init` prints the URL unconditionally on every platform. Thanks to @hedborg for the report and diagnosis (#95).
- **Windows: saving credentials failed with `Unable to find type [System.Security.Cryptography.ProtectedData]`.** The DPAPI helpers used `ProtectedData` without loading the assembly it lives in, which fails on any PowerShell configuration that does not preload `System.Security`. Both the read and write scripts now `Add-Type -AssemblyName System.Security` first (#95).
- **Five scopes were implemented and documented but never requested.** noxctl only receives what the authorize request asks for, so `project`, `costcenter` and `price` calls failed with `403 Har inte behörighet för scope` even when the Fortnox app had the permissions enabled. Those three are now in the default `SCOPES`; `offer` and `order` are available via the new opt-in `--with-orders` (see below). The endpoint→scope map behind the 403 hints also named the wrong scope for offers, orders and both payment families — `offer`, `order` and `payment` are scopes of their own, not covered by `invoice`/`supplierinvoice` — and was missing `financialyears` entirely. Corrections verified against Fortnox's published scope table (#95).
- **`noxctl doctor` and `fortnox_status` reported scopes they never checked.** Both kept their own scope→probe map, and a scope missing from it was skipped by the validation loop while still counted in the "all N scopes authorized" total. The map now lives in one shared module covering every requestable scope, and any scope without a probe is reported as "not checked" rather than counted as authorized.
- **`fortnox_create_supplier` / `fortnox_update_supplier` accepted only 10 of the Supplier resource's 41 writable fields.** The MCP SDK silently strips arguments a tool's schema does not declare, so setting e.g. `YourReference` did nothing at all — no error, the field simply never reached Fortnox. Both schemas now cover the full `SupplierSinglePayloadItem` field set (references, comments, visiting address, VAT, bank/IBAN/BIC, cost center, project, terms of payment, and the rest). Thanks to @hedborg (#96).
- **Voided voucher rows rendered identically to live ones.** Fortnox lets a single voucher row be voided (`Removed: true`) without deleting it, leaving the void and its replacement side by side in the same voucher — which read as a double-booking. Voided rows are now prefixed `[REMOVED]` in both `fortnox_get_voucher` and `noxctl vouchers get` (#96).
- **Windows: `noxctl logout --all` claimed to remove credentials that were never stored.** The Windows credential delete used `fs.rm(file, { force: true })`, which resolves for a missing file, so every delete looked successful; the macOS and Linux backends correctly report that there was nothing to remove. Found by the new Windows CI leg.
- Column formatters no longer bypass terminal control-character stripping. `Column.format` output is now sanitized like any other cell, so server-supplied text cannot emit ANSI/OSC escape sequences to the terminal through a formatted column.

### Added

- **`noxctl init --with-orders`** (or `FORTNOX_WITH_ORDERS=1`) requests the `offer` and `order` scopes. Like `--with-salary`, these are opt-in because Fortnox gates them on a product licence — the **Order** licence — and requesting a scope the company is not licensed for fails the entire authorization. A Bokföring + Kundfaktura company can therefore still authorize; it just does not get the offer/order tools. Every scope in the default set is covered by the Bokföring, Kundfaktura or Order licences the previous defaults already required.

### Changed

- **`noxctl init` may require enabling more permissions on an existing Fortnox app.** The default set now also asks for `project`, `costcenter` and `price`; Fortnox rejects an authorization that asks for a scope the app has not been granted. Existing installations are unaffected until you re-run `noxctl init` — credentials renew against the scope set they recorded, and credentials predating that field (pre-0.4.0) renew against a frozen historical set rather than the widened default. The one exception is a credential authorized by 0.2.0, which predates `inbox`/`connectfile` as well; those two have been included in its renewals since 0.3.0 and that behaviour is unchanged here. Before re-running `init`, enable Projekt, Kostnadsställe and Priser on the app. See the scope table in the README.
- `noxctl init` now prints the scope list from the `SCOPES` constant itself rather than a hand-maintained copy, which had drifted from what noxctl actually requests (#95).
- `Column.format` in the table/detail formatter now also receives the whole row, for cells whose rendering depends on a sibling field.
- **CI now runs the test suite on `windows-latest`.** Every bug in #95 was Windows-only and Linux-only CI could not have caught any of them; the new leg immediately found the `logout --all` defect above plus three test-environment assumptions (CRLF checkout, path separators).

## [0.6.1] - 2026-07-21

### Internal

- `@types/node` realigned to `^22` (was `^25.9.5`). The types should track the *minimum* supported Node, not the newest release — typing against a newer Node than `engines` allows lets TypeScript accept APIs that do not exist at runtime for users on the supported floor. The build and full suite pass unchanged on `@types/node@22`, confirming nothing depended on the newer typings. This supersedes the proposed bump to 26.
- `lint-staged` 16.4.0 → 17.1.0 (dev-only). It requires Node 22.22.1, which is now the documented *development* prerequisite; the published package's `engines` stays at 22.12.0, since that is the runtime contract for users.

### Security

- Pinned the transitive `@hono/node-server` to `^2.0.11` via `overrides`, clearing GHSA-frvp-7c67-39w9 (moderate: path traversal in `serve-static` on Windows via an encoded backslash). It reaches us through `@modelcontextprotocol/sdk`, whose declared range `^1.19.9` cannot pick up the fix in 2.0.5.

  **noxctl was never exposed:** the server runs only over `StdioServerTransport` and never imports hono, starts an HTTP server, or calls `serveStatic`. The override is nonetheless worth having so `npm audit` stays a meaningful gate rather than a permanently-red one, and it is safe for the same reason the advisory was unexploitable — the code is never loaded. Remove it once the SDK moves to `@hono/node-server` 2.x.

  The alternative npm proposed, `npm audit fix --force`, would have downgraded the SDK to 1.24.3 — a breaking change to a core dependency to fix an unreachable vulnerability.

## [0.6.0] - 2026-07-21

### Changed

- **BREAKING: the minimum supported Node.js version is now 22.12.0** (was 20). Node 20 reached end-of-life on 2026-04-30, and `commander@15` — the CLI's argument parser — requires `>=22.12.0`. Continuing to advertise Node 20 support while shipping that dependency would have left Node 20 users with `EBADENGINE` warnings and a support claim we do not honour. CI now tests Node 22 and 24.
- `commander` 14.0.3 → 15.0.0. No noxctl command, flag or output changed; the CLI surface is identical.
- `@modelcontextprotocol/sdk` 1.27.1 → 1.29.0, plus in-range refreshes of `zod`, `eslint`, `vitest`, `prettier`, `typescript-eslint`, `@types/node` and `lint-staged`.

### Fixed

- The MCP server reported version `0.4.1` to connected clients after 0.5.0 shipped. Both entry points now derive their version consistently, and a test asserts each matches `package.json` so neither can drift again.

### Internal

- Dependabot now groups minor and patch updates into one pull request per week per dependency type, instead of opening one per dependency.

## [0.5.0] - 2026-07-21

### Added

- **Invoice PDF export** (#66) — `noxctl invoices pdf <docNumber>` and the `fortnox_invoice_pdf` MCP tool download an invoice as a PDF. Writes to `--file <path>`, to stdout with `--file -`, or to `invoice-<docNumber>.pdf` by default (the destination is `--file` because `-o/--output` is globally the output *format*). The PDF always comes from Fortnox's `/preview` endpoint, which returns the document **without** marking the invoice as sent. `--mark-sent` additionally calls `/print` afterwards to set `Sent`, and therefore prompts for confirmation; the file is written first, so a failed write can never leave an invoice flagged as sent with no PDF to show for it. Works for credit invoices too.

  The MCP tool will not overwrite an existing file unless `overwrite: true` is passed, and defaults to a fresh private temp directory rather than a predictable path — its arguments are agent-generated.

### Fixed

- `noxctl invoices send <docNumber> --method print` (and `fortnox_send_invoice` with `method: "print"`) crashed with `SyntaxError: Unexpected token '%'`. Fortnox's `/print` endpoint answers with the PDF document rather than JSON, and the response was being parsed as JSON — after Fortnox had already flagged the invoice as sent, so a successful action was reported as a failure. The print path now reads the PDF response correctly and re-reads the invoice to report its true post-print state, still reporting success (with a note) if only that read-back fails.
- Fortnox exposes `/invoices/{n}/print` as a `GET` even though it sets `Sent`. Requests can now be flagged as mutations independently of their HTTP verb, so `/print` is no longer eligible for automatic retries and a `/print` timeout is correctly reported as an unknown outcome instead of "safe to retry".
- When `--mark-sent` fails after the PDF has already been written, the error now reports the saved file's path and size instead of only the Fortnox error, so a successful download is not mistaken for a total failure.

### Security

- A saved PDF is validated by its `%PDF-` magic bytes rather than by the `Content-Type` header, so a JSON error envelope or an HTML error page returned with a 200 can never be written to disk under a `.pdf` name.
- The `fortnox_invoice_pdf` MCP tool will not overwrite an existing file without an explicit `overwrite: true`, and will not write through a symbolic link in either mode (`O_EXCL`/`O_NOFOLLOW`, with an `lstat` fallback on Windows). Its arguments are model-generated, so a stray path must not be able to truncate an unrelated file.

### Dependencies

- Bumped the transitive `body-parser` to 2.3.0 (GHSA-v422-hmwv-36x6, low). Lockfile-only; no `package.json` range changed.

## [0.4.1] - 2026-07-13

### Fixed

- Coalesce concurrent OAuth refreshes per profile so refresh-token rotation cannot race or overwrite newer credentials.
- Bound Fortnox and OAuth network calls with explicit deadlines. Read-only requests retry transient network failures and retryable HTTP responses with capped backoff; mutations remain single-attempt and timeout errors warn that their outcome may be unknown.

### Changed

- **Legacy credential dual-write disabled** (#53) — `saveCredentialBlob` no longer mirrors writes to the pre-0.2.0 unnamespaced keychain/DPAPI slot. The 0.2.x compatibility window (`LEGACY_DUAL_WRITE`) has passed; new credential saves go only to the namespaced `profile:default` slot. Reading the legacy slot is unaffected — `loadCredentialBlob` still transparently falls back to it, so already-migrated 0.1.x installs keep working. See `docs/legacy-credential-removal-plan.md` for the planned 0.5.0 removal of the legacy reader.
- Default employee detail output now redacts personnummer and exact pay. Exact values remain available through explicit CLI JSON output or MCP `includeRaw`, whose descriptions now warn that payroll data can include sensitive personal information.
- CI and package publishing now require lint, formatting, build, tests, a production dependency audit, and a package manifest dry-run. Safe transitive dependency updates remove the currently reported npm audit findings.

### Added

- `.github/dependabot.yml` — weekly npm dependency update PRs.

## [0.4.0] - 2026-06-17

### Added

- **Payroll / Lön integration** — coverage for the Fortnox salary API, now that the **Lön** permission is grantable to integrations:
  - **Employees** — `noxctl employees list|get|create|update` and `fortnox_list_employees` / `fortnox_get_employee` / `fortnox_create_employee` / `fortnox_update_employee`. `employees create` has `--employment-form` / `--personel-type` / `--salary-form` (and `--employment-date` / `--monthly-salary` / `--hourly-pay`) flags — set the first three so Fortnox can assign a company employment agreement, otherwise it rejects with a `ftgavtalid` error (the API client now surfaces a hint for this).
  - **Salary transactions** — `noxctl salary-transactions list|get|create|delete` and matching MCP tools (filterable by `--employee` / `--date`).
  - **Attendance transactions** (närvaro) — `noxctl attendance-transactions list|get|create|delete` and MCP tools.
  - **Absence transactions** (frånvaro) — `noxctl absence-transactions list|get|create|delete` and MCP tools.
  - **Schedule times** (schematider) — `noxctl schedule-times get|update|reset-day` and MCP tools.
- **Opt-in `salary` scope** — the Lön scope is **not** requested by default (it would break `init` for apps without the Lön permission). Enable it with `noxctl init --with-salary` (or `FORTNOX_WITH_SALARY=1` for non-interactive runs). The granted scope set is persisted per-profile so the client-credentials refresh re-requests it, and `noxctl doctor` / `fortnox_status` probe it only when it was granted. **Existing installs must re-run `noxctl init --with-salary` to use the payroll commands.**

### Fixed

- `fortnox_status` (MCP) now probes the `payment` scope, matching the CLI `doctor` command.

### Changed

- **API drift detection no longer commits Fortnox's OpenAPI spec** to the repo. It now stores only opaque per-endpoint/per-schema hashes in `api-spec/openapi-fingerprint.json` (the full spec is fetched on demand into a git-ignored cache), avoiding redistribution of Fortnox's call structure (Developer Agreement cl. 6.1/6.3). New `npm run check:api` script.
- README/PRIVACY document the user's responsibilities under Fortnox's Developer Agreement (Swedish-company eligibility cl. 5.1, processor/DPA for third-party use cl. 12.3, and personal-data responsibility when sending Lön/ROT-RUT data to AI/LLMs cl. 13.5).

### Notes

- Absence transaction `Hours` / `Extent` are sent as numbers (matching the Fortnox spec), unlike the string-typed `Hours` on attendance/schedule resources.

## [0.3.0] - 2026-06-16

### Added

- **Voucher file attachments** (#37) — `noxctl vouchers attach <series> <number> <file...> [--year]` uploads receipt/underlag files to the Fortnox inbox and links them to a voucher; matching `fortnox_attach_voucher_files` MCP tool. The financial year is resolved from the voucher's transaction date when `--year` is omitted. Requires the **Inbox** and **Koppla filer** permissions (`inbox` + `connectfile` scopes) on your Fortnox app — **existing installs must re-run `noxctl init` to pick up the new scopes.** Also delivers the file-attachments half of #13.
- **Contracts API** (#10) — recurring invoicing: `noxctl contracts list|get|create|update|finish|create-invoice|increase-invoice-count` and matching MCP tools.
- **Financial years / locked period** (#11) — `noxctl financial-years list|get|locked-period` and MCP tools; context for period-aware operations.
- **Analytics views** (#7) — overdue summary, unpaid totals, top customers, VAT summary with net VAT position: `noxctl analytics ...` and MCP tools.
- **`noxctl dashboard`** (#12) — at-a-glance outstanding/overdue/recent invoices/monthly revenue.
- **Natural date periods** (#9) — `--period Q1|2025-Q3|march|mars|last-quarter|ytd|...` on list/report commands (calendar-year based; fiscal-year awareness deferred).
- **Shell completions** (#8) — `noxctl completion bash|zsh|fish`.
- **Confirmation payload preview** (#6) — the y/N prompt now shows the exact JSON payload that will be sent.
- **JSON error envelope** (#32) — in JSON mode, failures are emitted to stderr as `{"error": {status?, message, hint?, source}}`.
- **YubiKey serial diagnostics** (#33) — `keychain init` records the enrolled key's serial; `unlock` preflights it against `ykman list --serials` and names both serials on mismatch. ykman's misleading "empty slot"/"Failed to write" errors are translated.

### Changed

- **Stable JSON envelopes for single-resource output** (#34) — `get`/`create`/`update`/action commands now wrap their JSON output under the singular resource key (`{"Invoice": {...}}`), matching the list convention. Scripts that consumed the bare object should unwrap one level.
- The `-o` help text documents the default output mode (table on TTY, JSON when piped) (#34).

### Fixed

- `customers create`/`update` strip the server-derived read-only fields `Country`, `DeliveryCountry`, `VisitingCountry`, so a `customers get` response can be fed back into create/update unchanged (#31).

## [0.2.0] - 2026-04-20

### Added

- **Multi-profile support** — run noxctl against multiple Fortnox tenants from a single installation. Each profile has its own namespaced OAuth credentials in the OS secure store.
- **Profile resolution precedence:** `--profile <name>` flag → `NOXCTL_PROFILE` env var → `~/.fortnox-mcp/active-profile` pointer → `default`.
- **`noxctl profile` subcommands:** `use <name>`, `current`, `list`.
- **`--profile <name>` flag** on all commands, including `init` and `serve`.
- **MCP server startup profile binding** — the MCP server now resolves the profile at startup (from env + active pointer, or the forwarded CLI flag) and binds it for the session. Non-default sessions print a `[profile: <name>]` stderr banner.
- **Profile-tagged errors** — Fortnox API errors (`FortnoxApiError`) and runtime token-acquisition failures (`refreshAccessToken`, `getTokenViaClientCredentials`, `getValidToken`) are prefixed with `[profile: <name>]` when non-default, so mis-bound MCP sessions are diagnosable from a single line.
- **`MIGRATION.md`** covering the 0.1 → 0.2 upgrade path.

### Changed

- **Fail-closed pointer semantics at MCP startup.** `noxctl serve` refuses to start when the active-profile pointer is corrupt, unreadable, or times out and no `--profile` flag or `NOXCTL_PROFILE` is set. Exits with code 2 and a stderr message pointing at `noxctl doctor`. The CLI's `doctor` and `profile use` commands remain usable against a broken pointer so it can be repaired.
- **Pointer read uses `AbortController`** instead of `Promise.race`, so a timeout actually cancels the underlying `fs.readFile` rather than letting it run to completion in the background.
- **Credential storage is now namespaced by profile.** Existing 0.1.x installs are dual-read transparently (legacy entry → `default` profile) and the profile index is seeded on first observation. The new namespaced entry is written lazily on the next credential save (token refresh or `noxctl init`); the legacy entry stays dual-written for one release cycle so rollback to 0.1.x continues to work.

### Security

- Corrupt or ambiguous profile state no longer silently routes requests to the `default` tenant. This removes a wrong-tenant routing risk that existed implicitly in 0.1.x (where there was only one tenant, so the risk was vacuous — but the code path didn't enforce it).

## [0.1.0] - 2026-03-20

### Added

- Initial release.
- CLI and MCP server for Fortnox covering: customers, suppliers, articles, invoices, invoice payments, supplier invoices, supplier invoice payments, offers, orders, bookkeeping (vouchers, accounts), financial reports (income statement, balance sheet), tax (VAT summary, ROT/RUT tax reductions), projects, cost centers, price lists, prices, and company info.
- Interactive `noxctl init` setup wizard with OAuth2 authorization-code and client-credentials (service account) flows.
- Secure credential storage in the OS keychain (macOS Keychain, Linux Secret Service, Windows DPAPI).
- Mutation safety: TTY confirmation prompts, `--yes` / `confirm: true` for scripting, `--dry-run` / `dryRun` for previews.
- Table and JSON output modes (auto-detected by TTY, override with `-o`).
- `noxctl doctor` / `fortnox_status` for setup validation.

[0.9.0]: https://github.com/Magnus-Gille/noxctl/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Magnus-Gille/noxctl/compare/v0.7.4...v0.8.0
[0.7.4]: https://github.com/Magnus-Gille/noxctl/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/Magnus-Gille/noxctl/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/Magnus-Gille/noxctl/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/Magnus-Gille/noxctl/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Magnus-Gille/noxctl/compare/v0.6.1...v0.7.0
[0.4.1]: https://github.com/Magnus-Gille/noxctl/compare/v0.4.0...v0.4.1
[0.2.0]: https://github.com/Magnus-Gille/noxctl/releases/tag/v0.2.0
[0.1.0]: https://github.com/Magnus-Gille/noxctl/releases/tag/v0.1.0
