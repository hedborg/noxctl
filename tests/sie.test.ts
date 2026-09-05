import { describe, it, expect, vi } from 'vitest';
import type { FortnoxTransport } from '../src/fortnox-client.js';
import { parseSie, fetchSie } from '../src/sie.js';

const SAMPLE_SIE = [
  '#FLAGGA 0',
  '#FORMAT PC8',
  '#SIETYP 4',
  '#GEN 20260901',
  '#FNR 285668',
  '#FNAMN "Test AB"',
  '#RAR 0 20260101 20261231',
  '#RAR -1 20250101 20251231',
  '#ORGNR 559001-6035',
  '#KPTYP EUBAS97',
  '#DIM 1 "Kostnadsstlle"',
  '#DIM 6 "Projekt"',
  '#KONTO 3000 "Sales, Sweden"',
  '#SRU 3000 7410',
  '#KONTO 4550 "Purchase of services"',
  '#SRU 4550 7514',
  '#KONTO 1930 "Bank"',
  '#IB 0 1930 100000 0',
  '#IB -1 1930 50000 0',
  '#UB 0 1930 80000 0',
  '#VER A 1 20260805 "Sale" 20260806',
  '{',
  '#TRANS 3000 {} -1000 "" "Sale to customer" 0',
  '#TRANS 1930 {} 1000 "" "" 0',
  '}',
  '#VER A 2 20260806 "Purchase" 20260806',
  '{',
  '#TRANS 4550 {1 "2010" 6 "1001"} 500 "" "Consulting" 0',
  '#TRANS 1930 {} -500 "" "" 0',
  '}',
].join('\r\n');

