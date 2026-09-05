import { describe, it, expect, vi } from 'vitest';
import type { FortnoxTransport } from '../../src/fortnox-client.js';
import { createGeneralLedgerOperations } from '../../src/operations/general-ledger.js';

const SAMPLE_SIE = [
  '#FORMAT PC8',
  '#SIETYP 4',
  '#KONTO 3000 "Sales, Sweden"',
  '#KONTO 1930 "Bank"',
  '#VER B 2 20260805 "Sale" 20260806',
  '{',
  '#TRANS 3000 {} -1000 "" "Sale to customer" 0',
  '#TRANS 1930 {} 1000 "" "" 0',
  '}',
  '#VER A 1 20260803 "Earlier sale"',
  '{',
  '#TRANS 3000 {1 "2010"} -250 "" "" 0',
  '#TRANS 1930 {} 250 "" "" 0',
  '}',
].join('\r\n');

// Every test below fetches a 2026-08 range, so a single financial year
// covering all of 2026 satisfies the auto-resolution unless a test
// overrides `request` itself to check that resolution specifically.
function stubTransport(): FortnoxTransport {
  return {
    request: vi.fn().mockResolvedValue({
      FinancialYears: [{ Id: 4, FromDate: '2026-01-01', ToDate: '2026-12-31' }],
    }),
    requestWithMetadata: vi.fn(),
    requestPdf: vi.fn(),
    requestPdfFromMutation: vi.fn(),
    requestFile: vi.fn().mockResolvedValue({
      buffer: Buffer.from(SAMPLE_SIE, 'latin1'),
      contentType: 'application/octet-stream',
    }),
    fetchAllPages: vi.fn(),
  } as FortnoxTransport;
}

describe('getGeneralLedger', () => {
  it('requests sie/4 for the given date range', async () => {
    const transport = stubTransport();
    const { getGeneralLedger } = createGeneralLedgerOperations(transport);

    await getGeneralLedger({ fromDate: '2026-08-01', toDate: '2026-08-31', financialYear: 12 });

    expect(transport.requestFile).toHaveBeenCalledWith('sie/4', {
      params: { fromdate: '2026-08-01', todate: '2026-08-31', financialyear: 12 },
    });
    // An explicit financialYear must skip the lookup entirely.
    expect(transport.request).not.toHaveBeenCalled();
  });

  // Financial year ids are per-company (id 14 for one tenant might be id 1
  // for another that started in 2025) and Fortnox's SIE export does not
  // reliably infer the year from dates alone — confirmed live: a real
  // 2025-01-01..2025-12-31 range was rejected ("Perioden måste ligga inom
  // bokföringsåret") until financialyear was also passed. Resolve it
  // automatically instead of requiring the caller to already know the id.
  describe('financial year auto-resolution', () => {
    it('resolves the financial year from fromDate when not given', async () => {
      const transport = stubTransport();
      const { getGeneralLedger } = createGeneralLedgerOperations(transport);

      await getGeneralLedger({ fromDate: '2026-08-01', toDate: '2026-08-31' });

      expect(transport.request).toHaveBeenCalledWith('financialyears');
      expect(transport.requestFile).toHaveBeenCalledWith('sie/4', {
        params: { fromdate: '2026-08-01', todate: '2026-08-31', financialyear: 4 },
      });
    });

    it('throws (telling the caller to pass financialYear) when none covers the date', async () => {
      const transport: FortnoxTransport = {
        request: vi.fn().mockResolvedValue({ FinancialYears: [] }),
        requestWithMetadata: vi.fn(),
        requestPdf: vi.fn(),
        requestPdfFromMutation: vi.fn(),
        requestFile: vi.fn(),
        fetchAllPages: vi.fn(),
      };
      const { getGeneralLedger } = createGeneralLedgerOperations(transport);

      await expect(
        getGeneralLedger({ fromDate: '1999-01-01', toDate: '1999-12-31' }),
      ).rejects.toThrow(/pass financialYear/i);
      expect(transport.requestFile).not.toHaveBeenCalled();
    });
  });

  it('produces one row per #TRANS line, with formatted dates', async () => {
    const { getGeneralLedger } = createGeneralLedgerOperations(stubTransport());

    const rows = await getGeneralLedger({ fromDate: '2026-08-01', toDate: '2026-08-31' });

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      series: 'A',
      voucherNumber: '1',
      transactionDate: '2026-08-03',
      account: '3000',
      accountDescription: 'Sales, Sweden',
      costCenter: '2010',
      debit: 0,
      credit: 250,
    });
  });

  it('formats and sorts by row dates while retaining the voucher-date fallback', async () => {
    const transport = stubTransport();
    vi.mocked(transport.requestFile).mockResolvedValue({
      buffer: Buffer.from(SAMPLE_SIE.replace('-1000 ""', '-1000 20260801')),
      contentType: 'application/octet-stream',
    });
    const rows = await createGeneralLedgerOperations(transport).getGeneralLedger({
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
    });
    expect(rows.map((r) => r.transactionDate)).toEqual([
      '2026-08-01',
      '2026-08-03',
      '2026-08-03',
      '2026-08-05',
    ]);
    expect(rows[0]).toMatchObject({ series: 'B', voucherNumber: '2', credit: 1000 });
  });

  it('splits the signed SIE amount into separate debit/credit columns', async () => {
    const { getGeneralLedger } = createGeneralLedgerOperations(stubTransport());

    const rows = await getGeneralLedger({ fromDate: '2026-08-01', toDate: '2026-08-31' });
    const bankRow = rows.find((r) => r.account === '1930' && r.voucherNumber === '2');

    expect(bankRow).toMatchObject({ debit: 1000, credit: 0 });
  });

  it('falls back to the voucher description when a row has no text of its own', async () => {
    const { getGeneralLedger } = createGeneralLedgerOperations(stubTransport());

    const rows = await getGeneralLedger({ fromDate: '2026-08-01', toDate: '2026-08-31' });
    const bankRow = rows.find((r) => r.account === '1930' && r.voucherNumber === '2');

    expect(bankRow?.text).toBe('Sale');
  });

  it('sorts by transaction date, then series, then voucher number', async () => {
    const { getGeneralLedger } = createGeneralLedgerOperations(stubTransport());

    const rows = await getGeneralLedger({ fromDate: '2026-08-01', toDate: '2026-08-31' });

    const order = rows.map((r) => `${r.transactionDate} ${r.series}${r.voucherNumber}`);
    expect(order).toEqual(['2026-08-03 A1', '2026-08-03 A1', '2026-08-05 B2', '2026-08-05 B2']);
  });

  it('resolves distinct concurrent calls against their own bound transport', async () => {
    const transportA = stubTransport();
    const transportB = stubTransport();
    const { getGeneralLedger: getA } = createGeneralLedgerOperations(transportA);
    const { getGeneralLedger: getB } = createGeneralLedgerOperations(transportB);

    await Promise.all([
      getA({ fromDate: '2026-08-01', toDate: '2026-08-31' }),
      getB({ fromDate: '2026-08-01', toDate: '2026-08-31' }),
    ]);

    expect(transportA.requestFile).toHaveBeenCalledTimes(1);
    expect(transportB.requestFile).toHaveBeenCalledTimes(1);
  });
});
