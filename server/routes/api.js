import express from 'express';
import { 
  getAvailableSellers, 
  filterTsvByVendorCode, 
  getInvoiceFilePath, 
  getRebniFilePath,
  getInvoiceFilesForSeller,
  getRebniFilesForSeller,
  getCacheStats,
  clearCache
} from '../services/dataService.js';
import { investigationService } from '../services/investigationService.js';
import { investigationEngine } from '../services/investigation/investigationEngine.js';

const router = express.Router();

// Defined column sets as per Phase 1 instructions
const INVOICE_COLUMNS = [
  'vendor_code',
  'purchase_order_id',
  'asin',
  'invoice_number',
  'invoice_date',
  'invoice_item_status',
  'quantity_invoiced',
  'quantity_matched',
  'no_of_shipments',
  'shipment_id',
  'shipwise_matched_qty', // Note: Dawntech.txt sample had 'shipmentwise_matched_qty', let's check!
  'matched_po',
  'matched_asin'
];

const REBNI_COLUMNS = [
  'vendor_code',
  'po',
  'asin',
  'shipment_id',
  'received_datetime',
  'warehouse_id',
  'item_cost',
  'quantity_unpacked',
  'quantity_adjusted',
  'qty_received_postadj',
  'quantity_matched',
  'rebni_available',
  'cnt_invoice_matched',
  'matched_invoice_numbers'
];

// Wait, let's look at the sample column name for Invoice:
// In the prompt, the user specified: `shipmentwise_matched_qty`
// But in the sample read of Dawntech.txt, the column header is indeed: `shipmentwise_matched_qty`
// Let's modify our INVOICE_COLUMNS to support both or match exactly the user specification.
// Let's check: user wrote: `shipmentwise_matched_qty`
// Let's use `shipmentwise_matched_qty`.

const INVOICE_COLUMNS_SPEC = [
  'vendor_code',
  'purchase_order_id',
  'asin',
  'invoice_number',
  'invoice_date',
  'invoice_item_status',
  'quantity_invoiced',
  'quantity_matched',
  'no_of_shipments',
  'shipment_id',
  'shipmentwise_matched_qty',
  'matched_po',
  'matched_asin'
];

/**
 * GET /api/sellers
 * Retrieve lists of available seller files from Invoice and REBNI folders
 */
