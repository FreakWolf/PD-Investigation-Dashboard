/**
 * shipment-based reconciliation loop engine to resolve loop matches across invoices.
 */
export function runReconciliationLoop(startInvoice, startAsin, startPo, startWarehouse, activeInvestigation) {
  let currentInvoice = startInvoice;
  let currentAsin = startAsin;
  let currentPo = startPo;
  const visited = new Set();
  const loopDetails = [];
  
  let currentInvoiceDate = null;

  while (true) {
    const stateKey = `${currentInvoice.trim().toLowerCase()}|${currentPo.trim().toLowerCase()}|${currentAsin.trim().toLowerCase()}`;
    if (visited.has(stateKey)) {
      break; // prevent infinite loop
    }
    visited.add(stateKey);

    // Find invoices matching currentInvoice and currentAsin
    const matchingInvoices = activeInvestigation.invoiceRecords.filter(r => {
      const dbInv = (r.invoice_number || '').trim().toLowerCase();
      const queryInv = currentInvoice.trim().toLowerCase();
      return (dbInv === queryInv || dbInv.startsWith(queryInv) || queryInv.startsWith(dbInv)) && (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase();
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
      // 1. Fast short-circuiting checks first
      const availQty = parseInt(r.rebni_available, 10) || 0;
      if (availQty <= 0) return false;

      const asinMatch = (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase();
      if (!asinMatch) return false;

      const whMatch = startWarehouse ? (r.warehouse_id || '').trim().toUpperCase() === startWarehouse.toUpperCase() : true;
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
      return {
        type: 'REBNI_AVAILABLE',
        availableRebniRecords,
        loopDetails,
        finalInvoice: currentInvoice,
        finalAsin: currentAsin,
        finalPo: currentPo
      };
    }

    // Look up matching REBNI records
    const matchedRebnis = activeInvestigation.rebniRecords.filter(r => 
      (r.asin || '').trim().toUpperCase() === currentAsin.toUpperCase() &&
      (startWarehouse ? (r.warehouse_id || '').trim().toLowerCase() === startWarehouse.toLowerCase() : true) &&
      (r.po || '').trim().toUpperCase() === currentPo.toUpperCase()
    );

    const billed = Math.max(0, ...matchingInvoices.map(r => parseInt(r.quantity_invoiced) || 0));
    
    let received = 0;
    let rebniRecord = null;
    if (matchedRebnis.length > 0) {
      rebniRecord = matchedRebnis[0];
      const targetInvStr = currentInvoice.trim().toLowerCase();
      
      matchedRebnis.forEach(r => {
        const invs = (r.matched_invoice_numbers || '').trim().toLowerCase().split(/[\s,;]+/);
        const isMatched = invs.some(inv => inv === targetInvStr || inv.startsWith(targetInvStr) || targetInvStr.startsWith(inv)) ||
          (r.matched_invoice_numbers || '').trim().toLowerCase() === targetInvStr ||
          (r.matched_invoice_numbers || '').trim().toLowerCase().startsWith(targetInvStr) ||
          targetInvStr.startsWith((r.matched_invoice_numbers || '').trim().toLowerCase());
        if (isMatched) {
          received += parseInt(r.quantity_matched) || 0;
        }
      });
    }

    if (currentInvoice.trim().toLowerCase() !== startInvoice.trim().toLowerCase() && billed !== received) {
      return {
        type: 'DISCREPANCY',
        billed,
        received,
        loopDetails,
        finalInvoice: currentInvoice,
        finalAsin: currentAsin,
        finalPo: currentPo,
        rebniRecord
      };
    }

    // If billed === received, we transition to the next leg
    if (!rebniRecord) {
      break; 
    }

    const shipmentId = rebniRecord.shipment_id;
    if (!shipmentId) {
      break; 
    }

    // Filter invoice records: match if shipmentId or matched_asin is in comma-separated lists
    const shipmentInvoices = activeInvestigation.invoiceRecords.filter(r => {
      const shipMatch = (r.shipment_id || '').trim().toUpperCase().split(/[\s,;]+/).includes(shipmentId.trim().toUpperCase());
      const matchedAsinMatch = (r.matched_asin || '').trim().toUpperCase().split(/[\s,;]+/).includes(currentAsin.toUpperCase());
      return shipMatch && matchedAsinMatch;
    });

    // Deduplicate legs
    const uniqueLegsMap = new Map();
    shipmentInvoices.forEach(row => {
      const invNum = (row.invoice_number || '').trim().replace(/[a-zA-Z]+$/, '');
      const pId = (row.purchase_order_id || row.matched_po || '').trim();
      const asCode = (row.asin || '').trim();
      if (!invNum || !pId || !asCode) return;
      const key = `${invNum.toLowerCase()}|${pId.toLowerCase()}|${asCode.toLowerCase()}`;
      if (!uniqueLegsMap.has(key)) {
        uniqueLegsMap.set(key, row);
      }
    });

    let nextLeg = null;
    for (const [key, row] of uniqueLegsMap.entries()) {
      const invNum = (row.invoice_number || '').trim().replace(/[a-zA-Z]+$/, '');
      const pId = (row.purchase_order_id || row.matched_po || '').trim();
      const asCode = (row.asin || '').trim();
      
      const legKey = `${invNum.toLowerCase()}|${pId.toLowerCase()}|${asCode.toLowerCase()}`;
      if (visited.has(legKey)) continue;

      nextLeg = {
        invoiceNumber: invNum,
        po: pId,
        asin: asCode,
        shipmentwiseMatchedQty: getShipmentwiseMatchedQty(row, currentPo, currentAsin)
      };
      break; 
    }

    if (!nextLeg) {
      break; 
    }

    // Calculate billed/received for the next leg
    const nextInvoices = activeInvestigation.invoiceRecords.filter(r => {
      const dbInv = (r.invoice_number || '').trim().toLowerCase();
      const queryInv = nextLeg.invoiceNumber.toLowerCase();
      return (dbInv === queryInv || dbInv.startsWith(queryInv) || queryInv.startsWith(dbInv)) && (r.asin || '').trim().toUpperCase() === nextLeg.asin.toUpperCase();
    });
    const nextBilled = Math.max(0, ...nextInvoices.map(r => parseInt(r.quantity_invoiced) || 0));

    const nextMatchedRebnis = activeInvestigation.rebniRecords.filter(r => 
      (r.asin || '').trim().toUpperCase() === nextLeg.asin.toUpperCase() &&
      (startWarehouse ? (r.warehouse_id || '').trim().toLowerCase() === startWarehouse.toLowerCase() : true) &&
      (r.po || '').trim().toUpperCase() === nextLeg.po.toUpperCase()
    );

    let nextReceived = 0;
    if (nextMatchedRebnis.length > 0) {
      const nextTargetInvStr = nextLeg.invoiceNumber.toLowerCase();
      nextMatchedRebnis.forEach(r => {
        const invs = (r.matched_invoice_numbers || '').trim().toLowerCase().split(/[\s,;]+/);
        const isMatched = invs.some(inv => inv === nextTargetInvStr || inv.startsWith(nextTargetInvStr) || nextTargetInvStr.startsWith(inv)) ||
          (r.matched_invoice_numbers || '').trim().toLowerCase() === nextTargetInvStr ||
          (r.matched_invoice_numbers || '').trim().toLowerCase().startsWith(nextTargetInvStr) ||
          nextTargetInvStr.startsWith((r.matched_invoice_numbers || '').trim().toLowerCase());
        if (isMatched) {
          nextReceived += parseInt(r.quantity_matched) || 0;
        }
      });
    }

    const cleanInvoicesList = (listStr) => {
      if (!listStr) return '';
      return listStr.split(/[\s,;]+/)
        .map(inv => inv.trim().replace(/[a-zA-Z]+$/, ''))
        .filter(Boolean)
        .join(', ');
    };
    const nextMatchedInvsList = nextMatchedRebnis.length > 0 ? cleanInvoicesList(nextMatchedRebnis[0].matched_invoice_numbers) : '';

    loopDetails.push({
      checkingInvoice: nextLeg.invoiceNumber,
      matchedQty: nextLeg.shipmentwiseMatchedQty,
      po: nextLeg.po,
      asin: nextLeg.asin,
      billed: nextBilled,
      received: nextReceived,
      matchedInvoicesList: nextMatchedInvsList
    });

    currentInvoice = nextLeg.invoiceNumber;
    currentPo = nextLeg.po;
    currentAsin = nextLeg.asin;
  }

  return {
    type: 'PAUSED',
    loopDetails
  };
}

/**
 * Extracts the matched quantity corresponding to target PO and ASIN inside comma-separated lists.
 */
function getShipmentwiseMatchedQty(row, targetPo, targetAsin) {
  const pos = (row.matched_po || '').trim().split(/[\s,;]+/);
  const asins = (row.matched_asin || '').trim().split(/[\s,;]+/);
  const qtys = (row.shipmentwise_matched_qty || '').trim().split(/[\s,;]+/);
  
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] && asins[i] && qtys[i] && 
        pos[i].trim().toUpperCase() === targetPo.trim().toUpperCase() && 
        asins[i].trim().toUpperCase() === targetAsin.trim().toUpperCase()) {
      return parseInt(qtys[i], 10) || 0;
    }
  }
  return parseInt(row.shipmentwise_matched_qty, 10) || 0;
}
