/**
 * Shipment-based reconciliation loop engine to resolve loop matches across invoices.
 * Traces ALL matched invoices until it finds a discrepancy or exhausts all paths.
 */
export function runReconciliationLoop(startInvoice, startAsin, startPo, startWarehouse, originalMissingQty, activeInvestigation) {
  const visited = new Set();
  const loopDetails = [];
  const culpritInvoices = [];
  let accumulatedMissing = 0;

  // Queue: each entry has { invoice, asin, po, linkQty } where linkQty = units that linked us here
  const queue = [{ invoice: startInvoice, asin: startAsin, po: startPo, linkQty: 0 }];
  let currentInvoiceDate = null;

  while (queue.length > 0) {
    const current = queue.shift();
    const currentInvoice = current.invoice;
    const currentAsin = current.asin;
    const currentPo = current.po;
    const linkQty = current.linkQty;

    // Skip any invoice ending with one or more SCR suffixes
    if (/(SCR)+$/i.test(currentInvoice.trim())) continue;

    const stateKey = `${currentInvoice.trim().toLowerCase()}|${currentPo.trim().toLowerCase()}|${currentAsin.trim().toLowerCase()}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);

    // Find invoices matching currentInvoice and currentAsin (prefix match to include SCR variants)
    const matchingInvoices = activeInvestigation.invoiceRecords.filter(r => {
      const dbInv = (r.invoice_number || '').trim().toLowerCase();
      const queryInv = currentInvoice.trim().toLowerCase();
      return (dbInv === queryInv || dbInv.startsWith(queryInv)) && (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase();
    });

    if (matchingInvoices.length > 0) {
      currentInvoiceDate = matchingInvoices.map(r => r.invoice_date).filter(Boolean)[0] || currentInvoiceDate;
    }

    // Check for REBNI available inventory
    let startDateStart = null;
    let endDateStart = null;
    if (currentInvoiceDate) {
      const startLimit = new Date(currentInvoiceDate);
      if (!isNaN(startLimit.getTime())) {
        startDateStart = new Date(startLimit.getFullYear(), startLimit.getMonth(), startLimit.getDate());
        endDateStart = new Date(startDateStart);
        endDateStart.setDate(startDateStart.getDate() + 30);
      }
    }

    const availableRebniRecords = activeInvestigation.rebniRecords.filter(r => {
      const availQty = parseInt(r.rebni_available, 10) || 0;
      if (availQty <= 0) return false;
      const asinMatch = (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase();
      if (!asinMatch) return false;
      const whMatch = startWarehouse ? (r.warehouse_id || '').trim().toUpperCase() === startWarehouse.toUpperCase() : true;
      if (!whMatch) return false;
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
      return {
        type: 'REBNI_AVAILABLE',
        availableRebniRecords,
        loopDetails,
        finalInvoice: currentInvoice,
        finalAsin: currentAsin,
        finalPo: currentPo
      };
    }

    // Look up ALL REBNI records for this PO + ASIN
    const matchedRebnis = activeInvestigation.rebniRecords.filter(r =>
      (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase() &&
      (r.po || '').trim().toUpperCase() === currentPo.toUpperCase()
    );

    // Billed = max quantity_invoiced from the base invoice rows (exclude SCR)
    const baseInvoiceRows = matchingInvoices.filter(r => !(r.invoice_number || '').trim().toUpperCase().endsWith('SCR'));
    const billed = Math.max(0, ...baseInvoiceRows.map(r => parseInt(r.quantity_invoiced) || 0));

    // Received = total quantity_matched across ALL REBNI records for this PO+ASIN
    const received = matchedRebnis.reduce((sum, r) => sum + (parseInt(r.quantity_matched) || 0), 0);

    // Find the specific REBNI record that matches this invoice
    const targetInvStr = currentInvoice.trim().toLowerCase();
    const rebniRecord = matchedRebnis.find(r => {
      const invs = (r.matched_invoice_numbers || '').trim().toLowerCase().split(/[\s,;]+/);
      return invs.some(inv => inv === targetInvStr);
    }) || matchedRebnis[0] || null;

    const isStartInvoice = currentInvoice.trim().toLowerCase() === startInvoice.trim().toLowerCase();

    // Record this hop in loop details (skip starting invoice)
    if (!isStartInvoice) {
      const matchedInvsList = rebniRecord
        ? (rebniRecord.matched_invoice_numbers || '').trim().split(/[\s,;]+/).filter(Boolean).join(', ')
        : '';

      loopDetails.push({
        checkingInvoice: currentInvoice,
        matchedQty: linkQty,
        po: currentPo,
        asin: currentAsin,
        billed,
        received,
        matchedInvoicesList: matchedInvsList
      });
    }

    // Check for discrepancy at this hop (skip the starting invoice)
    if (!isStartInvoice && billed > received) {
      const hopMissing = billed - received;
      accumulatedMissing += hopMissing;

      culpritInvoices.push({
        invoice: currentInvoice,
        asin: currentAsin,
        po: currentPo,
        missing: hopMissing,
        rebniRecord
      });

      if (accumulatedMissing >= originalMissingQty) {
        return {
          type: 'DISCREPANCY',
          loopDetails,
          culpritInvoices,
          accumulatedMissing
        };
      }
    }

    // Find next legs to explore
    if (!rebniRecord) continue;

    // Follow matched_invoice_numbers from REBNI record
    const allMatchedInvs = (rebniRecord.matched_invoice_numbers || '').trim().split(/[\s,;]+/).filter(Boolean);
    for (const inv of allMatchedInvs) {
      const invTrimmed = inv.trim();
      if (!invTrimmed) continue;

      // Get base invoice (strip ALL trailing SCR suffixes for tracing)
      const baseInv = /SCR/i.test(invTrimmed) ? invTrimmed.replace(/(SCR)+$/i, '') : invTrimmed;

      // Skip if it's the current invoice itself
      const currentLower = currentInvoice.trim().toLowerCase();
      const baseLower = baseInv.toLowerCase();
      if (baseLower === currentLower) continue;
      if (baseLower.startsWith(currentLower) || currentLower.startsWith(baseLower)) continue;

      // Determine the link quantity from the TARGET invoice's shipmentwise_matched_qty
      // at the position matching the source PO (currentPo)
      const matchedInvRecords = activeInvestigation.invoiceRecords.filter(r => {
        const dbInv = (r.invoice_number || '').trim().toLowerCase();
        return dbInv === baseLower && (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase();
      });

      if (matchedInvRecords.length > 0) {
        const nextPo = (matchedInvRecords[0].purchase_order_id || matchedInvRecords[0].matched_po || '').trim();

        // Extract linkQty from shipmentwise_matched_qty at position matching source PO
        let nextLinkQty = 0;
        for (const row of matchedInvRecords) {
          const matchedPos = (row.matched_po || '').trim().split(/[\s,;]+/);
          const shipQtys = (row.shipmentwise_matched_qty || '').trim().split(/[\s,;]+/);
          for (let i = 0; i < matchedPos.length; i++) {
            if (matchedPos[i].trim().toUpperCase() === currentPo.toUpperCase()) {
              nextLinkQty = parseInt(shipQtys[i]) || 0;
              break;
            }
          }
          if (nextLinkQty > 0) break;
        }
        // Fallback: use SCR quantity_invoiced
        if (nextLinkQty === 0 && /SCR$/i.test(invTrimmed)) {
          const scrRow = activeInvestigation.invoiceRecords.find(r =>
            (r.invoice_number || '').trim().toLowerCase() === invTrimmed.toLowerCase() &&
            (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase()
          );
          if (scrRow) nextLinkQty = parseInt(scrRow.quantity_invoiced) || 0;
        }
        // Fallback: use REBNI quantity_matched
        if (nextLinkQty === 0) nextLinkQty = parseInt(rebniRecord.quantity_matched) || 0;

        queue.push({ invoice: baseInv, asin: currentAsin, po: nextPo || currentPo, linkQty: nextLinkQty });
      }
    }

    // Follow via shipment ID
    const shipmentId = rebniRecord.shipment_id;
    if (shipmentId) {
      const shipmentInvoices = activeInvestigation.invoiceRecords.filter(r => {
        if (/SCR$/i.test((r.invoice_number || '').trim())) return false;
        const shipMatch = (r.shipment_id || '').trim().toUpperCase().split(/[\s,;]+/).includes(shipmentId.trim().toUpperCase());
        const matchedAsinMatch = (r.matched_asin || '').trim().toUpperCase().split(/[\s,;]+/).includes(currentAsin.toUpperCase());
        return shipMatch && matchedAsinMatch;
      });

      for (const row of shipmentInvoices) {
        const invNum = (row.invoice_number || '').trim();
        const pId = (row.purchase_order_id || row.matched_po || '').trim();
        const asCode = (row.asin || '').trim();
        if (!invNum || !pId || !asCode) continue;
        const shipLinkQty = parseInt(row.shipmentwise_matched_qty) || parseInt(rebniRecord.quantity_matched) || 0;
        queue.push({ invoice: invNum, asin: asCode, po: pId, linkQty: shipLinkQty });
      }
    }
  }

  if (culpritInvoices.length > 0) {
    return {
      type: 'DISCREPANCY',
      loopDetails,
      culpritInvoices,
      accumulatedMissing
    };
  }

  // No discrepancy found at any hop — units are missing from the original invoice
  return {
    type: 'NO_DISCREPANCY_IN_LOOP',
    loopDetails,
    finalInvoice: startInvoice,
    finalAsin: startAsin,
    finalPo: startPo
  };
}
