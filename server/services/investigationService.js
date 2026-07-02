/**
 * Service to manage active investigations and run rules.
 * This is designed to be modular. Future investigation rules can be registered 
 * and executed against the filtered in-memory datasets.
 */
class InvestigationService {
  constructor() {
    this.activeInvestigation = {
      vendorCode: null,
      invoiceSeller: null,
      rebniSeller: null,
      invoiceRecords: [],
      rebniRecords: [],
      stats: null,
      findings: [],
      timestamp: null
    };

    this.rules = [];
  }

  /**
   * Register a new investigation rule
   * @param {Object} rule - An object with { name, execute: (invoices, rebnis) => findings }
   */
  registerRule(rule) {
    if (typeof rule.execute !== 'function') {
      throw new Error(`Rule ${rule.name || 'unnamed'} must implement an execute function.`);
    }
    this.rules.push(rule);
    console.log(`Registered investigation rule: ${rule.name}`);
  }

  /**
   * Start a new investigation session, filter records, compute metrics, and run rules
   */
  startInvestigation(vendorCode, invoiceSeller, invoiceRecords, rebniSeller, rebniRecords) {
    const stats = this.calculateStats(invoiceRecords, rebniRecords);

    this.activeInvestigation = {
      vendorCode,
      invoiceSeller,
      rebniSeller,
      invoiceRecords,
      rebniRecords,
      timestamp: new Date().toISOString(),
      stats,
      findings: []
    };

    // Execute registered rules (if any)
    for (const rule of this.rules) {
      try {
        const ruleFindings = rule.execute(invoiceRecords, rebniRecords);
        if (Array.isArray(ruleFindings)) {
          this.activeInvestigation.findings.push(...ruleFindings);
        }
      } catch (err) {
        console.error(`Error running investigation rule '${rule.name}':`, err);
      }
    }

    return this.activeInvestigation;
  }

  /**
   * Compute Phase 1 summary statistics based on filtered records
   */
  calculateStats(invoiceRecords, rebniRecords) {
    // Unique ASINs
    const asins = new Set();
    invoiceRecords.forEach(r => {
      if (r.asin) asins.add(r.asin.trim());
      if (r.matched_asin) asins.add(r.matched_asin.trim());
    });
    rebniRecords.forEach(r => {
      if (r.asin) asins.add(r.asin.trim());
    });

    // Unique POs
    const pos = new Set();
    invoiceRecords.forEach(r => {
      if (r.purchase_order_id) pos.add(r.purchase_order_id.trim());
      if (r.matched_po) pos.add(r.matched_po.trim());
    });
    rebniRecords.forEach(r => {
      if (r.po) pos.add(r.po.trim());
    });

    // Unique Shipments
    const shipments = new Set();
    invoiceRecords.forEach(r => {
      if (r.shipment_id) shipments.add(r.shipment_id.trim());
    });
    rebniRecords.forEach(r => {
      if (r.shipment_id) shipments.add(r.shipment_id.trim());
    });

    return {
      totalInvoiceRecords: invoiceRecords.length,
      totalRebniRecords: rebniRecords.length,
      uniqueAsinCount: asins.size,
      uniquePoCount: pos.size,
      uniqueShipmentCount: shipments.size
    };
  }

  /**
   * Get unique invoice numbers and ASINs from the active session
   */
  getFiltersForActiveInvestigation() {
    const invoices = new Set();
    const asins = new Set();

    this.activeInvestigation.invoiceRecords.forEach(r => {
      if (r.invoice_number) invoices.add(r.invoice_number.trim());
      if (r.asin) asins.add(r.asin.trim());
    });

    return {
      invoices: Array.from(invoices).sort(),
      asins: Array.from(asins).sort()
    };
  }

  /**
   * Get unique warehouses and POs from REBNI records for a specific ASIN
   */
  getRebniFiltersForAsin(asin) {
    const warehouses = new Set();
    const pos = new Set();

    this.activeInvestigation.rebniRecords.forEach(r => {
      if ((r.asin || '').trim() === asin) {
        if (r.warehouse_id) warehouses.add(r.warehouse_id.trim());
        if (r.po) pos.add(r.po.trim());
      }
    });

    return {
      warehouses: Array.from(warehouses).sort(),
      pos: Array.from(pos).sort()
    };
  }

