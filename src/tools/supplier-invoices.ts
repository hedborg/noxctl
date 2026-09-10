import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { defaultFortnoxOperations, type FortnoxOperations } from '../operations/index.js';
import { privateOutputPath, writeBinaryFile } from '../safe-file-output.js';
import {
  supplierInvoiceListColumns,
  supplierInvoiceDetailColumns,
  supplierInvoiceConfirmColumns,
  supplierInvoiceAttachmentColumns,
} from '../views.js';
import {
  detailResponse,
  dryRunResponse,
  listResponse,
  requireConfirmation,
  textResponse,
} from '../tool-output.js';

const SupplierInvoiceRowSchema = z.strictObject({
  Account: z.number().int().min(1000).max(9999).describe('Kontonummer (1000–9999)'),
  AccountDescription: z.string().optional().describe('Kontobeskrivning'),
  ArticleNumber: z.string().optional().describe('Artikelnummer'),
  Code: z
    .enum([
      'TOT',
      'VAT',
      'FRT',
      'AFE',
      'ROV',
      'CND',
      'CNC',
      'PRD',
      'PRC',
      'SRD',
      'SRC',
      'PRE',
      'GWB',
      'ACC',
    ])
    .optional()
    .describe('Radkod enligt Fortnox'),
  CostCenter: z.string().nullable().optional().describe('Kostnadsställe'),
  Debit: z.number().optional().describe('Debetbelopp'),
  DebitCurrency: z.number().optional().describe('Debetbelopp i fakturans valuta'),
  Credit: z.number().optional().describe('Kreditbelopp'),
  CreditCurrency: z.number().optional().describe('Kreditbelopp i fakturans valuta'),
  Description: z
    .string()
    .optional()
    .describe('Äldre kompatibilitetsfält för beskrivning; använd ItemDescription'),
  ItemDescription: z.string().optional().describe('Artikel- eller radbeskrivning'),
  Price: z.number().optional().describe('Pris per enhet'),
  Project: z.string().optional().describe('Projektnummer'),
  Quantity: z.number().int().optional().describe('Antal'),
  StockLocationCode: z.string().optional().describe('Lagerplatskod'),
  StockPointCode: z.string().optional().describe('Lagerställekod'),
  Total: z.number().nullable().optional().describe('Radens totalbelopp'),
  TransactionInformation: z
    .string()
    .max(100)
    .optional()
    .describe('Transaktionsinformation (max 100 tecken)'),
  Unit: z.string().optional().describe('Enhet'),
});

