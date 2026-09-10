import { describe, expect, it, vi } from 'vitest';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FortnoxTransport } from '../src/fortnox-client.js';
import { createAccrualOperations } from '../src/operations/accruals.js';

const CLI_PATH = path.resolve('dist/cli.js');
const CLI_TIMEOUT_MS = 30_000;

const supplierInvoiceAccrual = {
  AccrualAccount: 1790,
  CostAccount: 6540,
  Description: 'Annual service',
  EndDate: '2026-12-31',
  Period: 'MONTHLY',
  StartDate: '2026-01-01',
  SupplierInvoiceAccrualRows: [
    { Account: 6540, Debit: 100, CostCenter: 'A1' },
    { Account: 1790, Credit: 100, Project: 'P1' },
  ],
  SupplierInvoiceNumber: 42,
  Times: 12,
  Total: 1200,
  VATIncluded: true,
} as const;

function parsePreview(output: string): Record<string, unknown> {
  const marker = 'Request payload:\n';
  const markerStart = output.indexOf(marker);
  expect(markerStart).toBeGreaterThanOrEqual(0);
  return JSON.parse(output.slice(markerStart + marker.length)) as Record<string, unknown>;
}

function runDryRun(
  resource: 'invoice-accruals' | 'supplier-invoice-accruals' | 'contract-accruals',
  action: 'create' | 'update',
  inputMode: 'file' | 'stdin',
  input: Record<string, unknown>,
): string {
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'noxctl-169-home-'));
  try {
    const args = [CLI_PATH, resource, action];
    if (action === 'update') args.push('7');
    const inputText = JSON.stringify(input);
    if (inputMode === 'file') {
      const inputFile = path.join(tmpHome, 'accrual.json');
      writeFileSync(inputFile, `${inputText}\n`);
      args.push('--input', inputFile);
    } else {
      args.push('--input', '-');
    }
    args.push('--dry-run');

    const options: ExecFileSyncOptions = {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, NOXCTL_PROFILE: 'default' },
      input: inputMode === 'stdin' ? inputText : undefined,
      timeout: CLI_TIMEOUT_MS,
    };
    return execFileSync('node', args, options) as string;
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

describe('supplier invoice accrual CLI previews', () => {
  it.each([
    { action: 'create', inputMode: 'file' },
    { action: 'create', inputMode: 'stdin' },
    { action: 'update', inputMode: 'file' },
    { action: 'update', inputMode: 'stdin' },
  ] as const)(
    'previews the same writable $action request for $inputMode input',
    async ({ action, inputMode }) => {
      const request = vi.fn().mockResolvedValue({ SupplierInvoiceAccrual: { DocumentNumber: 7 } });
      const operations = createAccrualOperations({ request } as unknown as FortnoxTransport);
      const input = structuredClone(supplierInvoiceAccrual) as Record<string, unknown>;
      const originalInput = structuredClone(input);

      if (action === 'create') {
        await operations.createSupplierInvoiceAccrual(input);
      } else {
        await operations.updateSupplierInvoiceAccrual('7', input);
      }
      const writableBody = request.mock.calls[0]?.[1]?.body;

      expect(input).toEqual(originalInput);
      const output = runDryRun('supplier-invoice-accruals', action, inputMode, input);
      const preview = parsePreview(output);
      expect(preview).toEqual(writableBody);
      expect(preview.SupplierInvoiceAccrual).not.toHaveProperty('Times');

      expect(input).toEqual(originalInput);
    },
  );

  it('keeps Times in ordinary invoice and contract accrual previews', async () => {
    const request = vi.fn().mockResolvedValue({});
    const operations = createAccrualOperations({ request } as unknown as FortnoxTransport);
    const invoiceInput = { Total: 100, Times: 3 };
    await operations.createInvoiceAccrual(invoiceInput);
    const invoiceBody = request.mock.calls[0]?.[1]?.body;

    const invoiceOutput = runDryRun('invoice-accruals', 'create', 'file', invoiceInput);
    expect(parsePreview(invoiceOutput)).toEqual(invoiceBody);

    request.mockClear();
    const contractInput = { Total: 200, Times: 4 };
    await operations.updateContractAccrual('7', contractInput);
    const contractBody = request.mock.calls[0]?.[1]?.body;

    const contractOutput = runDryRun('contract-accruals', 'update', 'stdin', contractInput);
    expect(parsePreview(contractOutput)).toEqual(contractBody);
  });
});