  /**
   * Internal rule execution helper to avoid duplication, supporting manual overrides
   */
  runRulesInternal(invoiceNumber, asin, warehouseId, po, matchedInvoices, matchedRebnis, manualMissingQty, manualCp) {
    const logs = [];

    if (manualMissingQty !== null && manualMissingQty !== undefined) {
      logs.push(`Manual Parameter Override: Missing QTY set to ${manualMissingQty}.`);
    }
    if (manualCp !== null && manualCp !== undefined) {
      logs.push(`Manual Parameter Override: Cost Price set to ${manualCp.toFixed(2)}.`);
    }

    logs.push(`Step 1: Filtering invoices for Invoice: "${invoiceNumber}", ASIN: "${asin}". Found ${matchedInvoices.length} matching rows.`);

    // If no database invoices exist, but manual parameters are provided, we can synthesize a result
    if (matchedInvoices.length === 0) {
      if (manualMissingQty !== null && manualMissingQty !== undefined) {
        logs.push(`[WARNING] No invoice rows found in database for Invoice: "${invoiceNumber}", ASIN: "${asin}". Proceeding with manual inputs.`);
        const billed = manualMissingQty;
        const received = 0;
        const missingQty = manualMissingQty;
        const cp = manualCp !== null ? manualCp : 0;
        const blurb = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${po}

        ASIN	    Missing QTY	CP
${asin}	                          ${missingQty}	              ${cp.toFixed(2)}  

For ASIN: ${asin}
Billed: ${billed}, Received: ${received}

Kindly investigate the following invoices and ASINs for missing units:

Invoice: ${invoiceNumber}
ASIN: ${asin}

Please check and help locate the missing units against the above invoices.`;

        return {
          status: 'Discrepancy (Missing Qty)',
          logs,
          billed,
          received,
          missingQty,
          cp,
          blurb
        };
      }

      logs.push(`[ERROR] No invoice rows found for Invoice: "${invoiceNumber}", ASIN: "${asin}".`);
      return {
        status: 'No Invoice Data',
        logs,
        blurb: `Error: No invoice data found for ASIN ${asin} / Invoice ${invoiceNumber}.`
      };
    }

    // Check if all statuses are interfaced/authorised/matched (case-insensitive)
    const matchedStatuses = ['INTERFACED', 'AUTHORISED', 'AUTHORIZED', 'MATCHED'];
    const isAllFullyMatched = matchedInvoices.every(r => {
      const status = (r.invoice_item_status || '').trim().toUpperCase();
      return matchedStatuses.includes(status);
    });

    logs.push(`Invoice statuses found: [${matchedInvoices.map(r => r.invoice_item_status || 'N/A').join(', ')}].`);

    const isManualDiscrepancyForce = manualMissingQty !== null && manualMissingQty !== undefined && manualMissingQty > 0;

    if (isAllFullyMatched && !isManualDiscrepancyForce) {
      logs.push(`Rule Triggered: [Rule 1 - All Units Interfaced/Matched]. All rows are in fully matched state.`);
      const blurb = `Hii Team,

For the claiming ASIN: ${asin} we see that all the units are in interfaces/matched state.
Kindly exclude those units and provide with the updated PQV.

Regards.`;
      return {
        status: 'Interfaced/Matched',
        logs,
        blurb
      };
    }

    logs.push(`Rule Triggered: [Rule 2 - Further REBNI Investigation needed (e.g. ON_HOLD or manual discrepancy present)].`);

    let billed = Math.max(0, ...matchedInvoices.map(r => parseInt(r.quantity_invoiced) || 0));
    let received = 0;
    let missingQty = 0;
    let cp = null;

    if (manualMissingQty !== null && manualMissingQty !== undefined) {
      missingQty = manualMissingQty;
      received = Math.max(0, billed - missingQty);
      logs.push(`Using manual Missing QTY override: ${missingQty}. Implied Received: ${received}.`);
    }

    if (manualCp !== null && manualCp !== undefined) {
      cp = manualCp;
      logs.push(`Using manual Cost Price override: ${cp.toFixed(2)}.`);
    }

    logs.push(`Step 2: Filtering REBNI for ASIN: "${asin}", Warehouse ID: "${warehouseId}", PO: "${po}". Found ${matchedRebnis.length} matching rows.`);

    if (matchedRebnis.length === 0) {
      logs.push(`[WARNING] No REBNI rows found for ASIN: "${asin}", Warehouse: "${warehouseId}", PO: "${po}".`);

      if (manualMissingQty === null || manualMissingQty === undefined) {
        missingQty = billed;
        received = 0;
      }
      const cpVal = cp !== null ? cp : 0;

      return {
        status: 'No REBNI Data',
        logs,
        billed,
        received,
        missingQty,
        cp: cpVal,
        blurb: `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${po}

        ASIN	    Missing QTY	CP
${asin}	                          ${missingQty}	              ${cpVal.toFixed(2)}  

For ASIN: ${asin}
Billed: ${billed}, Received: ${received} (No REBNI data)

Kindly investigate the following invoices and ASINs for missing units:

Invoice: ${invoiceNumber}
ASIN: ${asin}

Please check and help locate the missing units against the above invoices.`
      };
    }

    const rebni = matchedRebnis[0];
    const cntMatched = parseInt(rebni.cnt_invoice_matched) || 0;
    logs.push(`REBNI match count (cnt_invoice_matched): ${cntMatched}. Matched Invoices: "${rebni.matched_invoice_numbers || ''}".`);

    if (cntMatched === 1) {
      const matchedInvsStr = (rebni.matched_invoice_numbers || '').trim().toLowerCase();
      const targetInvStr = invoiceNumber.trim().toLowerCase();

      const isInvoiceMatched = matchedInvsStr === targetInvStr ||
        matchedInvsStr.startsWith(targetInvStr) ||
        targetInvStr.startsWith(matchedInvsStr) ||
        matchedInvsStr.split(/[\s,;]+/).some(inv =>
          inv === targetInvStr || inv.startsWith(targetInvStr) || targetInvStr.startsWith(inv)
        );

      if (isInvoiceMatched) {
        logs.push(`Success: REBNI matched invoice matches target Invoice number.`);

        if (manualMissingQty === null || manualMissingQty === undefined) {
          let dbReceived = 0;
          matchedRebnis.forEach(r => {
            const invs = (r.matched_invoice_numbers || '').trim().toLowerCase().split(/[\s,;]+/);
            const isMatched = invs.some(inv => inv === targetInvStr || inv.startsWith(targetInvStr) || targetInvStr.startsWith(inv)) ||
              (r.matched_invoice_numbers || '').trim().toLowerCase() === targetInvStr ||
              (r.matched_invoice_numbers || '').trim().toLowerCase().startsWith(targetInvStr) ||
              targetInvStr.startsWith((r.matched_invoice_numbers || '').trim().toLowerCase());
            if (isMatched) {
              dbReceived += parseInt(r.quantity_matched) || 0;
            }
          });
          received = dbReceived;
          missingQty = Math.max(0, billed - received);
        }

        if (cp === null) {
          cp = parseFloat(rebni.item_cost) || 0;
        }

        logs.push(`Billed Qty (highest): ${billed}. Received Qty: ${received}. Missing Qty: ${missingQty}. CP: ${cp.toFixed(2)}.`);

        let blurb = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${po}

        ASIN	    Missing QTY	CP
${asin}	                          ${missingQty}	              ${cp.toFixed(2)}  

For ASIN: ${asin}
Billed: ${billed}, Received: ${received}`;

        if (billed !== received || missingQty > 0) {
          logs.push(`Billed (${billed}) !== Received (${received}) or missing qty > 0. Generating complete missing units blurb.`);
          blurb += `\n\nKindly investigate the following invoices and ASINs for missing units:\n\nInvoice: ${invoiceNumber}\nASIN: ${asin}\n\nPlease check and help locate the missing units against the above invoices.`;
        } else {
          logs.push(`Billed (${billed}) === Received (${received}). Generating short blurb.`);
        }

        return {
          status: (billed === received && missingQty === 0) ? 'Matched (No Discrepancy)' : 'Discrepancy (Missing Qty)',
          logs,
          billed,
          received,
          missingQty,
          cp,
          blurb
        };
      } else {
        logs.push(`[WARNING] REBNI matched invoice "${rebni.matched_invoice_numbers}" does NOT match target Invoice "${invoiceNumber}".`);

        if (manualMissingQty === null || manualMissingQty === undefined) {
          received = 0;
          missingQty = billed;
        } else {
          missingQty = manualMissingQty;
          received = Math.max(0, billed - missingQty);
        }

        if (cp === null) {
          cp = parseFloat(rebni.item_cost) || 0;
        }

        logs.push(`Billed Qty (highest): ${billed}. Received Qty: ${received}. Missing Qty: ${missingQty}. CP: ${cp.toFixed(2)}.`);

        const blurb = `Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : ${po}

        ASIN	    Missing QTY	CP
${asin}	                          ${missingQty}	              ${cp.toFixed(2)}  

For ASIN: ${asin}
Billed: ${billed}, Received: ${received}

Kindly investigate the following invoices and ASINs for missing units:

Invoice: ${invoiceNumber}
ASIN: ${asin}

Please check and help locate the missing units against the above invoices.`;

        return {
          status: 'Invoice Mismatch',
          logs,
          billed,
          received,
          missingQty,
          cp,
          blurb
        };
      }
    } else if (cntMatched > 1) {
      logs.push(`[WARNING] ASIN matched to multiple invoices in REBNI (${rebni.matched_invoice_numbers}).`);
      return {
        status: 'Matched to Multiple',
        logs,
        billed,
        received,
        missingQty,
        cp: cp || parseFloat(rebni.item_cost) || 0,
        blurb: `Hello Team,

ASIN: ${asin} under PO: ${po} is matched to multiple invoices ("${rebni.matched_invoice_numbers}").
Kindly investigate the following target invoice for missing units:

Invoice: ${invoiceNumber}
ASIN: ${asin}

Regards.`
      };
    } else {
      logs.push(`[WARNING] REBNI indicates 0 invoice matches.`);
      return {
        status: '0 Matches in REBNI',
        logs,
        billed,
        received,
        missingQty,
        cp: cp || parseFloat(rebni.item_cost) || 0,
        blurb: `Hello Team,

ASIN: ${asin} under PO: ${po} shows 0 matched invoices in REBNI.
Kindly investigate the following invoice:

Invoice: ${invoiceNumber}
ASIN: ${asin}

Regards.`
      };
    }
  }

