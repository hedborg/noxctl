import type { FortnoxTransport } from './fortnox-client.js';

// Fortnox documents GET /3/sie/{Type} in its OpenAPI specification. Type 4
// returns transaction rows and balances in one file, avoiding individual
// voucher-detail requests for the general ledger.
// Format reference: https://sie.se/wp-content/uploads/2020/05/SIE_filformat_ver_4B_ENGLISH.pdf
// (sections 5.7 and 5.9: quoted fields and decimal amounts).
//
// SIE is a line-oriented text format (Swedish "SIE 4" standard); every
// meaningful line starts with a `#TAG`. We only parse the tags this codebase
// needs — #KONTO/#SRU (chart of accounts + official tax-authority grouping
// code), #IB/#UB (opening/closing balance per account), and #VER/#TRANS
// (voucher headers and their transaction lines). Anything else is ignored.

export interface SieAccount {
  number: string;
  description: string;
  /** Single SRU code retained for this account. Full tax-report mapping
   * needs separate support for multiple and sign-dependent SRU codes. */
  sru?: string;
}

export interface SieTransaction {
  series: string;
  voucherNumber: string;
  /** Date from the voucher header (#VER). */
  voucherDate: string;
  /** Row date (#TRANS), falling back to the voucher date when absent. */
  transactionDate: string;
  /** Registration date, when present — the 5th #VER field. */
  registrationDate?: string;
  voucherDescription: string;
  account: string;
  /** Signed: positive = debit, negative = credit. */
  amount: number;
  costCenter?: string;
  project?: string;
  /** Per-row free text, when present (falls back to the voucher description
   * when the caller wants a single label). */
  text?: string;
}

export interface SieBalance {
  account: string;
  /** 0 = current financial year, -1 = the one before it, per #RAR. */
  yearIndex: number;
  balance: number;
}

export interface ParsedSie {
  companyName?: string;
  organisationNumber?: string;
  accounts: Map<string, SieAccount>;
  transactions: SieTransaction[];
  openingBalances: SieBalance[];
  closingBalances: SieBalance[];
}

// SIE lines are whitespace-separated tokens where a `"..."` run is one token
// (with the quotes stripped) and a `{...}` run is one token (kept with its
// braces, for the caller to parse separately — it's a nested object list,
// e.g. `{1 "2010" 6 "1001"}` for cost-centre + project dimensions).
function readQuoted(line: string, start: number): { value: string; end: number } {
  let value = '';
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '"') {
      value += '"';
      i++;
    } else if (line[i] === '"') {
      return { value, end: i + 1 };
    } else {
      value += line[i];
    }
  }
  throw new Error('SIE export contains an unterminated quoted field.');
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      const { value, end } = readQuoted(line, i);
      tokens.push(value);
      i = end;
    } else if (line[i] === '{') {
      let j = i + 1;
      while (j < line.length && line[j] !== '}') {
        j = line[j] === '"' ? readQuoted(line, j).end : j + 1;
      }
      if (j === line.length) {
        throw new Error('SIE export contains an unterminated object list.');
      }
      tokens.push(line.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j]!)) j++;
      tokens.push(line.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

// `{1 "2010" 6 "1001"}` -> { costCenter: '2010', project: '1001' }. Dimension
// 1 is always cost centre and 6 always project in Fortnox's SIE export (see
// the #DIM lines at the top of the file); other dimension numbers exist in
// the SIE standard but Fortnox does not emit them, so they're ignored.
function parseDimensions(raw: string): { costCenter?: string; project?: string } {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return {};
  const parts = tokenize(inner);
  const result: { costCenter?: string; project?: string } = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] === '1') result.costCenter = parts[i + 1];
    else if (parts[i] === '6') result.project = parts[i + 1];
  }
  return result;
}

// SIE amounts use an optional minus, digits, and at most two decimal places.
// Check exact minor units before converting to the public number representation:
// cents must be safe integers, and both fixed-decimal display and JSON number
// serialization must preserve the input. Reject cent-level rounding loss.
function parseFiniteAmount(raw: string, context: string): number {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error(`SIE export contains a malformed amount "${raw}" (${context}).`);
  }
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const normalized = `${BigInt(whole!)}.${fraction.padEnd(2, '0')}`;
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  const value = Number(raw);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || Math.abs(value).toFixed(2) !== normalized) {
    throw new Error(`SIE export contains an unsafe amount "${raw}" (${context}).`);
  }
  // JSON uses Number#toString, which can choose a shorter decimal than toFixed
  // at large magnitudes (e.g. 90071992547409.91 becomes 90071992547409.9).
  const [serializedWhole, serializedFraction = ''] = Math.abs(value).toString().split('.');
  if (`${serializedWhole}.${serializedFraction.padEnd(2, '0')}` !== normalized) {
    throw new Error(`SIE export contains an unsafe amount "${raw}" (${context}).`);
  }
  return value;
}