export function registerSupplierInvoiceTools(
  server: McpServer,
  operations: FortnoxOperations = defaultFortnoxOperations,
): void {
  const {
    listSupplierInvoices,
    getSupplierInvoice,
    createSupplierInvoice,
    updateSupplierInvoice,
    bookkeepSupplierInvoice,
    approvalBookkeepSupplierInvoice,
    approvalPaymentSupplierInvoice,
    cancelSupplierInvoice,
    creditSupplierInvoice,
    listSupplierInvoiceAttachments,
    getSupplierInvoiceFile,
    getSupplierInvoiceFileConnection,
    createSupplierInvoiceFileConnection,
    deleteSupplierInvoiceFileConnection,
    extensionForMime,
  } = operations;
  server.tool(
    'fortnox_list_supplier_invoices',
    'Lista leverantörsfakturor i Fortnox. Returnerar: GivenNumber, SupplierName, InvoiceDate, DueDate, Total, Balance.',
    {
      filter: z
        .enum([
          'fullypaid',
          'cancelled',
          'unpaid',
          'unpaidoverdue',
          'unbooked',
          'pendingpayment',
          'authorizepending',
        ])
        .optional()
        .describe(
          'Filter: fullypaid, cancelled, unpaid, unpaidoverdue, unbooked, pendingpayment, authorizepending',
        ),
      supplierNumber: z.string().optional().describe('Filtrera på leverantörsnummer'),
      fromDate: z.string().optional().describe('Från datum (YYYY-MM-DD)'),
      toDate: z.string().optional().describe('Till datum (YYYY-MM-DD)'),
      page: z.number().optional().describe('Sidnummer (default 1)'),
      limit: z.number().optional().describe('Antal per sida (default 100, max 500)'),
      all: z.boolean().optional().describe('Hämta alla sidor (ignorerar page/limit)'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ filter, supplierNumber, fromDate, toDate, page, limit, all, includeRaw }) => {
      const data = await listSupplierInvoices({
        filter,
        supplierNumber,
        fromDate,
        toDate,
        page,
        limit,
        all,
      });
      return listResponse(
        data.SupplierInvoices ?? [],
        supplierInvoiceListColumns,
        data,
        data.MetaInformation,
        includeRaw,
      );
    },
  );

  server.tool(
    'fortnox_get_supplier_invoice',
    'Hämta en enskild leverantörsfaktura från Fortnox. Returnerar: GivenNumber, SupplierNumber, SupplierName, InvoiceNumber, InvoiceDate, DueDate, Total, Balance, Currency, Booked, OCR, Comments.',
    {
      givenNumber: z.string().describe('Leverantörsfakturanummer (GivenNumber)'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ givenNumber, includeRaw }) => {
      const data = await getSupplierInvoice(givenNumber);
      return detailResponse(data, supplierInvoiceDetailColumns, data, includeRaw);
    },
  );

  server.tool(
    'fortnox_create_supplier_invoice',
    'Skapa en leverantörsfaktura i Fortnox',
    {
      SupplierNumber: z.string().describe('Leverantörsnummer'),
      InvoiceNumber: z.string().optional().describe('Leverantörens fakturanummer'),
      InvoiceDate: z.string().optional().describe('Fakturadatum (YYYY-MM-DD)'),
      DueDate: z.string().optional().describe('Förfallodatum (YYYY-MM-DD)'),
      Total: z.number().optional().describe('Totalbelopp inkl. moms'),
      OCR: z.string().optional().describe('OCR-nummer'),
      Currency: z.string().optional().describe('Valutakod (default SEK)'),
      Comments: z.string().optional().describe('Kommentarer'),
      SupplierInvoiceRows: z
        .array(SupplierInvoiceRowSchema)
        .optional()
        .describe('Fakturarader med kontering, belopp och valfri artikel-/lagerinformation'),
      confirm: z.boolean().optional().describe('Bekräfta att leverantörsfakturan ska skapas'),
      dryRun: z
        .boolean()
        .optional()
        .describe('Visa vad som skulle skickas utan att skapa leverantörsfakturan'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ confirm, dryRun, includeRaw, ...params }) => {
      if (dryRun) {
        return dryRunResponse(`create supplier invoice for supplier ${params.SupplierNumber}`, {
          SupplierInvoice: params,
        });
      }
      if (!confirm)
        requireConfirmation(`create supplier invoice for supplier ${params.SupplierNumber}`);

      const data = await createSupplierInvoice(params);
      return detailResponse(data, supplierInvoiceDetailColumns, data, includeRaw);
    },
  );

  server.tool(
    'fortnox_bookkeep_supplier_invoice',
    'Bokför en leverantörsfaktura i Fortnox',
    {
      givenNumber: z.string().describe('Leverantörsfakturanummer att bokföra'),
      confirm: z.boolean().optional().describe('Bekräfta att leverantörsfakturan ska bokföras'),
      dryRun: z.boolean().optional().describe('Visa vad som skulle hända utan att bokföra'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ givenNumber, confirm, dryRun, includeRaw }) => {
      if (dryRun) {
        return dryRunResponse(`bookkeep supplier invoice ${givenNumber}`);
      }
      if (!confirm) requireConfirmation(`bookkeep supplier invoice ${givenNumber}`);

      const data = await bookkeepSupplierInvoice(givenNumber);
      return detailResponse(data, supplierInvoiceConfirmColumns, data, includeRaw);
    },
  );

  server.tool(
    'fortnox_update_supplier_invoice',
    'Uppdatera en leverantörsfaktura i Fortnox',
    {
      givenNumber: z.string().describe('Leverantörsfakturanummer att uppdatera'),
      SupplierNumber: z.string().optional().describe('Leverantörsnummer'),
      InvoiceNumber: z.string().optional().describe('Leverantörens fakturanummer'),
      InvoiceDate: z.string().optional().describe('Fakturadatum (YYYY-MM-DD)'),
      DueDate: z.string().optional().describe('Förfallodatum (YYYY-MM-DD)'),
      Total: z.number().optional().describe('Totalbelopp inkl. moms'),
      OCR: z.string().optional().describe('OCR-nummer'),
      Currency: z.string().optional().describe('Valutakod'),
      Comments: z.string().optional().describe('Kommentarer'),
      SupplierInvoiceRows: z
        .array(SupplierInvoiceRowSchema.partial())
        .optional()
        .describe('Fakturarader (ersätter befintliga rader)'),
      confirm: z.boolean().optional().describe('Bekräfta uppdateringen'),
      dryRun: z.boolean().optional().describe('Visa payload utan att uppdatera'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ givenNumber, confirm, dryRun, includeRaw, ...fields }) => {
      if (dryRun) {
        return dryRunResponse(`update supplier invoice ${givenNumber}`, {
          SupplierInvoice: fields,
        });
      }
      if (!confirm) requireConfirmation(`update supplier invoice ${givenNumber}`);
      const invoice = await updateSupplierInvoice(givenNumber, fields);
      return detailResponse(invoice, supplierInvoiceDetailColumns, invoice, includeRaw);
    },
  );

  const supplierInvoiceActions = [
    {
      name: 'fortnox_approval_bookkeep_supplier_invoice',
      description: 'Attestera och bokför en leverantörsfaktura i Fortnox',
      verb: 'approval bookkeep',
      message: 'attesterad och bokförd',
      execute: approvalBookkeepSupplierInvoice,
    },
    {
      name: 'fortnox_approval_payment_supplier_invoice',
      description: 'Betalningsattestera en leverantörsfaktura i Fortnox',
      verb: 'approval payment',
      message: 'betalningsattesterad',
      execute: approvalPaymentSupplierInvoice,
    },
    {
      name: 'fortnox_cancel_supplier_invoice',
      description: 'Makulera en leverantörsfaktura i Fortnox',
      verb: 'cancel',
      message: 'makulerad',
      execute: cancelSupplierInvoice,
    },
    {
      name: 'fortnox_credit_supplier_invoice',
      description: 'Kreditera en leverantörsfaktura i Fortnox',
      verb: 'credit',
      message: 'krediterad',
      execute: creditSupplierInvoice,
    },
  ] as const;
  for (const action of supplierInvoiceActions) {
    server.tool(
      action.name,
      action.description,
      {
        givenNumber: z.string().describe('Leverantörsfakturanummer'),
        confirm: z.boolean().optional().describe('Bekräfta åtgärden'),
        dryRun: z.boolean().optional().describe('Visa åtgärden utan att utföra den'),
        includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
      },
      async ({ givenNumber, confirm, dryRun, includeRaw }) => {
        const target = `${action.verb} supplier invoice ${givenNumber}`;
        if (dryRun) return dryRunResponse(target);
        if (!confirm) requireConfirmation(target);
        const invoice = await action.execute(givenNumber);
        return detailResponse(invoice, supplierInvoiceConfirmColumns, invoice, includeRaw);
      },
    );
  }

  server.tool(
    'fortnox_list_supplier_invoice_attachments',
    'Lista filer (t.ex. den inskannade/mottagna fakturan) som är kopplade till en leverantörsfaktura i Fortnox. Fungerar även för obokförda och ej godkända fakturor (unbooked/authorizepending) — till skillnad från verifikationsbilagor, som bara finns tillgängliga efter bokföring. Returnerar: File (filnamn), File ID. Använd fileId med fortnox_get_supplier_invoice_file för att hämta själva filen.',
    {
      givenNumber: z.string().describe('Leverantörsfakturanummer (GivenNumber)'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ givenNumber, includeRaw }) => {
      const attachments = await listSupplierInvoiceAttachments(givenNumber);
      return listResponse(
        attachments as unknown as Record<string, unknown>[],
        supplierInvoiceAttachmentColumns,
        attachments,
        undefined,
        includeRaw,
      );
    },
  );

  server.tool(
    'fortnox_get_supplier_invoice_file',
    'Ladda ner en fil som är kopplad till en leverantörsfaktura och spara den på disk. Returnerar sökvägen till filen (inte filinnehållet). Hämta fileId via fortnox_list_supplier_invoice_attachments.',
    {
      fileId: z.string().describe('Fil-ID, från fortnox_list_supplier_invoice_attachments'),
      outputPath: z
        .string()
        .optional()
        .describe(
          'Sökväg att spara filen till. Skriver inte över en befintlig fil om inte overwrite är satt. Utelämnas: en ny privat temp-katalog används.',
        ),
      overwrite: z
        .boolean()
        .optional()
        .describe('Tillåt att en befintlig fil på outputPath skrivs över'),
    },
    async ({ fileId, outputPath, overwrite }) => {
      const file = await getSupplierInvoiceFile(fileId);
      const ext = extensionForMime(file.contentType);
      const target = writeBinaryFile(
        outputPath ?? privateOutputPath('noxctl-', `supplier-invoice-file-${fileId}${ext}`),
        file.buffer,
        overwrite,
      );
      return textResponse(
        `Sparade fil (${file.contentType}, ${file.buffer.length} bytes) till ${target}`,
      );
    },
  );

  server.tool(
    'fortnox_get_supplier_invoice_file_connection',
    'Hämta metadata för en filkoppling till en leverantörsfaktura i Fortnox',
    {
      fileId: z.string().describe('Fil-ID'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ fileId, includeRaw }) => {
      const connection = await getSupplierInvoiceFileConnection(fileId);
      return detailResponse(connection, supplierInvoiceAttachmentColumns, connection, includeRaw);
    },
  );

  server.tool(
    'fortnox_create_supplier_invoice_file_connection',
    'Koppla en befintlig inkorgsfil till en leverantörsfaktura i Fortnox',
    {
      givenNumber: z.string().describe('Leverantörsfakturanummer'),
      fileId: z.string().describe('Fil-ID från Fortnox inkorg'),
      confirm: z.boolean().optional().describe('Bekräfta kopplingen'),
      dryRun: z.boolean().optional().describe('Visa exakt payload utan att koppla'),
      includeRaw: z.boolean().optional().describe('Inkludera rå JSON från Fortnox'),
    },
    async ({ givenNumber, fileId, confirm, dryRun, includeRaw }) => {
      const payload = { SupplierInvoiceNumber: givenNumber, FileId: fileId };
      const target = `connect file ${fileId} to supplier invoice ${givenNumber}`;
      if (dryRun) return dryRunResponse(target, { SupplierInvoiceFileConnection: payload });
      if (!confirm) requireConfirmation(target);
      const connection = await createSupplierInvoiceFileConnection(givenNumber, fileId);
      return detailResponse(connection, supplierInvoiceAttachmentColumns, connection, includeRaw);
    },
  );

  server.tool(
    'fortnox_delete_supplier_invoice_file_connection',
    'Koppla loss en fil från en leverantörsfaktura i Fortnox',
    {
      fileId: z.string().describe('Fil-ID'),
      confirm: z.boolean().optional().describe('Bekräfta bortkopplingen'),
      dryRun: z.boolean().optional().describe('Visa åtgärden utan att koppla loss'),
    },
    async ({ fileId, confirm, dryRun }) => {
      const target = `delete supplier invoice file connection ${fileId}`;
      if (dryRun) return dryRunResponse(target);
      if (!confirm) requireConfirmation(target);
      await deleteSupplierInvoiceFileConnection(fileId);
      return textResponse(`Supplier invoice file connection ${fileId} deleted.`);
    },
  );
}