  /**
   * Run investigation rules on specified parameters (retained for backward compatibility)
   */
  runInvestigationRules(invoiceNumber, asin, warehouseId, po) {
    const matchedInvoices = this.activeInvestigation.invoiceRecords.filter(r => {
      const dbInv = (r.invoice_number || '').trim().toLowerCase();
      const queryInv = invoiceNumber.trim().toLowerCase();
      return (dbInv === queryInv || dbInv.startsWith(queryInv) || queryInv.startsWith(dbInv)) && (r.asin || '').trim() === asin;
    });

    const matchedRebnis = this.activeInvestigation.rebniRecords.filter(r =>
      (r.asin || '').trim() === asin &&
      (r.warehouse_id || '').trim() === warehouseId &&
      (r.po || '').trim() === po
    );

    return this.runRulesInternal(invoiceNumber, asin, warehouseId, po, matchedInvoices, matchedRebnis);
  }

  /**
   * Run multi-ASIN rules execution with manual override parameters
   */
  runInvestigationMulti(params) {
    const invoiceNumbers = (params.invoiceNumber || '').split(',').map(s => s.trim()).filter(Boolean);
    const asins = (params.asin || '').split(',').map(s => s.trim()).filter(Boolean);
    const missingQtyStrings = (params.missingQty || '').split(',').map(s => s.trim());
    const cpStrings = (params.cp || '').split(',').map(s => s.trim());
    const shipmentIds = (params.shipmentId || '').split(',').map(s => s.trim()).filter(Boolean);
    const pos = (params.po || '').split(',').map(s => s.trim()).filter(Boolean);
    const warehouseId = params.warehouseId ? params.warehouseId.trim() : '';

    const asinResults = [];

    for (let i = 0; i < asins.length; i++) {
      const currentAsin = asins[i];

      let manualMissingQty = null;
      if (missingQtyStrings[i] && !isNaN(parseInt(missingQtyStrings[i]))) {
        manualMissingQty = parseInt(missingQtyStrings[i]);
      } else if (missingQtyStrings[0] && !isNaN(parseInt(missingQtyStrings[0])) && asins.length === 1) {
        manualMissingQty = parseInt(missingQtyStrings[0]);
      }

      let manualCp = null;
      if (cpStrings[i] && !isNaN(parseFloat(cpStrings[i]))) {
        manualCp = parseFloat(cpStrings[i]);
      } else if (cpStrings[0] && !isNaN(parseFloat(cpStrings[0])) && asins.length === 1) {
        manualCp = parseFloat(cpStrings[0]);
      }

      const manualPo = pos[i] || pos[0] || '';
      const manualShipmentId = shipmentIds[i] || shipmentIds[0] || '';

      const matchedInvoices = this.activeInvestigation.invoiceRecords.filter(r => {
        const dbInv = (r.invoice_number || '').trim().toLowerCase();
        const invMatch = invoiceNumbers.some(qInv => {
          const queryInv = qInv.toLowerCase();
          return dbInv === queryInv || dbInv.startsWith(queryInv) || queryInv.startsWith(dbInv);
        });
        return invMatch && (r.asin || '').trim() === currentAsin;
      });

      let dbPo = '';
      if (matchedInvoices.length > 0) {
        dbPo = (matchedInvoices[0].purchase_order_id || matchedInvoices[0].matched_po || '').trim();
      }
      const targetPo = manualPo || dbPo || 'N/A';

      const matchedRebnis = this.activeInvestigation.rebniRecords.filter(r => {
        const asinMatch = (r.asin || '').trim() === currentAsin;
        const whMatch = warehouseId ? (r.warehouse_id || '').trim().toLowerCase() === warehouseId.toLowerCase() : true;

        let poMatch = true;
        if (targetPo && targetPo !== 'N/A') {
          poMatch = (r.po || '').trim() === targetPo;
        }
        return asinMatch && whMatch && poMatch;
      });

      const result = this.runRulesInternal(
        invoiceNumbers[0],
        currentAsin,
        warehouseId,
        targetPo,
        matchedInvoices,
        matchedRebnis,
        manualMissingQty,
        manualCp
      );

      let resultBadge = 'Paused';
      if (result.status === 'Interfaced/Matched') {
        resultBadge = 'Resolved - Fully Processed';
      } else if (result.status === 'Matched (No Discrepancy)') {
        resultBadge = 'Completed';
      } else if (result.status.startsWith('Discrepancy') || result.status.includes('Mismatch') || result.status.includes('Multiple') || result.status.includes('0 Matches') || result.status.includes('REBNI')) {
        resultBadge = 'Discrepancy Found';
      }

      const timelineMapped = result.logs.map(log => {
        if (log.startsWith('[ERROR]') || log.startsWith('Error:')) {
          return `❌ ${log}`;
        }
        if (log.startsWith('[WARNING]') || log.startsWith('Warning:') || log.includes('mismatch') || log.includes('does NOT match')) {
          return `⚠️ ${log}`;
        }
        if (log.includes('Success:') || log.includes('Rule Triggered:') || log.includes('Found REBNI record')) {
          return `✔ ${log}`;
        }
        return `🔹 ${log}`;
      });

      asinResults.push({
        asin: currentAsin,
        invoiceNumber: invoiceNumbers.join(', '),
        po: targetPo,
        warehouse: warehouseId || 'N/A',
        invoiceStatus: matchedInvoices.map(r => r.invoice_item_status || 'N/A').join(', ') || 'N/A',
        billedQty: result.billed !== undefined ? result.billed : Math.max(0, ...matchedInvoices.map(r => parseInt(r.quantity_invoiced) || 0)),
        receivedQty: result.received !== undefined ? result.received : 0,
        missingQty: result.missingQty !== undefined ? result.missingQty : 0,
        cp: result.cp,
        result: resultBadge,
        timeline: timelineMapped,
        generatedBlub: result.blurb,
        invoiceRecords: matchedInvoices,
        rebniRecords: matchedRebnis
      });
    }

    const combinedBlurb = this.compileCombinedBlurb(asinResults, invoiceNumbers, pos);

    return {
      success: true,
      asinResults,
      combinedBlurb
    };
  }

