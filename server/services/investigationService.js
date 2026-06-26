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
    
    // In future phases, rules can be registered here
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

    // Execute registered rules (placeholder for future phases)
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
   * Get the current active investigation state
   */
  getActiveInvestigation() {
    return this.activeInvestigation;
  }
}

// Export a singleton instance of the service
export const investigationService = new InvestigationService();
