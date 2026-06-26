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
router.post('/investigate/run', (req, res) => {
  const { invoiceNumber, warehouseId } = req.body;

  if (!invoiceNumber || !invoiceNumber.trim()) {
    return res.status(400).json({ error: 'Invoice Number is required.' });
  }

  const session = investigationService.getActiveInvestigation();
  if (!session || !session.vendorCode || session.invoiceRecords.length === 0) {
    return res.status(400).json({ error: 'No active session. Please load seller/vendor data first.' });
  }

  try {
    const runResult = investigationEngine.run(
      session.invoiceRecords,
      session.rebniRecords,
      invoiceNumber.trim(),
      warehouseId
    );

    res.json(runResult);
  } catch (error) {
    console.error('Run investigation error:', error);
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