  /**
   * Format multiple rule results into a unified copy-paste blurb template
   */
  compileCombinedBlurb(asinResults, invoiceNumbers, pos) {
    const interfacedList = asinResults.filter(r => r.result === 'Resolved - Fully Processed');
    const discrepancyList = asinResults.filter(r => r.result === 'Discrepancy Found' || r.missingQty > 0);
    const anomalyList = asinResults.filter(r => r.result === 'Discrepancy Found' && r.missingQty === 0);

    const missingItems = discrepancyList.filter(item => item.missingQty > 0);

    let blurb = '';

    if (missingItems.length > 0) {
      const poList = Array.from(new Set(missingItems.map(r => r.po).filter(p => p && p !== 'N/A')));
      const displayPo = poList.length > 0 ? poList.join(', ') : (pos.join(', ') || 'N/A');

      blurb += `Hello Team,\n\n`;
      blurb += `-- Kindly find the below mentioned ASIN's missing from PO# : ${displayPo}\n\n`;
      blurb += `        ASIN	    Missing QTY	CP\n`;

      missingItems.forEach(item => {
        const cpVal = item.cp !== undefined && item.cp !== null ? Number(item.cp).toFixed(2) : 'N/A';
        blurb += `${item.asin.padEnd(12)}	                          ${item.missingQty}	              ${cpVal}  \n`;
      });

      blurb += `\n`;

      missingItems.forEach(item => {
        blurb += `For ASIN: ${item.asin}\n`;
        blurb += `Billed: ${item.billedQty}, Received: ${item.receivedQty}\n\n`;
      });

      blurb += `Kindly investigate the following invoices and ASINs for missing units:\n\n`;
      blurb += `Invoice: ${invoiceNumbers.join(', ')}\n`;
      blurb += `ASIN: ${missingItems.map(r => r.asin).join(', ')}\n\n`;
      blurb += `Please check and help locate the missing units against the above invoices.`;
    }

    const pureAnomalies = anomalyList.filter(item => item.missingQty === 0);
    if (pureAnomalies.length > 0) {
      if (blurb) {
        blurb += `\n\n--------------------------------------------------\n`;
      } else {
        blurb += `Hello Team,\n\n`;
      }

      blurb += `Kindly investigate the following anomalies:\n`;
      pureAnomalies.forEach(item => {
        blurb += `- ASIN: ${item.asin} under PO: ${item.po} has warning state (${item.invoiceStatus}).\n`;
      });
      blurb += `\nInvoice: ${invoiceNumbers.join(', ')}\n`;
    }

    if (interfacedList.length > 0) {
      if (blurb) {
        blurb += `\n\n--------------------------------------------------\n`;
        blurb += `Note: For the claiming ASIN: ${interfacedList.map(r => r.asin).join(', ')} we see that all the units are in interfaces/matched state.\n`;
        blurb += `Kindly exclude those units and provide with the updated PQV.`;
      } else {
        blurb += `Hii Team,\n\n`;
        blurb += `For the claiming ASIN: ${interfacedList.map(r => r.asin).join(', ')} we see that all the units are in interfaces/matched state.\n`;
        blurb += `Kindly exclude those units and provide with the updated PQV.`;
      }
    }

    if (!blurb) {
      blurb = `Hello Team,\n\nInvestigation completed for Invoice: ${invoiceNumbers.join(', ')}. All ASINs were evaluated successfully.\n`;
    }

    blurb += `\n\nRegards.`;
    return blurb;
  }

