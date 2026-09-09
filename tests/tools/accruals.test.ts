import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/index.js';
import { ACCRUAL_TOOL_DEFINITIONS } from '../../src/tools/accruals.js';

vi.mock('../../src/auth.js', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock-token'),
  getResolvedProfile: vi.fn().mockReturnValue('default'),
}));

async function setup() {
  const server = createServer();
  const client = new Client({ name: 'accrual-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

const payloads = {
  invoice_accrual: {
    AccrualAccount: 1790,
    Description: 'Annual service',
    EndDate: '2026-12-31',
    InvoiceAccrualRows: [
      { Account: 3001, Credit: 100 },
      { Account: 1790, Debit: 100 },
    ],
    InvoiceNumber: 7,
    RevenueAccount: 3001,
    StartDate: '2026-01-01',
    Total: 1200,
  },
  supplier_invoice_accrual: {
    AccrualAccount: 1790,
    CostAccount: 6540,
    EndDate: '2026-12-31',
    Period: 'MONTHLY',
    StartDate: '2026-01-01',
    SupplierInvoiceAccrualRows: [
      { Account: 6540, Debit: 100 },
      { Account: 1790, Credit: 100 },
    ],
    SupplierInvoiceNumber: 7,
    Total: 1200,
  },
  contract_accrual: {
    AccrualAccount: 1790,
    AccrualRows: [
      { Account: 3001, Credit: 100 },
      { Account: 1790, Debit: 100 },
    ],
    CostAccount: 3001,
    Description: 'Contract',
    DocumentNumber: 7,
    Total: 1200,
  },
} as const;

describe('accrual tools', () => {
  it('discovers the full lifecycle for every accrual family', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map(({ name }) => name);
    for (const definition of ACCRUAL_TOOL_DEFINITIONS) {
      for (const verb of ['list', 'get', 'create', 'update', 'delete']) {
        const plural = verb === 'list' ? 's' : '';
        expect(names).toContain(`fortnox_${verb}_${definition.id}${plural}`);
      }
    }
  });

  it('previews exact create/update/delete payloads without network access', async () => {
    global.fetch = vi.fn();
    const { client } = await setup();
    for (const definition of ACCRUAL_TOOL_DEFINITIONS) {
      const payload = payloads[definition.id as keyof typeof payloads];
      for (const request of [
        { name: `fortnox_create_${definition.id}`, arguments: { ...payload, dryRun: true } },
        {
          name: `fortnox_update_${definition.id}`,
          arguments: { documentNumber: '7', ...payload, dryRun: true },
        },
        {
          name: `fortnox_delete_${definition.id}`,
          arguments: { documentNumber: '7', dryRun: true },
        },
      ]) {
        const result = await client.callTool(request);
        expect(result.isError, request.name).toBeFalsy();
        expect((result.content as { text: string }[])[0]?.text).toContain('Dry run');
      }
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown nested row properties before a request', async () => {
    global.fetch = vi.fn();
    const { client } = await setup();
    const result = await client.callTool({
      name: 'fortnox_create_invoice_accrual',
      arguments: {
        ...payloads.invoice_accrual,
        InvoiceAccrualRows: [
          { Account: 3001, Unknown: true },
          { Account: 1790, Debit: 100 },
        ],
        confirm: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts the extended native period values for invoice accrual families', async () => {
    global.fetch = vi.fn();
    const { client } = await setup();
    for (const [name, payload] of [
      ['fortnox_create_invoice_accrual', payloads.invoice_accrual],
      ['fortnox_create_supplier_invoice_accrual', payloads.supplier_invoice_accrual],
    ] as const) {
      const result = await client.callTool({
        name,
        arguments: { ...payload, Period: '12_MONTHS', dryRun: true },
      });
      expect(result.isError, name).toBeFalsy();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('supplier invoice accrual read-only Times', () => {
  it('does not advertise Times on the create tool', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === 'fortnox_create_supplier_invoice_accrual');

    expect(create).toBeDefined();
    expect(Object.keys(create?.inputSchema?.properties ?? {})).not.toContain('Times');
    // The writable fields Fortnox does derive Times from must still be offered.
    expect(Object.keys(create?.inputSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['StartDate', 'EndDate', 'Period']),
    );
  });
});
