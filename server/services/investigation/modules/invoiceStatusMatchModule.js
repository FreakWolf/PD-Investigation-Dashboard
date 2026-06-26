/**
 * Module 1: Invoice Status and REBNI Matching Investigation
 */
export const invoiceStatusMatchModule = {
  name: 'Invoice Status & REBNI Matching Investigation',

  run(context) {
    const { asin, invoiceNumber, warehouseId, invoiceRecordsForAsin, rebniRecords } = context;
    const logs = [];

    // Step 3: Extract basic info from Invoice records
    const invoicePo = (invoiceRecordsForAsin[0].purchase_order_id || invoiceRecordsForAsin[0].matched_po || '').trim();
    const billedQty = Math.max(...invoiceRecordsForAsin.map(r => parseInt(r.quantity_invoiced, 10) || 0), 0);

    // Step 4: Check invoice_item_status
    logs.push('✔ Status checked');

    const allProcessed = invoiceRecordsForAsin.every(r => {
      const status = (r.invoice_item_status || '').trim().toUpperCase();
      return status === 'INTERFACED' || status === 'AUTHORIZED' || status === 'MATCHED';
    });

    if (allProcessed) {
      logs.push('✔ Resolved - Fully Processed status found');
      
      const blub = `Hii Team,

For the claiming ASIN: ${asin} we see that all the units are in Interfaced/Authorized/Matched state.

Kindly exclude those units and provide the updated PQV.

Regards.`;

      return {
        result: 'Resolved - Fully Processed',
        status: 'Resolved - Fully Processed',
        findings: { billedQty, receivedQty: billedQty, missingQty: 0 },
        generatedBlub: blub,
        logs
      };
    }

    // Step 5: Check if ANY contains ON_HOLD
    const hasOnHold = invoiceRecordsForAsin.some(r => {
      const status = (r.invoice_item_status || '').trim().toUpperCase();
      return status === 'ON_HOLD';
    });

    if (hasOnHold) {
      logs.push('✔ ON_HOLD found');
    }

    // REBNI Investigation Filtering
    // 1. Filter by ASIN
    let rebniFiltered = rebniRecords.filter(r => (r.asin || '').trim().toUpperCase() === asin.toUpperCase());

    // 2. Filter by Warehouse ID (entered by user)
    if (warehouseId) {
      rebniFiltered = rebniFiltered.filter(r => (r.warehouse_id || '').trim().toUpperCase() === warehouseId.toUpperCase());
    }

    // 3. Filter by PO
    if (invoicePo) {
      rebniFiltered = rebniFiltered.filter(r => (r.po || '').trim().toUpperCase() === invoicePo.toUpperCase());
    }

    logs.push('✔ REBNI filtered');

    // Handle empty REBNI matches
    if (rebniFiltered.length === 0) {
      return {
        result: 'Paused',
        status: 'No REBNI Record Found',
        findings: { billedQty, receivedQty: 0, missingQty: billedQty },
        generatedBlub: `Investigation paused. No REBNI records found matching ASIN '${asin}', Warehouse '${warehouseId || 'N/A'}', and PO '${invoicePo || 'N/A'}'.`,
        logs: [...logs, '❌ REBNI matches empty']
      };
    }

    const rebniRecord = rebniFiltered[0];
    const cntInvoiceMatched = parseInt(rebniRecord.cnt_invoice_matched, 10);

    // Invoice Matching Checks
    if (cntInvoiceMatched === 1) {
      logs.push('✔ Invoice match verified');
      
      const matchedInvoiceStr = (rebniRecord.matched_invoice_numbers || '').trim();
      
      if (matchedInvoiceStr.toUpperCase() === invoiceNumber.toUpperCase()) {
        const receivedQty = parseInt(rebniRecord.quantity_matched, 10) || 0;
        
        logs.push('✔ Quantity comparison completed');

        if (billedQty === receivedQty) {
          const internalNote = `Units received successfully. No missing units. No customer communication required.`;
          return {
            result: 'Completed',
            status: 'Completed',
            findings: { billedQty, receivedQty, missingQty: 0 },
            generatedBlub: internalNote,
            logs
          };
        } else {
          const missingQty = billedQty - receivedQty;
          const cp = parseFloat(rebniRecord.item_cost) || 0;
          
          logs.push('✔ Blub generated');

          const blub = `Hello Team,

Kindly find the below mentioned ASIN missing from PO# : ${invoicePo}

ASIN | Missing Qty | CP
${asin} | ${missingQty} | ${cp}

For ASIN: ${asin}
Billed: ${billedQty}
Received: ${receivedQty}

Kindly investigate the following Invoice and ASIN for missing units.
Invoice: ${invoiceNumber}
ASIN: ${asin}

Please check and help locate the missing units against the above Invoice.`;

          return {
            result: 'Discrepancy Found',
            status: 'Discrepancy Found',
            findings: { billedQty, receivedQty, missingQty, cp },
            generatedBlub: blub,
            logs
          };
        }
      } else {
        // Matched invoice in REBNI is different from target
        return {
          result: 'Paused',
          status: 'Invoice Number Mismatch',
          findings: { billedQty, receivedQty: 0, missingQty: billedQty, matchedInvoices: [matchedInvoiceStr] },
          generatedBlub: `Investigation paused. REBNI record is matched against invoice '${matchedInvoiceStr}' instead of target invoice '${invoiceNumber}'.`,
          logs: [...logs, `❌ REBNI matched invoice (${matchedInvoiceStr}) does not match target (${invoiceNumber})`]
        };
      }
    } else if (cntInvoiceMatched > 1) {
      logs.push('✔ Invoice match verified');
      const matchedInvoicesStr = rebniRecord.matched_invoice_numbers || '';
      const matchedList = matchedInvoicesStr.split(',').map(s => s.trim()).filter(Boolean);

      const blub = `This ASIN is matched against multiple invoices.
Matched Invoice List: ${matchedList.join(', ')}`;

      return {
        result: 'Paused',
        status: 'Multiple Invoices Match',
        findings: { billedQty, receivedQty: 0, missingQty: billedQty, matchedInvoices: matchedList },
        generatedBlub: blub,
        logs: [...logs, '⚠️ Multiple invoice matches detected']
      };
    } else {
      // cnt_invoice_matched is 0 or invalid
      return {
        result: 'Paused',
        status: 'Unmatched in REBNI',
        findings: { billedQty, receivedQty: 0, missingQty: billedQty },
        generatedBlub: `Investigation paused. REBNI record shows cnt_invoice_matched = ${cntInvoiceMatched || 0}.`,
        logs: [...logs, '❌ REBNI matched count is 0 or invalid']
      };
    }
  }
};