  getBatchSummary() {
    const invoiceRecords = this.activeInvestigation.invoiceRecords;
    const rebniRecords = this.activeInvestigation.rebniRecords;

    if (!invoiceRecords || invoiceRecords.length === 0) return [];

    // Pre-index REBNI records by "asin|po" to enable O(1) lookups
    const rebniIndex = new Map();
    rebniRecords.forEach(r => {
      if (!r.asin || !r.po) return;
      const key = `${r.asin.trim()}|${r.po.trim()}`;
      if (!rebniIndex.has(key)) {
        rebniIndex.set(key, []);
      }
      rebniIndex.get(key).push(r);
    });

    // Group unique invoice_number + asin
    const groups = new Map();
    invoiceRecords.forEach(r => {
      if (!r.invoice_number || !r.asin) return;
      const key = `${r.invoice_number.trim()}|${r.asin.trim()}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(r);
    });

    const summary = [];
    for (const [key, records] of groups.entries()) {
      const [invoiceNumber, asin] = key.split('|');
      const firstRec = records[0];
      const po = (firstRec.purchase_order_id || '').trim();

      // Find REBNI match in O(1) time
      const mapKey = `${asin}|${po}`;
      const matchingRebnis = rebniIndex.get(mapKey) || [];
      const warehouseId = matchingRebnis.length > 0 ? (matchingRebnis[0].warehouse_id || '').trim() : '';

      const result = this.runRulesInternal(invoiceNumber, asin, warehouseId, po, records, matchingRebnis);

      summary.push({
        invoiceNumber,
        asin,
        po,
        warehouseId,
        status: result.status,
        billed: result.billed !== undefined ? result.billed : Math.max(...records.map(r => parseInt(r.quantity_invoiced) || 0)),
        received: result.received !== undefined ? result.received : 0,
        missingQty: result.missingQty !== undefined ? result.missingQty : 0,
        cp: result.cp || 0
      });
    }

    return summary;
  }

  /**
   * Get the current active investigation state
   */
  getActiveInvestigation() {
    return this.activeInvestigation;
  }
}

// Export a singleton instance of the service
export const investigationService = new InvestigationService();