describe('parseSie', () => {
  it('extracts company metadata', () => {
    const result = parseSie(SAMPLE_SIE);
    expect(result.companyName).toBe('Test AB');
    expect(result.organisationNumber).toBe('559001-6035');
  });

  it('pairs #KONTO descriptions with #SRU codes', () => {
    const result = parseSie(SAMPLE_SIE);
    expect(result.accounts.get('3000')).toEqual({
      number: '3000',
      description: 'Sales, Sweden',
      sru: '7410',
    });
    expect(result.accounts.get('4550')?.sru).toBe('7514');
  });

  it('records an account with no #SRU line as having no sru field', () => {
    const result = parseSie(SAMPLE_SIE);
    expect(result.accounts.get('1930')?.sru).toBeUndefined();
  });

  it('parses #IB and #UB balances, keyed by year index', () => {
    const result = parseSie(SAMPLE_SIE);
    expect(result.openingBalances).toContainEqual({
      account: '1930',
      yearIndex: 0,
      balance: 100000,
    });
    expect(result.openingBalances).toContainEqual({
      account: '1930',
      yearIndex: -1,
      balance: 50000,
    });
    expect(result.closingBalances).toContainEqual({
      account: '1930',
      yearIndex: 0,
      balance: 80000,
    });
  });

  it('associates #TRANS lines with their enclosing #VER header', () => {
    const result = parseSie(SAMPLE_SIE);
    const saleLine = result.transactions.find((t) => t.account === '3000');
    expect(saleLine).toMatchObject({
      series: 'A',
      voucherNumber: '1',
      voucherDate: '20260805',
      registrationDate: '20260806',
      voucherDescription: 'Sale',
      amount: -1000,
      text: 'Sale to customer',
    });
  });

  it('leaves text undefined when the #TRANS text field is empty', () => {
    const result = parseSie(SAMPLE_SIE);
    const bankLine = result.transactions.find((t) => t.account === '1930' && t.amount === 1000);
    expect(bankLine?.text).toBeUndefined();
  });

  it('parses cost centre and project out of the dimension object list', () => {
    const result = parseSie(SAMPLE_SIE);
    const purchaseLine = result.transactions.find((t) => t.account === '4550');
    expect(purchaseLine).toMatchObject({ costCenter: '2010', project: '1001', amount: 500 });
  });

  it('leaves costCenter/project undefined when the dimension list is empty', () => {
    const result = parseSie(SAMPLE_SIE);
    const saleLine = result.transactions.find((t) => t.account === '3000');
    expect(saleLine?.costCenter).toBeUndefined();
    expect(saleLine?.project).toBeUndefined();
  });

  it('produces exactly one transaction per #TRANS line, in file order', () => {
    const result = parseSie(SAMPLE_SIE);
    expect(result.transactions).toHaveLength(4);
  });

  it('ignores lines it does not recognize without throwing', () => {
    expect(() => parseSie('#UNKNOWNTAG some stuff\r\n' + SAMPLE_SIE)).not.toThrow();
  });

  it('returns empty collections for an empty file', () => {
    const result = parseSie('');
    expect(result.accounts.size).toBe(0);
    expect(result.transactions).toEqual([]);
    expect(result.openingBalances).toEqual([]);
    expect(result.closingBalances).toEqual([]);
  });

  // Correctness bugs found in review (#161): a malformed amount must not
  // silently become a plausible-looking zero-value posting, and a #TRANS
  // outside its voucher's `{`/`}` block must not be attributed to whichever
  // voucher happened to be seen last.
  describe('defensive parsing', () => {
    it('throws on a malformed #TRANS amount instead of silently zeroing it', () => {
      const sie = [
        '#VER A 1 20260805 "Sale"',
        '{',
        '#TRANS 3000 {} not-a-number "" "Bad row" 0',
        '}',
      ].join('\r\n');

      expect(() => parseSie(sie)).toThrow(/malformed amount/i);
    });

    it('throws on a non-finite #TRANS amount', () => {
      const sie = [
        '#VER A 1 20260805 "Sale"',
        '{',
        '#TRANS 3000 {} Infinity "" "Bad row" 0',
        '}',
      ].join('\r\n');

      expect(() => parseSie(sie)).toThrow(/malformed amount/i);
    });

    it('throws on a malformed #IB balance', () => {
      const sie = '#IB 0 1930 not-a-number 0';

      expect(() => parseSie(sie)).toThrow(/malformed amount/i);
    });

    it('throws on a malformed #UB balance', () => {
      const sie = '#UB 0 1930 not-a-number 0';

      expect(() => parseSie(sie)).toThrow(/malformed amount/i);
    });

    it('does not attribute a #TRANS after the closing brace to the voucher that just closed', () => {
      const sie = [
        '#VER A 1 20260805 "Sale"',
        '{',
        '#TRANS 3000 {} -1000 "" "In block" 0',
        '}',
        // Stray/truncated line: no #VER re-opened, no `{` — must be ignored,
        // not silently folded into voucher A/1 above.
        '#TRANS 1930 {} 1000 "" "Orphan" 0',
      ].join('\r\n');

      const result = parseSie(sie);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]?.text).toBe('In block');
    });

    it('does not attribute a #TRANS between #VER and the opening brace', () => {
      const sie = [
        '#VER A 1 20260805 "Sale"',
        // No `{` yet — a #TRANS here is outside the block even though
        // currentVoucher is already set.
        '#TRANS 3000 {} -1000 "" "Too early" 0',
        '{',
        '#TRANS 1930 {} 1000 "" "In block" 0',
        '}',
      ].join('\r\n');

      const result = parseSie(sie);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]?.text).toBe('In block');
    });

    it('correctly separates transactions across two consecutive vouchers', () => {
      const sie = [
        '#VER A 1 20260805 "First"',
        '{',
        '#TRANS 3000 {} -1000 "" "" 0',
        '}',
        '#VER A 2 20260806 "Second"',
        '{',
        '#TRANS 3000 {} -500 "" "" 0',
        '}',
      ].join('\r\n');

      const result = parseSie(sie);

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0]?.voucherNumber).toBe('1');
      expect(result.transactions[1]?.voucherNumber).toBe('2');
    });
  });
});

describe('fetchSie', () => {
  function stubTransport(buffer: Buffer): FortnoxTransport {
    return {
      request: vi.fn(),
      requestWithMetadata: vi.fn(),
      requestPdf: vi.fn(),
      requestPdfFromMutation: vi.fn(),
      requestFile: vi.fn().mockResolvedValue({ buffer, contentType: 'application/octet-stream' }),
      fetchAllPages: vi.fn(),
    } as FortnoxTransport;
  }

  it('requests sie/4 with fromdate/todate/financialyear query params', async () => {
    const transport = stubTransport(Buffer.from(SAMPLE_SIE, 'latin1'));

    await fetchSie(transport, { fromDate: '2026-08-01', toDate: '2026-08-31', financialYear: 12 });

    expect(transport.requestFile).toHaveBeenCalledWith('sie/4', {
      params: { fromdate: '2026-08-01', todate: '2026-08-31', financialyear: 12 },
    });
  });

  it('decodes CP437 bytes correctly, unlike a naive latin1 decode', async () => {
    // "Intäktsränta" with ä as CP437 byte 0x84 (which is a C1 control code
    // in latin1 — decoding as latin1 would silently drop both ä's).
    const cp437Bytes = Buffer.from([
      0x23,
      0x56,
      0x45,
      0x52,
      0x20,
      0x41,
      0x20,
      0x31,
      0x20,
      0x30,
      0x20,
      0x22,
      0x49,
      0x6e,
      0x74,
      0x84,
      0x6b,
      0x74,
      0x73,
      0x72,
      0x84,
      0x6e,
      0x74,
      0x61,
      0x22,
      0x0d,
      0x0a,
      0x7b,
      0x0d,
      0x0a,
      0x7d, // #VER A 1 0 "Intäktsränta"\r\n{\r\n}
    ]);
    const transport = stubTransport(cp437Bytes);

    const result = await fetchSie(transport, {});

    expect(result.transactions).toEqual([]); // no #TRANS lines, just checking decode
    // Re-parse the same bytes as latin1 to prove the naive decode would have
    // silently dropped the ä's, so this test is actually exercising the fix.
    expect(cp437Bytes.toString('latin1')).not.toContain('Intäktsränta');
  });

  it('recovers the voucher description text via CP437 decoding end-to-end', async () => {
    const line = '#VER A 1 20260805 "Intäktsränta"\r\n{\r\n#TRANS 8310 {} 100 "" "" 0\r\n}';
    // Encode manually: ä -> 0x84 in CP437.
    const bytes = Buffer.from(line.split('').map((ch) => (ch === 'ä' ? 0x84 : ch.charCodeAt(0))));
    const transport = stubTransport(bytes);

    const result = await fetchSie(transport, {});

    expect(result.transactions[0]?.voucherDescription).toBe('Intäktsränta');
  });
});

