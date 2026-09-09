import { describe, expect, it, vi } from 'vitest';
import type { FortnoxTransport } from '../../src/fortnox-client.js';
import { createAccrualOperations } from '../../src/operations/accruals.js';

describe('accrual operations', () => {
  it('covers list/get/create/update/delete for all three native families', async () => {
    const request = vi.fn();
    const operations = createAccrualOperations({ request } as unknown as FortnoxTransport);
    const definitions = [
      ['Invoice', 'invoiceaccruals', 'InvoiceAccruals', 'InvoiceAccrual'],
      [
        'SupplierInvoice',
        'supplierinvoiceaccruals',
        'SupplierInvoiceAccruals',
        'SupplierInvoiceAccrual',
      ],
      ['Contract', 'contractaccruals', 'ContractAccruals', 'ContractAccrual'],
    ] as const;
    const dynamic = operations as unknown as Record<
      string,
      (...arguments_: unknown[]) => Promise<unknown>
    >;

    for (const [prefix, endpoint, listKey, singleKey] of definitions) {
      request.mockResolvedValueOnce({ [listKey]: [{ DocumentNumber: 7 }] });
      const listed = (await dynamic[`list${prefix}Accruals`]?.()) as {
        items: Record<string, unknown>[];
      };
      expect(listed.items).toHaveLength(1);
      expect(request).toHaveBeenLastCalledWith(endpoint);

      request.mockResolvedValueOnce({ [singleKey]: { DocumentNumber: 7 } });
      await dynamic[`get${prefix}Accrual`]?.('7');
      expect(request).toHaveBeenLastCalledWith(`${endpoint}/7`);

      request.mockResolvedValueOnce({ [singleKey]: { DocumentNumber: 7 } });
      await dynamic[`create${prefix}Accrual`]?.({ Total: 100 });
      expect(request).toHaveBeenLastCalledWith(endpoint, {
        method: 'POST',
        body: { [singleKey]: { Total: 100 } },
      });

      request.mockResolvedValueOnce({ [singleKey]: { DocumentNumber: 7 } });
      await dynamic[`update${prefix}Accrual`]?.('7', { Total: 200 });
      expect(request).toHaveBeenLastCalledWith(`${endpoint}/7`, {
        method: 'PUT',
        body: { [singleKey]: { Total: 200 } },
      });

      request.mockResolvedValueOnce({});
      await dynamic[`delete${prefix}Accrual`]?.('7');
      expect(request).toHaveBeenLastCalledWith(`${endpoint}/7`, { method: 'DELETE' });
    }
  });

  it('rejects unsafe document-number path segments', async () => {
    const request = vi.fn();
    const operations = createAccrualOperations({ request } as unknown as FortnoxTransport);
    await expect(operations.getInvoiceAccrual('../companyinformation')).rejects.toThrow(
      'Invalid document number',
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe('supplier invoice accrual read-only fields', () => {
  it('strips Times from the create payload', async () => {
    const request = vi.fn().mockResolvedValue({ SupplierInvoiceAccrual: { DocumentNumber: 7 } });
    const operations = createAccrualOperations({ request } as unknown as FortnoxTransport);

    await operations.createSupplierInvoiceAccrual({
      SupplierInvoiceNumber: 42,
      AccrualAccount: 1710,
      CostAccount: 5010,
      Period: 'monthly',
      StartDate: '2026-10-01',
      EndDate: '2026-12-31',
      Times: 3,
      Total: 9630,
    });

    const body = request.mock.calls[0]?.[1]?.body as {
      SupplierInvoiceAccrual: Record<string, unknown>;
    };
    expect(body.SupplierInvoiceAccrual).not.toHaveProperty('Times');
    expect(body.SupplierInvoiceAccrual.Total).toBe(9630);
    expect(body.SupplierInvoiceAccrual.AccrualAccount).toBe(1710);
  });

  it('strips Times from the update payload', async () => {
    const request = vi.fn().mockResolvedValue({ SupplierInvoiceAccrual: { DocumentNumber: 7 } });
    const operations = createAccrualOperations({ request } as unknown as FortnoxTransport);

    await operations.updateSupplierInvoiceAccrual('7', { Times: 3, Total: 9630 });

    const body = request.mock.calls[0]?.[1]?.body as {
      SupplierInvoiceAccrual: Record<string, unknown>;
    };
    expect(body.SupplierInvoiceAccrual).not.toHaveProperty('Times');
    expect(body.SupplierInvoiceAccrual.Total).toBe(9630);
  });
});
