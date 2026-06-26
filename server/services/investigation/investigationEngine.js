/**
 * Core Investigation Engine.
 * Coordinates execution of registered investigation modules against filtered Invoice and REBNI datasets.
 */
class InvestigationEngine {
  constructor() {
    this.modules = [];
  }

  /**
   * Register an investigation module
   */
  registerModule(module) {
    if (typeof module.run !== 'function') {
      throw new Error(`Module ${module.name || 'unnamed'} must implement a run function.`);
    }
    this.modules.push(module);
    console.log(`Registered investigation module: ${module.name}`);
  }

  /**
   * Run the investigation workflow for a specific invoice number and warehouse ID
   */
  run(invoiceRecords, rebniRecords, invoiceNumber, warehouseId) {
    if (!invoiceNumber) {
      throw new Error('Invoice Number is required for investigation.');
    }

    // Step 1: Filter Invoice data using Invoice Number
    const invoiceFiltered = invoiceRecords.filter(
      r => r.invoice_number && r.invoice_number.trim() === invoiceNumber.trim()
    );

    const initialTimeline = [];
    initialTimeline.push(`✔ Invoice filtered`);

    if (invoiceFiltered.length === 0) {
      return {
        success: false,
        error: `No invoice records found matching Invoice Number: ${invoiceNumber}`,
        asinResults: []
      };
    }

    // Step 2: Group by ASIN
    const asinGroups = {};
    for (const record of invoiceFiltered) {
      const asin = (record.asin || '').trim();
      if (!asin) continue;
      if (!asinGroups[asin]) {
        asinGroups[asin] = [];
      }
      asinGroups[asin].push(record);
    }

    const asinResults = [];

    // Investigate one ASIN at a time
    for (const [asin, records] of Object.entries(asinGroups)) {
      const asinTimeline = [...initialTimeline];
      asinTimeline.push(`✔ ASIN selected`);

      // Prepare context for the ASIN
      const context = {
        asin,
        invoiceNumber,
        warehouseId: warehouseId ? warehouseId.trim() : '',
        invoiceRecordsForAsin: records,
        rebniRecords,
        timeline: asinTimeline,
        result: null,
        findings: null,
        status: null,
        generatedBlub: null
      };

      // Run each registered module sequentially
      for (const module of this.modules) {
        try {
          const outcome = module.run(context);
          if (outcome) {
            context.result = outcome.result;
            context.findings = outcome.findings;
            context.status = outcome.status;
            context.generatedBlub = outcome.generatedBlub;
            if (outcome.logs && outcome.logs.length > 0) {
              context.timeline.push(...outcome.logs);
            }
          }

          // If the ASIN investigation is fully resolved, complete, or paused, stop running subsequent modules
          if (
            context.result === 'Resolved - Fully Processed' ||
            context.result === 'Completed' ||
            context.result === 'Paused'
          ) {
            break;
          }
        } catch (error) {
          console.error(`Error running module ${module.name} on ASIN ${asin}:`, error);
          context.timeline.push(`❌ Error in module ${module.name}: ${error.message}`);
          context.result = 'Error';
          context.status = 'Failed';
        }
      }

      // Gather metrics
      const firstRecord = records[0];
      const po = firstRecord.purchase_order_id || firstRecord.matched_po || 'N/A';
      
      // Calculate Billed Qty: highest quantity_invoiced
      const billedQty = Math.max(...records.map(r => parseInt(r.quantity_invoiced, 10) || 0), 0);

      asinResults.push({
        invoiceNumber,
        asin,
        po,
        warehouse: context.warehouseId || 'N/A',
        invoiceStatus: records.map(r => r.invoice_item_status).filter(Boolean).join(', ') || 'N/A',
        billedQty,
        receivedQty: context.findings?.receivedQty !== undefined ? context.findings.receivedQty : 'N/A',
        missingQty: context.findings?.missingQty !== undefined ? context.findings.missingQty : 'N/A',
        currentInvestigationStage: context.status || 'Finished',
        result: context.result || 'Incomplete',
        generatedBlub: context.generatedBlub || 'N/A',
        timeline: context.timeline,
        matchedInvoices: context.findings?.matchedInvoices || []
      });
    }

    return {
      success: true,
      asinResults
    };
  }
}

import { invoiceStatusMatchModule } from './modules/invoiceStatusMatchModule.js';

export const investigationEngine = new InvestigationEngine();
investigationEngine.registerModule(invoiceStatusMatchModule);