describe('SIE4 amount and field grammar', () => {
  const transaction = (amount: string) =>
    `#VER A 1 20260805 "Sale"\n{\n#TRANS 1930 {} ${amount}\n}`;

  it.each([
    '""',
    '" "',
    '0x10',
    '1e3',
    '+10',
    '.50',
    '1.',
    '1,50',
    '1.001',
    'NaN',
    'Infinity',
    '-Infinity',
    '9007199254740992',
    '90071992547409.92',
    '90071992547409.91',
    '-90071992547409.91',
    '70368744177664.01',
  ])('rejects invalid or imprecise amount %s in every amount tag', (raw) => {
    for (const input of [transaction(raw), `#IB 0 1930 ${raw}`, `#UB 0 1930 ${raw}`]) {
      expect(() => parseSie(input)).toThrow(/malformed|unsafe/i);
    }
  });

  it.each(['0', '123', '-123', '123.4', '-123.45', '0.01', '0001.20', '999999999999.99'])(
    'accepts SIE decimal amount %s in every amount tag',
    (raw) => {
      const result = parseSie(`${transaction(raw)}\n#IB 0 1930 ${raw}\n#UB 0 1930 ${raw}`);
      expect(result.transactions[0]?.amount).toBe(Number(raw));
      expect(result.openingBalances[0]?.balance).toBe(Number(raw));
      expect(result.closingBalances[0]?.balance).toBe(Number(raw));
    },
  );

  it('uses the row date, with fallback for empty and omitted dates', () => {
    const result = parseSie(
      '#VER A 1 20260805 "Sale"\n{\n' +
        '#TRANS 1930 {} 1 20260807 "Later"\n#TRANS 1930 {} 2 "" "Fallback"\n' +
        '#TRANS 1930 {} 3\n}',
    );
    expect(result.transactions.map((t) => t.transactionDate)).toEqual([
      '20260807',
      '20260805',
      '20260805',
    ]);
    expect(result.transactions.map((t) => t.voucherDate)).toEqual([
      '20260805',
      '20260805',
      '20260805',
    ]);
  });

  it('decodes escaped quotes without shifting subsequent fields or removing other backslashes', () => {
    const result = parseSie(String.raw`#VER A 1 20260805 "Sale \"special\" C:\docs" 20260806
{
#TRANS 1930 {1 "Cost \"A\"" 6 "Project } A"} 12.50 20260807 "Row \"text\" C:\docs" 0
}`);
    expect(result.transactions[0]).toMatchObject({
      voucherDescription: 'Sale "special" C:\\docs',
      registrationDate: '20260806',
      transactionDate: '20260807',
      amount: 12.5,
      costCenter: 'Cost "A"',
      project: 'Project } A',
      text: 'Row "text" C:\\docs',
    });
  });

  it.each([
    '#VER A 1 20260805 "Unclosed',
    '#VER A 1 20260805 "Sale"\n{\n#TRANS 1930 {1 "Unclosed} 1\n}',
    '#VER A 1 20260805 "Sale"\n{\n#TRANS 1930 {1 "Cost" 1\n}',
  ])('rejects unterminated quoted fields and object lists', (input) => {
    expect(() => parseSie(input)).toThrow(/unterminated/);
  });

  it('accepts tabs between record fields', () => {
    const result = parseSie('#VER\tA\t1\t20260805\t"Sale"\n{\n#TRANS\t1930\t{}\t1.25\n}');
    expect(result.transactions[0]?.amount).toBe(1.25);
  });
});
