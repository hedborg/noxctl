import { defaultFortnoxTransport, type FortnoxTransport } from '../fortnox-client.js';
import { fetchSie } from '../sie.js';
import { createFinancialYearOperations } from './financial-years.js';

export interface GeneralLedgerEntry {
  series: string;
  voucherNumber: string;
  transactionDate: string;
  registrationDate?: string;
  account: string;
  accountDescription?: string;
  costCenter?: string;
  project?: string;
  text: string;
  debit: number;
  credit: number;
}

export interface GeneralLedgerParams {
  fromDate: string;
  toDate: string;
  financialYear?: number;
}

// SIE dates are YYYYMMDD with no separators.
function formatSieDate(date: string): string {
  if (!/^\d{8}$/.test(date)) return date;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

export function createGeneralLedgerOperations(transport: FortnoxTransport) {
  const { listFinancialYears } = createFinancialYearOperations(transport);

  // Financial year ids are per-company — id 14 might be 2025 for one tenant
  // and id 1 might be 2025 for a company founded that year — so there is no
  // way to guess one. Fortnox's SIE export additionally does not reliably
  // infer the year from dates alone: `fromdate`/`todate` set to exactly a
  // real financial year's own boundaries can still come back
  // "Perioden måste ligga inom bokföringsåret" (confirmed live) unless
  // `financialyear` is also passed. Resolve it explicitly instead of relying
  // on that inference, the same way attachVoucherFiles resolves one for
  // vouchers.
  async function resolveFinancialYear(fromDate: string): Promise<number> {
    const fy = await listFinancialYears({ date: fromDate });
    const list = (fy.FinancialYears ?? []) as Record<string, unknown>[];
    if (!list.length) {
      throw new Error(
        `No financial year found covering ${fromDate}. Pass financialYear explicitly.`,
      );
    }
    return Number(list[0]!.Id);
  }

  // The flat, dated, per-account transaction list every other report in this
  // file is built from — one #TRANS line in, one row out. Requires a date
  // range: fetchSie proxies straight to Fortnox's SIE export, which needs
  // one to scope the file it generates.
  async function getGeneralLedger(params: GeneralLedgerParams): Promise<GeneralLedgerEntry[]> {
    const financialYear = params.financialYear ?? (await resolveFinancialYear(params.fromDate));
    const parsed = await fetchSie(transport, { ...params, financialYear });
    return parsed.transactions
      .map((t): GeneralLedgerEntry => ({
        series: t.series,
        voucherNumber: t.voucherNumber,
        transactionDate: formatSieDate(t.transactionDate),
        registrationDate: t.registrationDate ? formatSieDate(t.registrationDate) : undefined,
        account: t.account,
        accountDescription: parsed.accounts.get(t.account)?.description,
        costCenter: t.costCenter,
        project: t.project,
        text: t.text ?? t.voucherDescription,
        debit: t.amount > 0 ? t.amount : 0,
        credit: t.amount < 0 ? -t.amount : 0,
      }))
      .sort(
        (a, b) =>
          a.transactionDate.localeCompare(b.transactionDate) ||
          a.series.localeCompare(b.series) ||
          Number(a.voucherNumber) - Number(b.voucherNumber),
      );
  }

  return { getGeneralLedger };
}

export const { getGeneralLedger } = createGeneralLedgerOperations(defaultFortnoxTransport);
