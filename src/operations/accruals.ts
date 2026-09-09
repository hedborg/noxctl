import { defaultFortnoxTransport, type FortnoxTransport } from '../fortnox-client.js';
import { documentSegment } from '../identifiers.js';

interface AccrualDefinition {
  endpoint: string;
  listKey: string;
  singleKey: string;
  readOnlyFields?: readonly string[];
}

function createAccrualResourceOperations(
  transport: FortnoxTransport,
  definition: AccrualDefinition,
) {
  // Server-derived fields Fortnox rejects on write ("Fältet Times är endast
  // läsbart"), even though its own spec lists them as required on the payload.
  // Stripping them lets a `get` response be fed back into create/update
  // unchanged; Fortnox recomputes them from StartDate/EndDate and Period.
  function stripReadOnlyFields(fields: Record<string, unknown>): Record<string, unknown> {
    if (!definition.readOnlyFields) return fields;
    const writable = { ...fields };
    for (const field of definition.readOnlyFields) delete writable[field];
    return writable;
  }

  async function list() {
    const raw = await transport.request<Record<string, unknown>>(definition.endpoint);
    return {
      items: (raw[definition.listKey] ?? []) as Record<string, unknown>[],
      raw,
    };
  }

  async function get(documentNumber: string) {
    const raw = await transport.request<Record<string, unknown>>(
      `${definition.endpoint}/${documentSegment(documentNumber)}`,
    );
    return (raw[definition.singleKey] ?? {}) as Record<string, unknown>;
  }

  async function create(fields: Record<string, unknown>) {
    const raw = await transport.request<Record<string, unknown>>(definition.endpoint, {
      method: 'POST',
      body: { [definition.singleKey]: stripReadOnlyFields(fields) },
    });
    return (raw[definition.singleKey] ?? {}) as Record<string, unknown>;
  }

  async function update(documentNumber: string, fields: Record<string, unknown>) {
    const raw = await transport.request<Record<string, unknown>>(
      `${definition.endpoint}/${documentSegment(documentNumber)}`,
      { method: 'PUT', body: { [definition.singleKey]: stripReadOnlyFields(fields) } },
    );
    return (raw[definition.singleKey] ?? {}) as Record<string, unknown>;
  }

  async function remove(documentNumber: string): Promise<void> {
    await transport.request(`${definition.endpoint}/${documentSegment(documentNumber)}`, {
      method: 'DELETE',
    });
  }

  return { list, get, create, update, remove };
}

export function createAccrualOperations(transport: FortnoxTransport) {
  const invoices = createAccrualResourceOperations(transport, {
    endpoint: 'invoiceaccruals',
    listKey: 'InvoiceAccruals',
    singleKey: 'InvoiceAccrual',
  });
  const supplierInvoices = createAccrualResourceOperations(transport, {
    endpoint: 'supplierinvoiceaccruals',
    listKey: 'SupplierInvoiceAccruals',
    singleKey: 'SupplierInvoiceAccrual',
    readOnlyFields: ['Times'],
  });
  const contracts = createAccrualResourceOperations(transport, {
    endpoint: 'contractaccruals',
    listKey: 'ContractAccruals',
    singleKey: 'ContractAccrual',
  });
  return {
    listInvoiceAccruals: invoices.list,
    getInvoiceAccrual: invoices.get,
    createInvoiceAccrual: invoices.create,
    updateInvoiceAccrual: invoices.update,
    deleteInvoiceAccrual: invoices.remove,
    listSupplierInvoiceAccruals: supplierInvoices.list,
    getSupplierInvoiceAccrual: supplierInvoices.get,
    createSupplierInvoiceAccrual: supplierInvoices.create,
    updateSupplierInvoiceAccrual: supplierInvoices.update,
    deleteSupplierInvoiceAccrual: supplierInvoices.remove,
    listContractAccruals: contracts.list,
    getContractAccrual: contracts.get,
    createContractAccrual: contracts.create,
    updateContractAccrual: contracts.update,
    deleteContractAccrual: contracts.remove,
  };
}

export const accrualOperations = createAccrualOperations(defaultFortnoxTransport);
export const {
  listInvoiceAccruals,
  getInvoiceAccrual,
  createInvoiceAccrual,
  updateInvoiceAccrual,
  deleteInvoiceAccrual,
  listSupplierInvoiceAccruals,
  getSupplierInvoiceAccrual,
  createSupplierInvoiceAccrual,
  updateSupplierInvoiceAccrual,
  deleteSupplierInvoiceAccrual,
  listContractAccruals,
  getContractAccrual,
  createContractAccrual,
  updateContractAccrual,
  deleteContractAccrual,
} = accrualOperations;
