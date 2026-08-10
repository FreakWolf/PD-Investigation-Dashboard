import { runReconciliationLoop } from '../reconciliationLoop.js';

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

    let globalReceivedQty = Math.max(0, ...invoiceRecordsForAsin.map(r => parseInt(r.quantity_matched, 10) || 0));

    // Step 5: Check if ANY contains ON_HOLD
    const hasOnHold = invoiceRecordsForAsin.some(r => {
      const status = (r.invoice_item_status || '').trim().toUpperCase();
      return status === 'ON_HOLD';
    });
    if (hasOnHold) {
      logs.push('✔ ON_HOLD found. Checking for available REBNI inventory first.');
      // For ON_HOLD, billed = quantity_invoiced, received = quantity_matched (partial matches already done)
      // missing = ON_HOLD row's quantity_invoiced
      const onHoldRecords = invoiceRecordsForAsin.filter(r => (r.invoice_item_status || '').trim().toUpperCase() === 'ON_HOLD');
      const onHoldQty = Math.max(0, ...onHoldRecords.map(r => parseInt(r.quantity_invoiced, 10) || 0));
      const cp = parseFloat(rebniRecords.find(r => (r.asin || '').trim().toUpperCase() === asin.toUpperCase())?.item_cost || 0);
      // Override billedQty to be accurate from the overall invoice
      const effectiveBilledQty = billedQty;
      const effectiveReceivedQty = globalReceivedQty;
      logs.push(`🔹 ON_HOLD details: Billed=${effectiveBilledQty}, Matched=${effectiveReceivedQty}, Missing=${onHoldQty}`);

      // Derive effective warehouse — use user input if provided, else derive from rebniRecords matched to this PO/ASIN
      const invoicePo2 = (invoiceRecordsForAsin[0]?.purchase_order_id || '').trim();
      const effectiveWarehouse = warehouseId
        ? warehouseId.trim().toUpperCase()
        : (rebniRecords.find(r =>
            (r.asin || '').trim().toUpperCase() === asin.toUpperCase() &&
            (!invoicePo2 || (r.po || '').trim().toUpperCase() === invoicePo2.toUpperCase()) &&
            (r.warehouse_id || '').trim()
          )?.warehouse_id || '').trim().toUpperCase();
      if (effectiveWarehouse) {
        logs.push(`🔹 Warehouse filter applied: ${effectiveWarehouse}`);
      }

      // Check for REBNI available inventory
      let startDateStart = null;
      let endDateStart = null;
      const invDate = invoiceRecordsForAsin.map(r => r.invoice_date).filter(Boolean)[0];
      if (invDate) {
        const startLimit = new Date(invDate);
        if (!isNaN(startLimit.getTime())) {
          startDateStart = new Date(startLimit.getFullYear(), startLimit.getMonth(), startLimit.getDate());
          endDateStart = new Date(startDateStart);
          endDateStart.setDate(startDateStart.getDate() + 30);
        }
      }

      const availableRebniRecords = effectiveWarehouse ? rebniRecords.filter(r => {
        const availQty = parseInt(r.rebni_available, 10) || 0;
        if (availQty <= 0) return false;

        const asinMatch = (r.asin || '').trim().toUpperCase() === asin.toUpperCase();
        if (!asinMatch) return false;

        // Warehouse is mandatory — REBNI from any PO is fine as long as same warehouse
        const whMatch = (r.warehouse_id || '').trim().toUpperCase() === effectiveWarehouse;
        if (!whMatch) return false;

        if (startDateStart && endDateStart && r.received_datetime) {
          const rDate = new Date(r.received_datetime);
          if (!isNaN(rDate.getTime())) {
            const rDateStart = new Date(rDate.getFullYear(), rDate.getMonth(), rDate.getDate());
            return rDateStart >= startDateStart && rDateStart <= endDateStart;
          }
        }
        return true;
      }) : [];

      if (availableRebniRecords.length > 0) {
        const totalRebniAvail = availableRebniRecords.reduce((sum, r) => sum + (parseInt(r.rebni_available, 10) || 0), 0);
        logs.push(`✔ REBNI Available Inventory checked: Found ${availableRebniRecords.length} records. Total available: ${totalRebniAvail}`);

        const detailsLines = availableRebniRecords.map(r => {
          const rPo = (r.po || '').trim();
          const rAsin = (r.asin || '').trim();
          const rShip = (r.shipment_id || '').trim();
          const rCost = parseFloat(r.item_cost) || 0;
          const rAvail = parseInt(r.rebni_available, 10) || 0;
          return `${rPo} | ${rAsin} | ${rShip} | ${rCost.toFixed(2)} | ${rAvail}`;
        }).join('\n\n');

        const closingText = totalRebniAvail >= onHoldQty
          ? "Kindly utilize the available REBNI inventory and proceed with closing the PQV."
          : "Kindly utilize the available REBNI inventory and provide with the updated PQV.";

        const blurb = `Hi Team,

REBNI inventory is available for the below ASIN${availableRebniRecords.length > 1 ? 's' : ''}:

Details for reference:

${detailsLines}

${closingText}

Regards,`;

        return {
          result: 'REBNI Inventory Available',
          status: 'REBNI Inventory Available',
          findings: { billedQty: effectiveBilledQty, receivedQty: effectiveReceivedQty, missingQty: onHoldQty, cp, availableRebniRecords },
          generatedBlub: blurb,
          logs
        };
      }

      // Add loop check for ON_HOLD invoices if they are mapped to multiple invoices in REBNI
      const targetInvStrForHold = invoiceNumber.trim().toLowerCase();
      const matchedRebniForHold = rebniRecords.find(r => {
        const invs = (r.matched_invoice_numbers || '').trim().toLowerCase().split(/[\s,;]+/);
        return invs.some(inv => inv === targetInvStrForHold || inv.startsWith(targetInvStrForHold)) ||
          (r.matched_invoice_numbers || '').trim().toLowerCase() === targetInvStrForHold ||
          (r.matched_invoice_numbers || '').trim().toLowerCase().startsWith(targetInvStrForHold);
      });

      if (matchedRebniForHold && parseInt(matchedRebniForHold.cnt_invoice_matched, 10) > 1) {
        logs.push(`✔ ON_HOLD invoice has cnt_invoice_matched > 1 (${matchedRebniForHold.cnt_invoice_matched}). Running loop check.`);
        const loopResult = runReconciliationLoop(invoiceNumber, asin, invoicePo2, effectiveWarehouse, onHoldQty, { invoiceRecords: invoiceRecordsForAsin, rebniRecords });
        
        if (loopResult.type === 'DISCREPANCY') {
          const loopDetailsText = loopResult.loopDetails.map(detail => {
            return `Upon Checking Invoice: ${detail.checkingInvoice}\n` +
              `${detail.matchedQty} units matched to PO: ${detail.po} and ASIN: ${detail.asin}\n` +
              `Billed: ${detail.billed}, Received: ${detail.received}\n__`;
          }).join('\n\n');

          const finalCp = parseFloat(loopResult.rebniRecord ? loopResult.rebniRecord.item_cost : 0) || cp;

          const culpritText = loopResult.culpritInvoices.map(c => `Invoice: ${c.invoice}\nASIN: ${c.asin}`).join('\n\n');

          const blurb = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${invoicePo2}

        ASIN	   Missing QTY	CP
${asin}	              ${onHoldQty}	${finalCp.toFixed(2)}


For ASIN: ${asin}
Billed: ${effectiveBilledQty}, Received: ${effectiveReceivedQty}
Matched: ${matchedRebniForHold.matched_invoice_numbers}

${loopDetailsText}

Kindly investigate the following invoices and ASINs for missing units:

${culpritText}

Please check and help locate the missing units against the above invoices.`;

          return {
            result: 'Loop Discrepancy Found',
            status: 'Loop Discrepancy Found',
            findings: { billedQty: effectiveBilledQty, receivedQty: effectiveReceivedQty, missingQty: onHoldQty, cp: finalCp },
            generatedBlub: blurb,
            logs
          };
        }
      }

      const blub = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${invoicePo2}

        ASIN	   Missing QTY	CP
${asin}	                    ${onHoldQty}	${cp % 1 === 0 ? cp.toFixed(0) : cp.toFixed(2)}


For ASIN: ${asin}
Billed: ${effectiveBilledQty}, Received: ${effectiveReceivedQty}

Kindly investigate the following invoices and ASINs for missing units:

Invoice: ${invoiceNumber}
ASIN: ${asin}

Please check and help locate the missing units against the above invoices.`;

      return {
        result: 'Discrepancy (On Hold)',
        status: 'Discrepancy (On Hold)',
        findings: { billedQty: effectiveBilledQty, receivedQty: effectiveReceivedQty, missingQty: onHoldQty, cp },
        generatedBlub: blub,
        logs
      };
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

          // Check for REBNI available inventory
          let startDateStart = null;
          let endDateStart = null;
          const invDate = invoiceRecordsForAsin.map(r => r.invoice_date).filter(Boolean)[0];
          if (invDate) {
            const startLimit = new Date(invDate);
            if (!isNaN(startLimit.getTime())) {
              startDateStart = new Date(startLimit.getFullYear(), startLimit.getMonth(), startLimit.getDate());
              endDateStart = new Date(startDateStart);
              endDateStart.setDate(startDateStart.getDate() + 30);
            }
          }

          const availableRebniRecords = rebniRecords.filter(r => {
            // 1. Fast short-circuiting checks first
            const availQty = parseInt(r.rebni_available, 10) || 0;
            if (availQty <= 0) return false;

            const asinMatch = (r.asin || '').trim().toUpperCase() === asin.toUpperCase();
            if (!asinMatch) return false;

            const whMatch = warehouseId ? (r.warehouse_id || '').trim().toUpperCase() === warehouseId.toUpperCase() : true;
            if (!whMatch) return false;

            // 2. Slow date calculation only if other fields match
            if (startDateStart && endDateStart && r.received_datetime) {
              const rDate = new Date(r.received_datetime);
              if (!isNaN(rDate.getTime())) {
                const rDateStart = new Date(rDate.getFullYear(), rDate.getMonth(), rDate.getDate());
                return rDateStart >= startDateStart && rDateStart <= endDateStart;
              }
            }
            
            return true;
          });

          if (availableRebniRecords.length > 0) {
            const totalRebniAvail = availableRebniRecords.reduce((sum, r) => sum + (parseInt(r.rebni_available, 10) || 0), 0);
            logs.push(`✔ REBNI Available Inventory checked: Found ${availableRebniRecords.length} records. Total available: ${totalRebniAvail}`);
            
            const detailsLines = availableRebniRecords.map(r => {
              const rPo = (r.po || '').trim();
              const rAsin = (r.asin || '').trim();
              const rShip = (r.shipment_id || '').trim();
              const rCost = parseFloat(r.item_cost) || 0;
              const rAvail = parseInt(r.rebni_available, 10) || 0;
              return `${rPo} | ${rAsin} | ${rShip} | ${rCost.toFixed(2)} | ${rAvail}`;
            }).join('\n\n');

            const closingText = totalRebniAvail >= missingQty
              ? "Kindly utilize the available REBNI inventory and proceed with closing the PQV."
              : "Kindly utilize the available REBNI inventory and provide with the updated PQV.";

            const blub = `Hi Team,

REBNI inventory is available for the below ASIN${availableRebniRecords.length > 1 ? 's' : ''}:

Details for reference:

${detailsLines}

${closingText}

Regards,`;

            return {
              result: 'Discrepancy Found',
              status: 'REBNI Inventory Available',
              findings: { billedQty, receivedQty, missingQty, cp, availableRebniRecords },
              generatedBlub: blub,
              logs
            };
          }

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
        // Matched invoice in REBNI is different from target. Check loop scenario.
        const matchedQty = parseInt(rebniRecord.quantity_matched, 10) || 0;
        const isLoop = billedQty === matchedQty;

        if (isLoop) {
          const loopResult = runReconciliationLoop(invoiceNumber, asin, invoicePo, warehouseId, {
            invoiceRecords: context.allInvoiceRecords || [],
            rebniRecords
          });

          if (loopResult.type === 'REBNI_AVAILABLE') {
            const totalRebniAvail = loopResult.availableRebniRecords.reduce((sum, r) => sum + (parseInt(r.rebni_available, 10) || 0), 0);
            logs.push(`✔ REBNI Available Inventory checked (Loop): Found ${loopResult.availableRebniRecords.length} records. Total available: ${totalRebniAvail}`);
            
            const detailsLines = loopResult.availableRebniRecords.map(r => {
              const rPo = (r.po || '').trim();
              const rAsin = (r.asin || '').trim();
              const rShip = (r.shipment_id || '').trim();
              const rCost = parseFloat(r.item_cost) || 0;
              const rAvail = parseInt(r.rebni_available, 10) || 0;
              return `${rPo} | ${rAsin} | ${rShip} | ${rCost.toFixed(2)} | ${rAvail}`;
            }).join('\n\n');

            const finalMissingQty = Math.max(0, loopResult.billed - loopResult.received);
            const closingText = totalRebniAvail >= finalMissingQty
              ? "Kindly utilize the available REBNI inventory and proceed with closing the PQV."
              : "Kindly utilize the available REBNI inventory and provide with the updated PQV.";

            const blub = `Hi Team,

REBNI inventory is available for the below ASIN${loopResult.availableRebniRecords.length > 1 ? 's' : ''}:

Details for reference:

${detailsLines}

${closingText}

Regards,`;

            return {
              result: 'Discrepancy Found',
              status: 'REBNI Inventory Available',
              findings: { billedQty, receivedQty: 0, missingQty: finalMissingQty, cp: parseFloat(rebniRecord.item_cost) || 0, availableRebniRecords: loopResult.availableRebniRecords },
              generatedBlub: blub,
              logs
            };
          } else if (loopResult.type === 'DISCREPANCY') {
            const loopDetailsText = loopResult.loopDetails.map(detail => {
              let text = `Upon Checking Invoice: ${detail.checkingInvoice}\n` +
                `${detail.matchedQty} units matched to PO: ${detail.po} and ASIN: ${detail.asin}\n` +
                `Billed: ${detail.billed}, Received: ${detail.received}\n`;
              const cleanedChecking = (detail.checkingInvoice || '').trim().toLowerCase();
              const cleanedMatched = (detail.matchedInvoicesList || '').trim().toLowerCase().split(/[\s,;]+/).map(s => s.trim());
              const isOnlySelf = cleanedMatched.length === 1 && cleanedMatched[0] === cleanedChecking;
              if (detail.matchedInvoicesList && !isOnlySelf) {
                text += `Matched: ${detail.matchedInvoicesList}\n`;
              }
              text += `__`;
              return text;
            }).join('\n\n');

            const finalMissingQty = Math.max(0, loopResult.billed - loopResult.received);
            const finalCp = parseFloat(loopResult.rebniRecord ? loopResult.rebniRecord.item_cost : 0) || 0;

            const blub = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${invoicePo}

        ASIN	   Missing QTY	CP
${asin}	              ${finalMissingQty}	${finalCp.toFixed(2)}


For ASIN: ${asin}
Billed: ${billedQty}, Received: ${matchedQty}
Matched: ${rebniRecord.matched_invoice_numbers}

${loopDetailsText}

Kindly investigate the following invoices and ASINs for missing units:

Invoice: ${loopResult.finalInvoice}
ASIN: ${loopResult.finalAsin}

Please check and help locate the missing units against the above invoices.`;

            return {
              result: 'Discrepancy Found',
              status: 'Loop Discrepancy Found',
              findings: { 
                billedQty, 
                receivedQty: matchedQty, 
                missingQty: finalMissingQty, 
                cp: finalCp,
                loopResult
              },
              generatedBlub: blub,
              logs: [...logs, `✔ Loop reconciliation tracer completed. Final discrepancy on Invoice ${loopResult.finalInvoice}`]
            };
          }
        }

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

      // Check loop scenario for multiple matches
      const matchedQty = parseInt(rebniRecord.quantity_matched, 10) || 0;
      const isLoop = billedQty === matchedQty;

      if (isLoop) {
        const effectiveWhForLoop = warehouseId ? warehouseId.trim().toUpperCase() : (rebniRecord.warehouse_id || '').trim().toUpperCase();
        const loopResult = runReconciliationLoop(invoiceNumber, asin, invoicePo, effectiveWhForLoop, {
          invoiceRecords: context.allInvoiceRecords || [],
          rebniRecords
        });

        if (loopResult.type === 'REBNI_AVAILABLE') {
          const totalRebniAvail = loopResult.availableRebniRecords.reduce((sum, r) => sum + (parseInt(r.rebni_available, 10) || 0), 0);
          logs.push(`✔ REBNI Available Inventory checked (Loop): Found ${loopResult.availableRebniRecords.length} records. Total available: ${totalRebniAvail}`);
          
          const detailsLines = loopResult.availableRebniRecords.map(r => {
            const rPo = (r.po || '').trim();
            const rAsin = (r.asin || '').trim();
            const rShip = (r.shipment_id || '').trim();
            const rCost = parseFloat(r.item_cost) || 0;
            const rAvail = parseInt(r.rebni_available, 10) || 0;
            return `${rPo} | ${rAsin} | ${rShip} | ${rCost.toFixed(2)} | ${rAvail}`;
          }).join('\n\n');

          const finalMissingQty = Math.max(0, loopResult.billed - loopResult.received);
          const closingText = totalRebniAvail >= finalMissingQty
            ? "Kindly utilize the available REBNI inventory and proceed with closing the PQV."
            : "Kindly utilize the available REBNI inventory and provide with the updated PQV.";

          const blub = `Hi Team,

REBNI inventory is available for the below ASIN${loopResult.availableRebniRecords.length > 1 ? 's' : ''}:

Details for reference:

${detailsLines}

${closingText}

Regards,`;

          return {
            result: 'Discrepancy Found',
            status: 'REBNI Inventory Available',
            findings: { billedQty, receivedQty: 0, missingQty: finalMissingQty, cp: parseFloat(rebniRecord.item_cost) || 0, availableRebniRecords: loopResult.availableRebniRecords },
            generatedBlub: blub,
            logs
          };
        } else if (loopResult.type === 'DISCREPANCY') {
          const loopDetailsText = loopResult.loopDetails.map(detail => {
              let text = `Upon Checking Invoice: ${detail.checkingInvoice}\n` +
                `${detail.matchedQty} units matched to PO: ${detail.po} and ASIN: ${detail.asin}\n` +
                `Billed: ${detail.billed}, Received: ${detail.received}\n`;
              const cleanedChecking = (detail.checkingInvoice || '').trim().toLowerCase();
              const cleanedMatched = (detail.matchedInvoicesList || '').trim().toLowerCase().split(/[\s,;]+/).map(s => s.trim());
              const isOnlySelf = cleanedMatched.length === 1 && cleanedMatched[0] === cleanedChecking;
              if (detail.matchedInvoicesList && !isOnlySelf) {
                text += `Matched: ${detail.matchedInvoicesList}\n`;
              }
              text += `__`;
              return text;
            }).join('\n\n');

          const totalLoopBilled = billedQty + loopResult.loopDetails.reduce((sum, d) => sum + (parseInt(d.billed) || 0), 0);
          const maxLoopReceived = Math.max(parseInt(rebniRecord.quantity_matched) || 0, ...loopResult.loopDetails.map(d => parseInt(d.received) || 0));
          const finalMissingQty = Math.max(0, totalLoopBilled - maxLoopReceived);
          const finalCp = parseFloat(loopResult.rebniRecord ? loopResult.rebniRecord.item_cost : 0) || 0;

          const blub = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${invoicePo}

        ASIN	   Missing QTY	CP
${asin}	              ${finalMissingQty}	${finalCp.toFixed(2)}


For ASIN: ${asin}
Billed: ${billedQty}, Received: ${matchedQty}
Matched: ${rebniRecord.matched_invoice_numbers}

${loopDetailsText}

Kindly investigate the following invoices and ASINs for missing units:

Invoice: ${loopResult.finalInvoice}
ASIN: ${loopResult.finalAsin}

Please check and help locate the missing units against the above invoices.`;

          return {
            result: 'Discrepancy Found',
            status: 'Loop Discrepancy Found',
            findings: { 
              billedQty, 
              receivedQty: matchedQty, 
              missingQty: finalMissingQty, 
              cp: finalCp,
              loopResult
            },
            generatedBlub: blub,
            logs: [...logs, `✔ Loop reconciliation tracer completed. Final discrepancy on Invoice ${loopResult.finalInvoice}`]
          };
        }
      }

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
