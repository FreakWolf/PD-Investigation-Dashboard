/**
 * Worker Thread for batch summary processing.
 * Runs runRulesInternal for each invoice+ASIN group off the main thread.
 * Communicates via parentPort messages.
 */
import { parentPort, workerData } from 'worker_threads';
import { runReconciliationLoop } from './investigation/reconciliationLoop.js';

// Receive the investigation data passed from the main thread
const { invoiceRecords, rebniRecords } = workerData;

// --- Inline a minimal version of the rules logic needed for batch summary ---
// We can't import the full investigationService (it's a singleton with state),
// so we replicate the core logic here.

function buildRebniIndex(rebniRecords) {
  const rebniIndex = new Map();
  rebniRecords.forEach(r => {
    if (!r.asin || !r.po) return;
    const key = `${r.asin.trim()}|${r.po.trim()}`;
    if (!rebniIndex.has(key)) {
      rebniIndex.set(key, []);
    }
    rebniIndex.get(key).push(r);
  });
  return rebniIndex;
}

function buildGroups(invoiceRecords) {
  const groupsMap = new Map();
  invoiceRecords.forEach(r => {
    if (!r.invoice_number || !r.asin) return;
    const invNum = r.invoice_number.trim();
    const asin = r.asin.trim();

    let foundKey = null;
    for (const existingKey of groupsMap.keys()) {
      const [existingInv] = existingKey.split('|');
      if (invNum.toLowerCase().startsWith(existingInv.toLowerCase()) ||
          existingInv.toLowerCase().startsWith(invNum.toLowerCase())) {
        if (existingKey.endsWith(`|${asin}`)) {
          foundKey = existingKey;
          break;
        }
      }
    }

    if (foundKey) {
      groupsMap.get(foundKey).push(r);
    } else {
      const key = `${invNum}|${asin}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, []);
      }
      groupsMap.get(key).push(r);
    }
  });
  return Array.from(groupsMap.entries());
}

function runRulesForBatch(invoiceNumber, asin, warehouseId, po, matchedInvoices, matchedRebnis) {
  const matchedStatuses = ['INTERFACED', 'AUTHORISED', 'AUTHORIZED', 'MATCHED'];
  const isAllFullyMatched = matchedInvoices.every(r => {
    const status = (r.invoice_item_status || '').trim().toUpperCase();
    return matchedStatuses.includes(status);
  });

  const billed = Math.max(0, ...matchedInvoices.map(r => parseInt(r.quantity_invoiced) || 0));

  // Calculate received using deduplication by invoice number
  const uniqueInvMatches = new Map();
  matchedInvoices.forEach(r => {
    const invNum = (r.invoice_number || '').trim().toUpperCase();
    if (!uniqueInvMatches.has(invNum)) {
      uniqueInvMatches.set(invNum, parseInt(r.quantity_matched, 10) || 0);
    }
  });
  const received = Array.from(uniqueInvMatches.values()).reduce((sum, qty) => sum + qty, 0);

  if (isAllFullyMatched) {
    return { status: 'Interfaced/Matched', billed, received, missingQty: 0, cp: 0 };
  }

  // Check ON_HOLD
  const hasOnHold = matchedInvoices.some(r => (r.invoice_item_status || '').trim().toUpperCase() === 'ON_HOLD');
  if (hasOnHold) {
    const onHoldQty = Math.max(0, billed - received);
    const cpVal = parseFloat(matchedRebnis.find(r => (r.asin || '').trim().toUpperCase() === asin.toUpperCase())?.item_cost || 0);
    return { status: 'Discrepancy (On Hold)', billed, received, missingQty: onHoldQty, cp: cpVal };
  }

  // Check REBNI
  if (matchedRebnis.length === 0) {
    const globalRebni = rebniRecords.find(r => (r.asin || '').trim().toUpperCase() === asin.toUpperCase() && parseFloat(r.item_cost) > 0);
    const cpVal = globalRebni ? parseFloat(globalRebni.item_cost) : 0;
    return { status: 'No REBNI Data', billed, received: 0, missingQty: billed, cp: cpVal };
  }

  const rebni = matchedRebnis[0];
  const cntMatched = parseInt(rebni.cnt_invoice_matched) || 0;
  const cpVal = parseFloat(rebni.item_cost) || 0;

  if (cntMatched === 1) {
    const matchedInvsStr = (rebni.matched_invoice_numbers || '').trim().toLowerCase();
    const targetInvStr = invoiceNumber.trim().toLowerCase();
    const isInvoiceMatched = matchedInvsStr === targetInvStr ||
      matchedInvsStr.split(/[\s,;]+/).some(inv => inv === targetInvStr || inv.startsWith(targetInvStr));

    if (isInvoiceMatched) {
      let dbReceived = 0;
      matchedRebnis.forEach(r => {
        const invs = (r.matched_invoice_numbers || '').trim().toLowerCase().split(/[\s,;]+/);
        if (invs.some(inv => inv === targetInvStr || inv.startsWith(targetInvStr))) {
          dbReceived += parseInt(r.quantity_matched) || 0;
        }
      });
      const missingQty = Math.max(0, billed - dbReceived);
      return { status: missingQty > 0 ? 'Discrepancy (Missing Qty)' : 'Matched (No Discrepancy)', billed, received: dbReceived, missingQty, cp: cpVal };
    } else {
      return { status: 'Invoice Mismatch', billed, received: 0, missingQty: billed, cp: cpVal };
    }
  } else if (cntMatched > 1) {
    return { status: 'Matched to Multiple', billed, received, missingQty: Math.max(0, billed - received), cp: cpVal };
  }

  return { status: '0 Matches in REBNI', billed, received, missingQty: 0, cp: cpVal };
}

// --- Main processing ---
const rebniIndex = buildRebniIndex(rebniRecords);
const groups = buildGroups(invoiceRecords);
const totalGroups = groups.length;

parentPort.postMessage({ type: 'init', total: totalGroups });

const CHUNK_SIZE = 5;

for (let i = 0; i < totalGroups; i += CHUNK_SIZE) {
  const chunkResults = [];
  const end = Math.min(i + CHUNK_SIZE, totalGroups);

  for (let j = i; j < end; j++) {
    const [key, records] = groups[j];
    const [invoiceNumber, asin] = key.split('|');
    const firstRec = records[0];
    const po = (firstRec.purchase_order_id || '').trim();

    const mapKey = `${asin}|${po}`;
    const matchingRebnis = rebniIndex.get(mapKey) || [];
    const warehouseId = matchingRebnis.length > 0 ? (matchingRebnis[0].warehouse_id || '').trim() : '';

    const result = runRulesForBatch(invoiceNumber, asin, warehouseId, po, records, matchingRebnis);

    chunkResults.push({
      invoiceNumber,
      asin,
      po,
      warehouseId,
      status: result.status,
      billed: result.billed,
      received: result.received,
      missingQty: result.missingQty,
      cp: result.cp
    });
  }

  parentPort.postMessage({ type: 'chunk', results: chunkResults, processed: end, total: totalGroups });
}

parentPort.postMessage({ type: 'complete', processed: totalGroups, total: totalGroups });
