import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodType } from 'zod';
import { defaultFortnoxOperations, type FortnoxOperations } from '../operations/index.js';
import {
  detailResponse,
  dryRunResponse,
  listResponse,
  requireConfirmation,
  textResponse,
} from '../tool-output.js';
import { referenceDataColumns } from '../views.js';

const Account = z.number().int().min(1000).max(9999);
const ContractPeriod = z.enum(['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'ANNUALLY']);
const InvoicePeriod = z.enum([
  ...ContractPeriod.options,
  '1_MONTHS',
  '2_MONTHS',
  '3_MONTHS',
  '6_MONTHS',
  '12_MONTHS',
]);
const AccrualRow = z.strictObject({
  Account,
  CostCenter: z.string().optional(),
  Credit: z.number().optional(),
  Debit: z.number().optional(),
  Project: z.string().optional(),
  TransactionInformation: z.string().max(100).optional(),
});

const commonScheduleFields = {
  AccrualAccount: Account,
  EndDate: z.iso.date(),
  StartDate: z.iso.date(),
  Total: z.number(),
  VATIncluded: z.boolean().optional(),
};

interface AccrualToolDefinition {
  id: string;
  swedishName: string;
  envelope: string;
  listOperation: string;
  getOperation: string;
  createOperation: string;
  updateOperation: string;
  deleteOperation: string;
  fields: Record<string, ZodType>;
}

export const ACCRUAL_TOOL_DEFINITIONS: readonly AccrualToolDefinition[] = [
  {
    id: 'invoice_accrual',
    swedishName: 'kundfakturaperiodisering',
    envelope: 'InvoiceAccrual',
    listOperation: 'listInvoiceAccruals',
    getOperation: 'getInvoiceAccrual',
    createOperation: 'createInvoiceAccrual',
    updateOperation: 'updateInvoiceAccrual',
    deleteOperation: 'deleteInvoiceAccrual',
    fields: {
      ...commonScheduleFields,
      Description: z.string(),
      InvoiceNumber: z.number().int(),
      Period: InvoicePeriod.optional(),
      RevenueAccount: Account,
      Times: z.number().int().optional(),
      InvoiceAccrualRows: z.array(AccrualRow).min(2),
    },
  },
  {
    id: 'supplier_invoice_accrual',
    swedishName: 'leverantörsfakturaperiodisering',
    envelope: 'SupplierInvoiceAccrual',
    listOperation: 'listSupplierInvoiceAccruals',
    getOperation: 'getSupplierInvoiceAccrual',
    createOperation: 'createSupplierInvoiceAccrual',
    updateOperation: 'updateSupplierInvoiceAccrual',
    deleteOperation: 'deleteSupplierInvoiceAccrual',
    fields: {
      ...commonScheduleFields,
      Description: z.string().optional(),
      SupplierInvoiceNumber: z.number().int(),
      CostAccount: Account,
      Period: InvoicePeriod,
      // Times is deliberately NOT declared here: Fortnox rejects it on write
      // ("Fältet Times är endast läsbart") and computes it from StartDate/
      // EndDate and Period — the web UI shows it as a derived "Tot.antal" with
      // no input field. operations/accruals.ts strips it defensively too, so a
      // `get` response fed straight back into create/update still works, but
      // the tool schema should not offer a field that would then be silently
      // dropped a second time.
      SupplierInvoiceAccrualRows: z.array(AccrualRow).min(2),
    },
  },
  {
    id: 'contract_accrual',
    swedishName: 'avtalsperiodisering',
    envelope: 'ContractAccrual',
    listOperation: 'listContractAccruals',
    getOperation: 'getContractAccrual',
    createOperation: 'createContractAccrual',
    updateOperation: 'updateContractAccrual',
    deleteOperation: 'deleteContractAccrual',
    fields: {
      AccrualAccount: Account,
      AccrualRows: z.array(AccrualRow).min(2),
      CostAccount: Account,
      Description: z.string(),
      DocumentNumber: z.number().int(),
      Period: ContractPeriod.optional(),
      Times: z.number().int().optional(),
      Total: z.number(),
      VATIncluded: z.boolean().optional(),
    },
  },
];

type DynamicOperation = (...arguments_: unknown[]) => Promise<unknown>;

export function registerAccrualTools(
  server: McpServer,
  operations: FortnoxOperations = defaultFortnoxOperations,
): void {
  const dynamic = operations as unknown as Record<string, DynamicOperation>;
  for (const definition of ACCRUAL_TOOL_DEFINITIONS) {
    server.tool(
      `fortnox_list_${definition.id}s`,
      `Lista ${definition.swedishName}ar i Fortnox`,
      { includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox') },
      async ({ includeRaw }) => {
        const result = (await dynamic[definition.listOperation]?.()) as {
          items: Record<string, unknown>[];
          raw: Record<string, unknown>;
        };
        if (!result) throw new Error(`Missing operation ${definition.listOperation}`);
        return listResponse(
          result.items,
          referenceDataColumns,
          result.raw,
          result.raw.MetaInformation as Record<string, unknown> | undefined,
          includeRaw,
        );
      },
    );

    server.tool(
      `fortnox_get_${definition.id}`,
      `Hämta en ${definition.swedishName} från Fortnox`,
      {
        documentNumber: z.string().regex(/^\d+$/).describe('Dokumentnummer'),
        includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
      },
      async ({ documentNumber, includeRaw }) => {
        const item = (await dynamic[definition.getOperation]?.(documentNumber)) as Record<
          string,
          unknown
        >;
        return detailResponse(item, referenceDataColumns, item, includeRaw);
      },
    );

    server.tool(
      `fortnox_create_${definition.id}`,
      `Skapa en ${definition.swedishName} i Fortnox`,
      {
        ...definition.fields,
        confirm: z.boolean().optional().describe('Bekräfta att periodiseringen ska skapas'),
        dryRun: z.boolean().optional().describe('Visa exakt payload utan att skapa'),
        includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
      },
      async (arguments_) => {
        const fields = { ...(arguments_ as Record<string, unknown>) };
        const { confirm, dryRun, includeRaw } = fields;
        delete fields.confirm;
        delete fields.dryRun;
        delete fields.includeRaw;
        const target = `create ${definition.id}`;
        if (dryRun) return dryRunResponse(target, { [definition.envelope]: fields });
        if (!confirm) requireConfirmation(target);
        const item = (await dynamic[definition.createOperation]?.(fields)) as Record<
          string,
          unknown
        >;
        return detailResponse(item, referenceDataColumns, item, Boolean(includeRaw));
      },
    );

    server.tool(
      `fortnox_update_${definition.id}`,
      `Uppdatera en ${definition.swedishName} i Fortnox`,
      {
        documentNumber: z.string().regex(/^\d+$/).describe('Dokumentnummer'),
        ...definition.fields,
        confirm: z.boolean().optional().describe('Bekräfta uppdateringen'),
        dryRun: z.boolean().optional().describe('Visa exakt payload utan att uppdatera'),
        includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
      },
      async (arguments_) => {
        const fields = { ...(arguments_ as Record<string, unknown>) };
        const documentNumber = String(fields.documentNumber);
        const { confirm, dryRun, includeRaw } = fields;
        delete fields.documentNumber;
        delete fields.confirm;
        delete fields.dryRun;
        delete fields.includeRaw;
        const target = `update ${definition.id} ${documentNumber}`;
        if (dryRun) return dryRunResponse(target, { [definition.envelope]: fields });
        if (!confirm) requireConfirmation(target);
        const item = (await dynamic[definition.updateOperation]?.(
          documentNumber,
          fields,
        )) as Record<string, unknown>;
        return detailResponse(item, referenceDataColumns, item, Boolean(includeRaw));
      },
    );

    server.tool(
      `fortnox_delete_${definition.id}`,
      `Ta bort en ${definition.swedishName} i Fortnox`,
      {
        documentNumber: z.string().regex(/^\d+$/).describe('Dokumentnummer'),
        confirm: z.boolean().optional().describe('Bekräfta borttagningen'),
        dryRun: z.boolean().optional().describe('Visa åtgärden utan att ta bort'),
      },
      async ({ documentNumber, confirm, dryRun }) => {
        const target = `delete ${definition.id} ${documentNumber}`;
        if (dryRun) return dryRunResponse(target);
        if (!confirm) requireConfirmation(target);
        await dynamic[definition.deleteOperation]?.(documentNumber);
        return textResponse(`${definition.envelope} ${documentNumber} deleted.`);
      },
    );
  }
}