router.get('/sellers', async (req, res) => {
  try {
    const sellers = await getAvailableSellers();
    res.json(sellers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/investigate
 * Start an investigation by filtering Invoice and REBNI files for a vendor code
 */
router.post('/investigate', async (req, res) => {
  const { vendorCode, invoiceSeller, rebniSeller } = req.body;

  // Validation
  if (!vendorCode || !vendorCode.trim()) {
    return res.status(400).json({ error: 'Vendor Code is required.' });
  }
  if (!invoiceSeller) {
    return res.status(400).json({ error: 'Invoice Seller must be selected.' });
  }
  if (!rebniSeller) {
    return res.status(400).json({ error: 'REBNI Seller must be selected.' });
  }

  try {
    const invoiceFiles = await getInvoiceFilesForSeller(invoiceSeller);
    const rebniFiles = await getRebniFilesForSeller(rebniSeller);

    if (invoiceFiles.length === 0) {
      return res.status(400).json({ error: `No files found for Invoice seller: ${invoiceSeller}` });
    }
    if (rebniFiles.length === 0) {
      return res.status(400).json({ error: `No files found for REBNI seller: ${rebniSeller}` });
    }

    console.log(`Filtering Invoice files: [${invoiceFiles.join(', ')}] and REBNI files: [${rebniFiles.join(', ')}] for Vendor: ${vendorCode}`);
    
    // Parse all files for the vendor in parallel
    const invoiceFilteredPromises = invoiceFiles.map(file => 
      filterTsvByVendorCode(getInvoiceFilePath(file), vendorCode, INVOICE_COLUMNS_SPEC)
    );
    const rebniFilteredPromises = rebniFiles.map(file => 
      filterTsvByVendorCode(getRebniFilePath(file), vendorCode, REBNI_COLUMNS)
    );

    const [invoiceFilteredArrays, rebniFilteredArrays] = await Promise.all([
      Promise.all(invoiceFilteredPromises),
      Promise.all(rebniFilteredPromises)
    ]);

    const invoiceFiltered = invoiceFilteredArrays.flat();
    const rebniFiltered = rebniFilteredArrays.flat();

    // Save and compute statistics in investigationService
    const session = investigationService.startInvestigation(
      vendorCode.trim(),
      invoiceSeller,
      invoiceFiltered,
      rebniSeller,
      rebniFiltered
    );

    res.json({
      success: true,
      message: 'Investigation completed successfully',
      vendorCode: session.vendorCode,
      invoiceSeller: session.invoiceSeller,
      rebniSeller: session.rebniSeller,
      timestamp: session.timestamp,
      stats: session.stats,
      // For Phase 1, we send the filtered datasets to the client so it can render the tables
      invoiceRecords: session.invoiceRecords,
      rebniRecords: session.rebniRecords,
      findings: session.findings
    });

  } catch (error) {
    console.error('Investigation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/investigate/run
 * Run the modular investigation engine against loaded records
 */
// POST /api/investigate/run was consolidated below to support multi-item investigations.

/**
 * GET /api/investigate/filters
 * Retrieve unique invoices and ASINs for the loaded session
 */
router.get('/investigate/filters', (req, res) => {
  try {
    const filters = investigationService.getFiltersForActiveInvestigation();
    res.json(filters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/investigate/rebni-filters
 * Retrieve unique warehouses and POs for a selected ASIN
 */
router.get('/investigate/rebni-filters', (req, res) => {
  const { asin } = req.query;
  if (!asin) {
    return res.status(400).json({ error: 'ASIN parameter is required.' });
  }
  try {
    const filters = investigationService.getRebniFiltersForAsin(asin);
    res.json(filters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/investigate/run
 * Run the investigation rules for an Invoice Number and Warehouse ID, processing all ASINs
 */
router.post('/investigate/run', (req, res) => {
  const { 
    invoiceNumber, 
    asin, 
    missingQty, 
    cp, 
    warehouseId, 
    receivedDate, 
    shipmentId, 
    po 
  } = req.body;

  if (!invoiceNumber || !invoiceNumber.trim()) {
    return res.status(400).json({ error: 'Invoice Number is required.' });
  }
  if (!asin || !asin.trim()) {
    return res.status(400).json({ error: 'ASIN is required.' });
  }

  try {
    const session = investigationService.getActiveInvestigation();
    if (!session.vendorCode) {
      return res.status(400).json({ error: 'No active investigation session. Please start an investigation first.' });
    }

    const runResult = investigationService.runInvestigationMulti({
      invoiceNumber,
      asin,
      missingQty,
      cp,
      warehouseId,
      receivedDate,
      shipmentId,
      po
    });

    res.json(runResult);
  } catch (error) {
    console.error('Run multi investigation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/investigate/batch-summary
 * Get status summary for all unique (invoice, ASIN) pairs in the session
 */
router.get('/investigate/batch-summary', (req, res) => {
  try {
    const summary = investigationService.getBatchSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/session
 * Get current active investigation details
 */
router.get('/session', (req, res) => {
  const session = investigationService.getActiveInvestigation();
  if (!session.vendorCode) {
    return res.json({ active: false });
  }
  res.json({ active: true, session });
});

/**
 * GET /api/download/invoice
 * Export the current session's invoice records to CSV
 */
router.get('/download/invoice', (req, res) => {
  try {
    const session = investigationService.getActiveInvestigation();
    if (!session || !session.invoiceRecords || session.invoiceRecords.length === 0) {
      return res.status(400).send('No active invoice records to download.');
    }

    const headers = INVOICE_COLUMNS_SPEC;
    const labelMap = {
      purchase_order_id: 'PO ID',
      asin: 'ASIN',
      invoice_number: 'Invoice No.',
      invoice_date: 'Invoice Date',
      invoice_item_status: 'Status',
      quantity_invoiced: 'Qty Invoiced',
      quantity_matched: 'Qty Matched',
      no_of_shipments: 'Shipment Count',
      shipment_id: 'Shipment ID',
      shipmentwise_matched_qty: 'Shipment Matched Qty',
      matched_po: 'Matched PO',
      matched_asin: 'Matched ASIN'
    };

    let records = session.invoiceRecords;
    const query = req.query.query ? req.query.query.toLowerCase().trim() : '';
    const asinVal = req.query.asin ? req.query.asin.toLowerCase().trim() : '';
    const numberVal = req.query.number ? req.query.number.toLowerCase().trim() : '';
    const matchedPoVal = req.query.matchedPo ? req.query.matchedPo.toLowerCase().trim() : '';
    const matchedAsinVal = req.query.matchedAsin ? req.query.matchedAsin.toLowerCase().trim() : '';

    if (query || asinVal || numberVal || matchedPoVal || matchedAsinVal) {
      records = records.filter(row => {
        const matchesQuery = !query || Object.values(row).some(val => String(val).toLowerCase().includes(query));
        const matchesAsin = !asinVal || (row.asin && String(row.asin).toLowerCase().includes(asinVal));
        const matchesNumber = !numberVal || (row.invoice_number && String(row.invoice_number).toLowerCase().includes(numberVal));
        const matchesMatchedPo = !matchedPoVal || (row.matched_po && String(row.matched_po).toLowerCase().includes(matchedPoVal));
        const matchesMatchedAsin = !matchedAsinVal || (row.matched_asin && String(row.matched_asin).toLowerCase().includes(matchedAsinVal));
        return matchesQuery && matchesAsin && matchesNumber && matchesMatchedPo && matchesMatchedAsin;
      });
    }

    const headerRow = headers.map(h => `"${(labelMap[h] || h).replace(/"/g, '""')}"`).join(',');
    const dataRows = records.map(row => {
      return headers.map(h => {
        const val = row[h] !== undefined ? String(row[h]) : '';
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_analysis_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('Error downloading invoice CSV:', error);
    res.status(500).send(error.message);
  }
});

/**
 * GET /api/download/rebni
 * Export the current session's REBNI records to CSV
 */
router.get('/download/rebni', (req, res) => {
  try {
    const session = investigationService.getActiveInvestigation();
    if (!session || !session.rebniRecords || session.rebniRecords.length === 0) {
      return res.status(400).send('No active REBNI records to download.');
    }

    const headers = REBNI_COLUMNS;
    const labelMap = {
      po: 'PO ID',
      asin: 'ASIN',
      shipment_id: 'Shipment ID',
      received_datetime: 'Received Date/Time',
      warehouse_id: 'Warehouse',
      item_cost: 'Cost',
      quantity_unpacked: 'Qty Unpacked',
      quantity_adjusted: 'Qty Adjusted',
      qty_received_postadj: 'Post-Adj Qty',
      quantity_matched: 'Qty Matched',
      rebni_available: 'REBNI Avail',
      cnt_invoice_matched: 'Matched Invoice Count',
      matched_invoice_numbers: 'Matched Invoice No.'
    };

    let records = session.rebniRecords;
    const query = req.query.query ? req.query.query.toLowerCase().trim() : '';
    const asinVal = req.query.asin ? req.query.asin.toLowerCase().trim() : '';
    const poVal = req.query.po ? req.query.po.toLowerCase().trim() : '';
    const warehouseVal = req.query.warehouse ? req.query.warehouse.toLowerCase().trim() : '';
    const startDateVal = req.query.startDate ? req.query.startDate : '';
    const endDateVal = req.query.endDate ? req.query.endDate : '';

    if (query || asinVal || poVal || warehouseVal || startDateVal || endDateVal) {
      records = records.filter(row => {
        const matchesQuery = !query || Object.values(row).some(val => String(val).toLowerCase().includes(query));
        const matchesAsin = !asinVal || (row.asin && String(row.asin).toLowerCase().includes(asinVal));
        const matchesPo = !poVal || (row.po && String(row.po).toLowerCase().includes(poVal));
        const matchesWarehouse = !warehouseVal || (row.warehouse_id && String(row.warehouse_id).toLowerCase().includes(warehouseVal));
        
        let matchesDateRange = true;
        if (startDateVal || endDateVal) {
          const rowDateStr = row.received_datetime ? String(row.received_datetime).slice(0, 10) : '';
          if (rowDateStr) {
            if (startDateVal && rowDateStr < startDateVal) {
              matchesDateRange = false;
            }
            if (endDateVal && rowDateStr > endDateVal) {
              matchesDateRange = false;
            }
          } else {
            matchesDateRange = false;
          }
        }

        return matchesQuery && matchesAsin && matchesPo && matchesWarehouse && matchesDateRange;
      });
    }

    const headerRow = headers.map(h => `"${(labelMap[h] || h).replace(/"/g, '""')}"`).join(',');
    const dataRows = records.map(row => {
      return headers.map(h => {
        const val = row[h] !== undefined ? String(row[h]) : '';
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=rebni_analysis_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('Error downloading REBNI CSV:', error);
    res.status(500).send(error.message);
  }
});

/**
 * GET /api/cache
 * View current in-memory cache statistics
 */
router.get('/cache', (req, res) => {
  res.json(getCacheStats());
});

/**
 * DELETE /api/cache
 * Clear all cached results (useful after data files are updated)
 */
router.delete('/cache', (req, res) => {
  clearCache();
  res.json({ success: true, message: 'Cache cleared successfully.' });
});

export default router;