export function parseSie(text: string): ParsedSie {
  const accounts = new Map<string, SieAccount>();
  const transactions: SieTransaction[] = [];
  const openingBalances: SieBalance[] = [];
  const closingBalances: SieBalance[] = [];
  let companyName: string | undefined;
  let organisationNumber: string | undefined;

  let currentVoucher:
    | { series: string; number: string; date: string; regDate?: string; description: string }
    | undefined;
  // Whether we're between a voucher's `{` and `}` lines. #TRANS only means
  // anything inside that block; a stray or truncated one after `}` (before
  // the next #VER) must not be attributed to the voucher that already closed.
  let insideVoucherBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '{') {
      insideVoucherBlock = true;
      continue;
    }
    if (line === '}') {
      insideVoucherBlock = false;
      currentVoucher = undefined;
      continue;
    }
    if (!line.startsWith('#')) continue;
    const tag = line.slice(1).split(/\s/, 1)[0];

    if (tag === 'FNAMN') {
      companyName = tokenize(line)[1];
    } else if (tag === 'ORGNR') {
      organisationNumber = tokenize(line)[1];
    } else if (tag === 'KONTO') {
      const [, number, description] = tokenize(line);
      if (number) accounts.set(number, { number, description: description ?? '' });
    } else if (tag === 'SRU') {
      const [, number, sru] = tokenize(line);
      if (number) {
        const existing = accounts.get(number);
        if (existing) existing.sru = sru;
        else accounts.set(number, { number, description: '', sru });
      }
    } else if (tag === 'IB' || tag === 'UB') {
      const [, yearIndex, account, balance] = tokenize(line);
      if (account && balance !== undefined) {
        const entry: SieBalance = {
          account,
          yearIndex: Number(yearIndex),
          balance: parseFiniteAmount(balance, `#${tag} ${account}`),
        };
        (tag === 'IB' ? openingBalances : closingBalances).push(entry);
      }
    } else if (tag === 'VER') {
      const [, series, number, date, description, regDate] = tokenize(line);
      if (series && number) {
        currentVoucher = {
          series,
          number,
          date: date ?? '',
          regDate,
          description: description ?? '',
        };
      }
    } else if (tag === 'TRANS') {
      const tokens = tokenize(line);
      const [, account, dims, amount, transactionDate, text] = tokens;
      if (account && amount !== undefined && currentVoucher && insideVoucherBlock) {
        const { costCenter, project } = dims ? parseDimensions(dims) : {};
        transactions.push({
          series: currentVoucher.series,
          voucherNumber: currentVoucher.number,
          voucherDate: currentVoucher.date,
          transactionDate: transactionDate || currentVoucher.date,
          registrationDate: currentVoucher.regDate,
          voucherDescription: currentVoucher.description,
          account,
          amount: parseFiniteAmount(
            amount,
            `#TRANS ${account} in voucher ${currentVoucher.series}${currentVoucher.number}`,
          ),
          costCenter,
          project,
          text: text || undefined,
        });
      }
    }
  }

  return {
    companyName,
    organisationNumber,
    accounts,
    transactions,
    openingBalances,
    closingBalances,
  };
}

// SIE declares its own encoding via `#FORMAT PC8` — IBM code page 437, not
// UTF-8 or Latin-1. Decoding as Latin-1 silently eats every å/ä/ö: CP437's
// byte for `ä` (0x84) falls in Latin-1's C1-control range, so it renders as
// nothing rather than the wrong character — e.g. "Intäktsränta" becomes
// "Intktsrnta". Bytes 0x00-0x7F are plain ASCII in both encodings; only the
// upper half needs remapping.
const CP437_UPPER = [
  'Ç',
  'ü',
  'é',
  'â',
  'ä',
  'à',
  'å',
  'ç',
  'ê',
  'ë',
  'è',
  'ï',
  'î',
  'ì',
  'Ä',
  'Å',
  'É',
  'æ',
  'Æ',
  'ô',
  'ö',
  'ò',
  'û',
  'ù',
  'ÿ',
  'Ö',
  'Ü',
  '¢',
  '£',
  '¥',
  '₧',
  'ƒ',
  'á',
  'í',
  'ó',
  'ú',
  'ñ',
  'Ñ',
  'ª',
  'º',
  '¿',
  '⌐',
  '¬',
  '½',
  '¼',
  '¡',
  '«',
  '»',
  '░',
  '▒',
  '▓',
  '│',
  '┤',
  '╡',
  '╢',
  '╖',
  '╕',
  '╣',
  '║',
  '╗',
  '╝',
  '╜',
  '╛',
  '┐',
  '└',
  '┴',
  '┬',
  '├',
  '─',
  '┼',
  '╞',
  '╟',
  '╚',
  '╔',
  '╩',
  '╦',
  '╠',
  '═',
  '╬',
  '╧',
  '╨',
  '╤',
  '╥',
  '╙',
  '╘',
  '╒',
  '╓',
  '╫',
  '╪',
  '┘',
  '┌',
  '█',
  '▄',
  '▌',
  '▐',
  '▀',
  'α',
  'ß',
  'Γ',
  'π',
  'Σ',
  'σ',
  'µ',
  'τ',
  'Φ',
  'Θ',
  'Ω',
  'δ',
  '∞',
  'φ',
  'ε',
  '∩',
  '≡',
  '±',
  '≥',
  '≤',
  '⌠',
  '⌡',
  '÷',
  '≈',
  '°',
  '∙',
  '·',
  '√',
  'ⁿ',
  '²',
  '■',
  ' ',
];

function decodeCp437(buffer: Buffer): string {
  let out = '';
  for (const byte of buffer) {
    out += byte < 0x80 ? String.fromCharCode(byte) : CP437_UPPER[byte - 0x80];
  }
  return out;
}

export interface FetchSieParams {
  fromDate?: string;
  toDate?: string;
  financialYear?: number;
}

/** Fetch and parse the SIE4 (full transaction detail) export for a period. */
export async function fetchSie(
  transport: FortnoxTransport,
  params: FetchSieParams = {},
): Promise<ParsedSie> {
  const { buffer } = await transport.requestFile('sie/4', {
    params: {
      fromdate: params.fromDate,
      todate: params.toDate,
      financialyear: params.financialYear,
    },
  });
  return parseSie(decodeCp437(buffer));
}
