/* ==========================================================================
   PD Investigation Dashboard - Frontend Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // UI Cache Elements
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const clockEl = document.getElementById('real-time-clock');
  const clockLabelEl = document.getElementById('clock-label');
  
  const setupForm = document.getElementById('investigation-form');
  const vendorInput = document.getElementById('vendor-code-input');
  const invoiceSelect = document.getElementById('invoice-seller-select');
  const rebniSelect = document.getElementById('rebni-seller-select');
  const startBtn = document.getElementById('start-investigation-btn');
  const btnSpinner = document.getElementById('btn-spinner');
  
  const invoiceSpinner = document.getElementById('invoice-select-spinner');
  const rebniSpinner = document.getElementById('rebni-select-spinner');
  
  const generalError = document.getElementById('general-error');
  const vendorError = document.getElementById('vendor-code-error');
  const invoiceError = document.getElementById('invoice-seller-error');
  const rebniError = document.getElementById('rebni-seller-error');
  
  const activeBadge = document.getElementById('active-investigation-indicator');
  const statsContainer = document.getElementById('summary-stats-container');
  
  // Phase 2 Engine UI Elements
  const engineRunnerSection = document.getElementById('engine-runner-section');
  const engineForm = document.getElementById('engine-form');
  const engineInvoiceInput = document.getElementById('invoice-input');
  const engineAsinInput = document.getElementById('asin-input');
  const engineAsinList = document.getElementById('asin-list');
  const engineMissingQtyInput = document.getElementById('missing-qty-input');
  const engineCpInput = document.getElementById('cp-input');
  const engineWarehouseInput = document.getElementById('warehouse-input');
  const engineWarehouseList = document.getElementById('warehouse-list');
  const engineReceivedDateInput = document.getElementById('received-date-input');
  const engineShipmentInput = document.getElementById('shipment-input');
  const enginePoInput = document.getElementById('po-input');
  const runEngineBtn = document.getElementById('run-engine-btn');
  const clearEngineBtn = document.getElementById('clear-engine-btn');
  const engineBtnSpinner = document.getElementById('engine-btn-spinner');
  const engineError = document.getElementById('engine-error');
  const engineWarning = document.getElementById('engine-warning');

  function setEngineFormActive(active) {
    const inputs = [
      engineInvoiceInput,
      engineAsinInput,
      engineMissingQtyInput,
      engineCpInput,
      engineWarehouseInput,
      engineReceivedDateInput,
      engineShipmentInput,
      enginePoInput
    ];
    inputs.forEach(input => {
      if (input) input.disabled = !active;
    });
    if (runEngineBtn) runEngineBtn.disabled = !active;
    if (clearEngineBtn) clearEngineBtn.disabled = !active;
    if (active) {
      if (engineWarning) engineWarning.classList.add('hidden');
    } else {
      if (engineWarning) engineWarning.classList.remove('hidden');
    }
  }

  async function checkSession() {
    try {
      const response = await fetch('/api/session');
      if (!response.ok) {
        setEngineFormActive(false);
        return;
      }
      const data = await response.json();
      if (data.active) {
        invoiceData = data.session.invoiceRecords || [];
        rebniData = data.session.rebniRecords || [];
        
        activeBadge.classList.remove('hidden');
        renderSummaryStats(data.session.stats);
        
        initTable('invoice', invoiceData, INVOICE_HEADERS);
        initTable('rebni', rebniData, REBNI_HEADERS);
        
        populateEngineInputs();
        setEngineFormActive(true);
        
        renderTableLoading('batch-table-container');
        const batchSummaryRes = await fetch('/api/investigate/batch-summary');
        if (batchSummaryRes.ok) {
          const batchData = await batchSummaryRes.json();
          document.getElementById('batch-summary-section').classList.remove('hidden');
          initBatchTable(batchData);
        }
      } else {
        setEngineFormActive(false);
      }
    } catch (e) {
      console.error('Session restore error:', e);
      setEngineFormActive(false);
    }
  }
  
  const engineResultsSection = document.getElementById('engine-results-section');
  const asinTabsList = document.getElementById('asin-tabs-list');
  const copyBlubBtn = document.getElementById('copy-blub-btn');
  
  // Table action panels
  const invoiceTableActions = document.getElementById('invoice-table-actions');
  const rebniTableActions = document.getElementById('rebni-table-actions');
  const invoiceSearchInput = document.getElementById('invoice-search-input');
  const rebniSearchInput = document.getElementById('rebni-search-input');
  
  // In-Memory Data for Tables (State)
  let invoiceData = [];
  let rebniData = [];
  
  // ==========================================================================
  // Real-time Clock Component
  // ==========================================================================
  function updateClock() {
    const now = new Date();
    // Format options matching a clean premium look: YYYY-MM-DD HH:mm:ss IST
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    clockEl.textContent = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ==========================================================================
  // Theme Manager Component
  // ==========================================================================
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });

  // ==========================================================================
  // Data Loading & Setup Form Populate
  // ==========================================================================
  async function loadSellers() {
    invoiceSpinner.style.display = 'block';
    rebniSpinner.style.display = 'block';
    
    try {
      const response = await fetch('/api/sellers');
      if (!response.ok) {
        throw new Error('Failed to retrieve list of sellers.');
      }
      
      const { invoiceSellers, rebniSellers } = await response.json();
      
      // Populate Invoice Dropdown
      invoiceSelect.innerHTML = '<option value="" disabled selected>-- Select Invoice File --</option>';
      invoiceSellers.forEach(file => {
        const option = document.createElement('option');
        option.value = file;
        option.textContent = file.replace(/\.txt$/i, '');
        invoiceSelect.appendChild(option);
      });
      
      // Populate REBNI Dropdown
      rebniSelect.innerHTML = '<option value="" disabled selected>-- Select REBNI File --</option>';
      rebniSellers.forEach(file => {
        const option = document.createElement('option');
        option.value = file;
        option.textContent = file.replace(/\.txt$/i, '');
        rebniSelect.appendChild(option);
      });
      
    } catch (error) {
      console.error(error);
      showGeneralError(`Initialization Error: ${error.message}. Please verify backend server and files.`);
      
      invoiceSelect.innerHTML = '<option value="" disabled>Error loading</option>';
      rebniSelect.innerHTML = '<option value="" disabled>Error loading</option>';
    } finally {
      invoiceSpinner.style.display = 'none';
      rebniSpinner.style.display = 'none';
      validateFormState();
    }
  }

  // ==========================================================================
  // Form State & Validations
  // ==========================================================================
  function validateFormState() {
    const isVendorValid = vendorInput.value.trim().length > 0;
    const isInvoiceSelected = invoiceSelect.value !== "";
    const isRebniSelected = rebniSelect.value !== "";
    
    startBtn.disabled = !(isVendorValid && isInvoiceSelected && isRebniSelected);
  }

  vendorInput.addEventListener('input', () => {
    vendorError.textContent = '';
    validateFormState();
  });
  invoiceSelect.addEventListener('change', () => {
    invoiceError.textContent = '';
    validateFormState();
  });
  rebniSelect.addEventListener('change', () => {
    rebniError.textContent = '';
    validateFormState();
  });

  function showGeneralError(msg) {
    generalError.textContent = msg;
    generalError.classList.remove('hidden');
  }

  function clearErrors() {
    generalError.textContent = '';
    generalError.classList.add('hidden');
    vendorError.textContent = '';
    invoiceError.textContent = '';
    rebniError.textContent = '';
  }

  // ==========================================================================
  // Investigation Form Submission
  // ==========================================================================
  setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    
    const vendorCode = vendorInput.value.trim();
    const invoiceSeller = invoiceSelect.value;
    const rebniSeller = rebniSelect.value;
    
    // UI Loading State
    startBtn.disabled = true;
    btnSpinner.style.display = 'inline-block';
    document.getElementById('start-investigation-btn').querySelector('.btn-text').textContent = 'Processing...';
    
    // Clear display state and render skeleton loaders
    renderSummaryLoading();
    renderTableLoading('invoice-table-container');
    renderTableLoading('rebni-table-container');
    invoiceTableActions.classList.add('hidden');
    rebniTableActions.classList.add('hidden');
    document.getElementById('invoice-pagination').classList.add('hidden');
    document.getElementById('rebni-pagination').classList.add('hidden');
    activeBadge.classList.add('hidden');
    
    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ vendorCode, invoiceSeller, rebniSeller })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to complete investigation process.');
      }
      
      // Update global tables state
      invoiceData = result.invoiceRecords || [];
      rebniData = result.rebniRecords || [];
      
      // Update UI components
      activeBadge.classList.remove('hidden');
      renderSummaryStats(result.stats);
      
      // Initialize dynamic tables with search, sort, and pagination
      initTable('invoice', invoiceData, INVOICE_HEADERS);
      initTable('rebni', rebniData, REBNI_HEADERS);

      // Populate Phase 2 Engine Inputs
      populateEngineInputs();
      setEngineFormActive(true);

      // Fetch and display batch summary
      renderTableLoading('batch-table-container');
      const batchSummaryRes = await fetch('/api/investigate/batch-summary');
      if (batchSummaryRes.ok) {
        const batchData = await batchSummaryRes.json();
        document.getElementById('batch-summary-section').classList.remove('hidden');
        initBatchTable(batchData);
      } else {
        console.error('Failed to load batch summary.');
      }
      
    } catch (error) {
      console.error(error);
      showGeneralError(`Investigation Failed: ${error.message}`);
      resetSummaryPlaceholder();
      resetTablePlaceholder('invoice-table-container', 'Invoice data will be displayed here after running the investigation.');
      resetTablePlaceholder('rebni-table-container', 'REBNI data will be displayed here after running the investigation.');
    } finally {
      // Restore Button State
      btnSpinner.style.display = 'none';
      document.getElementById('start-investigation-btn').querySelector('.btn-text').textContent = 'Start Investigation';
      validateFormState();
    }
  });

  // ==========================================================================
  // Render Helpers (Loading / Placeholders)
  // ==========================================================================
  function renderSummaryLoading() {
    statsContainer.innerHTML = `
      <div class="skeleton-loader" style="padding: 20px;">
        <div class="skeleton-row" style="height: 40px; margin-bottom: 12px; width: 60%;"></div>
        <div class="skeleton-row" style="height: 24px; margin-bottom: 6px;"></div>
        <div class="skeleton-row" style="height: 24px; margin-bottom: 6px;"></div>
        <div class="skeleton-row" style="height: 24px; width: 80%;"></div>
      </div>
    `;
  }
  
  function renderTableLoading(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div class="skeleton-loader">
        <div class="skeleton-row" style="height: 35px; margin-bottom: 15px; width: 30%;"></div>
        <div class="skeleton-row" style="margin-bottom: 10px;"></div>
        <div class="skeleton-row" style="margin-bottom: 10px;"></div>
        <div class="skeleton-row" style="margin-bottom: 10px;"></div>
        <div class="skeleton-row" style="margin-bottom: 10px;"></div>
      </div>
    `;
  }

  function resetSummaryPlaceholder() {
    statsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🕵️</div>
        <p>Configure investigation setup and click <strong>Start Investigation</strong> to view statistics.</p>
      </div>
    `;
  }

  function resetTablePlaceholder(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div class="empty-state">
        <p>${message}</p>
      </div>
    `;
  }

  function renderSummaryStats(stats) {
    statsContainer.innerHTML = `
      <div class="stats-grid animate-fade-in">
        <div class="stat-item">
          <span class="stat-label">Invoice Records</span>
          <span class="stat-value">${stats.totalInvoiceRecords.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">REBNI Records</span>
          <span class="stat-value">${stats.totalRebniRecords.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Unique ASINs</span>
          <span class="stat-value">${stats.uniqueAsinCount.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Unique POs</span>
          <span class="stat-value">${stats.uniquePoCount.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Unique Shipments</span>
          <span class="stat-value">${stats.uniqueShipmentCount.toLocaleString()}</span>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // Dynamic Reusable Tables (Search, Sorting, Pagination)
  // ==========================================================================
  
  // Headers configuration mapping database column to user-friendly label
  const INVOICE_HEADERS = [
    { key: 'purchase_order_id', label: 'PO ID', isMono: true },
    { key: 'asin', label: 'ASIN', isMono: true },
    { key: 'invoice_number', label: 'Invoice No.', isMono: true },
    { key: 'invoice_date', label: 'Invoice Date' },
    { key: 'invoice_item_status', label: 'Status' },
    { key: 'quantity_invoiced', label: 'Qty Invoiced' },
    { key: 'quantity_matched', label: 'Qty Matched' },
    { key: 'no_of_shipments', label: 'Shipment Count' },
    { key: 'shipment_id', label: 'Shipment ID', isMono: true },
    { key: 'shipmentwise_matched_qty', label: 'Shipment Matched Qty' },
    { key: 'matched_po', label: 'Matched PO', isMono: true },
    { key: 'matched_asin', label: 'Matched ASIN', isMono: true }
  ];

  const REBNI_HEADERS = [
    { key: 'po', label: 'PO ID', isMono: true },
    { key: 'asin', label: 'ASIN', isMono: true },
    { key: 'shipment_id', label: 'Shipment ID', isMono: true },
    { key: 'received_datetime', label: 'Received Date/Time' },
    { key: 'warehouse_id', label: 'Warehouse' },
    { key: 'item_cost', label: 'Cost' },
    { key: 'quantity_unpacked', label: 'Qty Unpacked' },
    { key: 'quantity_adjusted', label: 'Qty Adjusted' },
    { key: 'qty_received_postadj', label: 'Post-Adj Qty' },
    { key: 'quantity_matched', label: 'Qty Matched' },
    { key: 'rebni_available', label: 'REBNI Avail' },
    { key: 'cnt_invoice_matched', label: 'Matched Invoice Count' },
    { key: 'matched_invoice_numbers', label: 'Matched Invoice No.', isMono: true }
  ];

  const PAGE_SIZE = 10;

  function initTable(type, rawData, headers) {
    const searchInput = document.getElementById(`${type}-search-input`);
    const actionPanel = document.getElementById(`${type}-table-actions`);
    const tableContainer = document.getElementById(`${type}-table-container`);
    const paginationPanel = document.getElementById(`${type}-pagination`);
    
    // Table State
    let filteredData = [...rawData];
    let sortKey = '';
    let sortAsc = true;
    let currentPage = 1;
    
    // Get filter inputs
    const asinFilter = document.getElementById(`${type}-asin-filter`);
    const numberFilter = document.getElementById(`${type}-number-filter`);
    const poFilter = document.getElementById(`${type}-po-filter`);
    const warehouseFilter = document.getElementById(`${type}-warehouse-filter`);
    const matchedPoFilter = document.getElementById(`${type}-matched-po-filter`);
    const matchedAsinFilter = document.getElementById(`${type}-matched-asin-filter`);
    const startDateFilter = document.getElementById(`${type}-start-date-filter`);
    const endDateFilter = document.getElementById(`${type}-end-date-filter`);
    
    // Clear and show search actions
    searchInput.value = '';
    if (asinFilter) asinFilter.value = '';
    if (numberFilter) numberFilter.value = '';
    if (poFilter) poFilter.value = '';
    if (warehouseFilter) warehouseFilter.value = '';
    if (matchedPoFilter) matchedPoFilter.value = '';
    if (matchedAsinFilter) matchedAsinFilter.value = '';
    if (startDateFilter) startDateFilter.value = '';
    if (endDateFilter) endDateFilter.value = '';
    actionPanel.classList.remove('hidden');
    
    // Datalist population helper
    const populateDatalist = (id, values) => {
      const dl = document.getElementById(id);
      if (!dl) return;
      dl.innerHTML = '';
      values.forEach(v => {
        if (v !== undefined && v !== null && v !== '') {
          const opt = document.createElement('option');
          opt.value = v;
          dl.appendChild(opt);
        }
      });
    };

    if (type === 'invoice') {
      const uniqueAsins = Array.from(new Set(rawData.map(r => r.asin))).sort();
      const uniqueInvoices = Array.from(new Set(rawData.map(r => r.invoice_number))).sort();
      const uniqueMatchedPos = Array.from(new Set(rawData.map(r => r.matched_po))).sort();
      const uniqueMatchedAsins = Array.from(new Set(rawData.map(r => r.matched_asin))).sort();
      populateDatalist('invoice-asin-list', uniqueAsins);
      populateDatalist('invoice-number-list', uniqueInvoices);
      populateDatalist('invoice-matched-po-list', uniqueMatchedPos);
      populateDatalist('invoice-matched-asin-list', uniqueMatchedAsins);
    } else if (type === 'rebni') {
      const uniqueAsins = Array.from(new Set(rawData.map(r => r.asin))).sort();
      const uniquePos = Array.from(new Set(rawData.map(r => r.po))).sort();
      const uniqueWarehouses = Array.from(new Set(rawData.map(r => r.warehouse_id))).sort();
      populateDatalist('rebni-asin-list', uniqueAsins);
      populateDatalist('rebni-po-list', uniquePos);
      populateDatalist('rebni-warehouse-list', uniqueWarehouses);
    }
    
    const applyFilters = () => {
      const query = searchInput.value.toLowerCase().trim();
      const asinVal = asinFilter ? asinFilter.value.toLowerCase().trim() : '';
      const numberVal = numberFilter ? numberFilter.value.toLowerCase().trim() : '';
      const poVal = poFilter ? poFilter.value.toLowerCase().trim() : '';
      const warehouseVal = warehouseFilter ? warehouseFilter.value.toLowerCase().trim() : '';
      const matchedPoVal = matchedPoFilter ? matchedPoFilter.value.toLowerCase().trim() : '';
      const matchedAsinVal = matchedAsinFilter ? matchedAsinFilter.value.toLowerCase().trim() : '';
      const startDateVal = startDateFilter ? startDateFilter.value : '';
      const endDateVal = endDateFilter ? endDateFilter.value : '';

      filteredData = rawData.filter(row => {
        const matchesQuery = !query || Object.values(row).some(val => String(val).toLowerCase().includes(query));
        const matchesAsin = !asinVal || (row.asin && String(row.asin).toLowerCase().includes(asinVal));
        const matchesNumber = !numberVal || (row.invoice_number && String(row.invoice_number).toLowerCase().includes(numberVal));
        const matchesPo = !poVal || (row.po && String(row.po).toLowerCase().includes(poVal));
        const matchesWarehouse = !warehouseVal || (row.warehouse_id && String(row.warehouse_id).toLowerCase().includes(warehouseVal));
        const matchesMatchedPo = !matchedPoVal || (row.matched_po && String(row.matched_po).toLowerCase().includes(matchedPoVal));
        const matchesMatchedAsin = !matchedAsinVal || (row.matched_asin && String(row.matched_asin).toLowerCase().includes(matchedAsinVal));

        let matchesDateRange = true;
        if (type === 'rebni' && (startDateVal || endDateVal)) {
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

        return matchesQuery && matchesAsin && matchesNumber && matchesPo && matchesWarehouse && matchesMatchedPo && matchesMatchedAsin && matchesDateRange;
      });

      currentPage = 1;
      render();
    };

    searchInput.oninput = applyFilters;
    if (asinFilter) asinFilter.oninput = applyFilters;
    if (numberFilter) numberFilter.oninput = applyFilters;
    if (poFilter) poFilter.oninput = applyFilters;
    if (warehouseFilter) warehouseFilter.oninput = applyFilters;
    if (matchedPoFilter) matchedPoFilter.oninput = applyFilters;
    if (matchedAsinFilter) matchedAsinFilter.oninput = applyFilters;
    if (startDateFilter) {
      startDateFilter.oninput = applyFilters;
      startDateFilter.onchange = applyFilters;
    }
    if (endDateFilter) {
      endDateFilter.oninput = applyFilters;
      endDateFilter.onchange = applyFilters;
    }

    function sortData(key) {
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      
      filteredData.sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        
        // Handle numbers conversion
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          valA = numA;
          valB = numB;
        } else {
          valA = String(valA).toLowerCase();
          valB = String(valB).toLowerCase();
        }
        
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
      
      currentPage = 1;
      render();
    }

    function render() {
      if (filteredData.length === 0) {
        tableContainer.innerHTML = `
          <div class="empty-state">
            <p>No matching records found.</p>
          </div>
        `;
        paginationPanel.classList.add('hidden');
        return;
      }

      // Calculate pages
      const totalRecords = filteredData.length;
      const totalPages = Math.ceil(totalRecords / PAGE_SIZE);
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;
      
      const startIndex = (currentPage - 1) * PAGE_SIZE;
      const endIndex = Math.min(startIndex + PAGE_SIZE, totalRecords);
      const paginatedRows = filteredData.slice(startIndex, endIndex);

      // Build Table DOM
      const table = document.createElement('table');
      table.className = 'animate-fade-in';
      
      // Header
      const thead = document.createElement('thead');
      const trHead = document.createElement('tr');
      
      headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h.label;
        if (sortKey === h.key) {
          th.className = sortAsc ? 'sort-asc' : 'sort-desc';
        }
        th.onclick = () => sortData(h.key);
        trHead.appendChild(th);
      });
      thead.appendChild(trHead);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement('tbody');
      paginatedRows.forEach(row => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
          const td = document.createElement('td');
          td.textContent = row[h.key] !== undefined ? row[h.key] : '';
          if (h.isMono) {
            td.className = 'mono';
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      tableContainer.innerHTML = '';
      tableContainer.appendChild(table);

      // Render Pagination Panel
      paginationPanel.classList.remove('hidden');
      paginationPanel.innerHTML = `
        <div class="pagination-info">
          Showing <strong>${startIndex + 1}</strong> to <strong>${endIndex}</strong> of <strong>${totalRecords}</strong> records
        </div>
        <div class="pagination-controls">
          <button class="pagination-btn" id="${type}-prev" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
          <button class="pagination-btn" id="${type}-next" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
        </div>
      `;

      // Pagination Events
      document.getElementById(`${type}-prev`).onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          render();
        }
      };

      document.getElementById(`${type}-next`).onclick = () => {
        if (currentPage < totalPages) {
          currentPage++;
          render();
        }
      };
    }

    // First render
    render();
  }

  // ==========================================================================
  // Batch Investigation Scanner Table
  // ==========================================================================
  const BATCH_HEADERS = [
    { key: 'invoiceNumber', label: 'Invoice No.', isMono: true },
    { key: 'asin', label: 'ASIN', isMono: true },
    { key: 'po', label: 'PO ID', isMono: true },
    { key: 'warehouseId', label: 'Warehouse' },
    { key: 'status', label: 'Status' },
    { key: 'billed', label: 'Billed' },
    { key: 'received', label: 'Received' },
    { key: 'missingQty', label: 'Missing Qty' },
    { key: 'cp', label: 'CP Cost' }
  ];

  function initBatchTable(rawData) {
    const searchInput = document.getElementById(`batch-search-input`);
    const tableContainer = document.getElementById(`batch-table-container`);
    const paginationPanel = document.getElementById(`batch-pagination`);
    const invoiceFilterSelect = document.getElementById('batch-invoice-filter');
    const asinFilterSelect = document.getElementById('batch-asin-filter');
    const invoiceDatalist = document.getElementById('batch-invoice-list');
    const asinDatalist = document.getElementById('batch-asin-list');
    
    let filteredData = [...rawData];
    let sortKey = 'status';
    let sortAsc = true;
    let currentPage = 1;

    // Populate datalists dynamically based on unique values
    const invoices = Array.from(new Set(rawData.map(row => row.invoiceNumber).filter(Boolean))).sort();
    const asins = Array.from(new Set(rawData.map(row => row.asin).filter(Boolean))).sort();

    invoiceDatalist.innerHTML = '';
    invoices.forEach(inv => {
      const opt = document.createElement('option');
      opt.value = inv;
      invoiceDatalist.appendChild(opt);
    });

    asinDatalist.innerHTML = '';
    asins.forEach(asin => {
      const opt = document.createElement('option');
      opt.value = asin;
      asinDatalist.appendChild(opt);
    });
    
    searchInput.value = '';
    invoiceFilterSelect.value = '';
    asinFilterSelect.value = '';
    
    const applyFilters = () => {
      const query = searchInput.value.toLowerCase().trim();
      const invoiceFilterVal = invoiceFilterSelect.value.toLowerCase().trim();
      const asinFilterVal = asinFilterSelect.value.toLowerCase().trim();

      filteredData = rawData.filter(row => {
        const matchesQuery = !query || Object.values(row).some(val => String(val).toLowerCase().includes(query));
        const matchesInvoice = !invoiceFilterVal || String(row.invoiceNumber).toLowerCase().includes(invoiceFilterVal);
        const matchesAsin = !asinFilterVal || String(row.asin).toLowerCase().includes(asinFilterVal);
        return matchesQuery && matchesInvoice && matchesAsin;
      });

      currentPage = 1;
      render();
    };

    searchInput.oninput = applyFilters;
    invoiceFilterSelect.oninput = applyFilters;
    asinFilterSelect.oninput = applyFilters;

    function sortData(key) {
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      
      filteredData.sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          valA = numA;
          valB = numB;
        } else {
          valA = String(valA).toLowerCase();
          valB = String(valB).toLowerCase();
        }
        
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
      
      currentPage = 1;
      render();
    }

    function render() {
      if (filteredData.length === 0) {
        tableContainer.innerHTML = `
          <div class="empty-state">
            <p>No matching batch results found.</p>
          </div>
        `;
        paginationPanel.classList.add('hidden');
        return;
      }

      const totalRecords = filteredData.length;
      const totalPages = Math.ceil(totalRecords / PAGE_SIZE);
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;
      
      const startIndex = (currentPage - 1) * PAGE_SIZE;
      const endIndex = Math.min(startIndex + PAGE_SIZE, totalRecords);
      const paginatedRows = filteredData.slice(startIndex, endIndex);

      const table = document.createElement('table');
      table.className = 'animate-fade-in batch-scanner-table';
      
      const thead = document.createElement('thead');
      const trHead = document.createElement('tr');
      
      BATCH_HEADERS.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h.label;
        if (sortKey === h.key) {
          th.className = sortAsc ? 'sort-asc' : 'sort-desc';
        }
        th.onclick = () => sortData(h.key);
        trHead.appendChild(th);
      });
      
      const thAction = document.createElement('th');
      thAction.textContent = 'Actions';
      trHead.appendChild(thAction);
      
      thead.appendChild(trHead);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      paginatedRows.forEach(row => {
        const tr = document.createElement('tr');
        BATCH_HEADERS.forEach(h => {
          const td = document.createElement('td');
          
          if (h.key === 'status') {
            let badgeClass = 'badge-info';
            if (row[h.key] === 'Interfaced/Matched') badgeClass = 'badge-success';
            else if (row[h.key] === 'Matched (No Discrepancy)') badgeClass = 'badge-primary';
            else if (row[h.key].includes('Discrepancy') || row[h.key].includes('Mismatch')) badgeClass = 'badge-danger';
            else if (row[h.key].includes('No REBNI') || row[h.key].includes('0 Matches') || row[h.key].includes('Unmatched')) badgeClass = 'badge-danger';
            
            td.innerHTML = `<span class="status-pill ${badgeClass}">${row[h.key]}</span>`;
          } else if (h.key === 'cp') {
            td.textContent = Number(row[h.key]).toFixed(2);
          } else {
            td.textContent = row[h.key] !== undefined ? row[h.key] : '';
          }

          if (h.isMono) {
            td.className = 'mono';
          }
          tr.appendChild(td);
        });

        const tdAction = document.createElement('td');
        const runBtn = document.createElement('button');
        runBtn.className = 'secondary-btn btn-sm run-audit-btn';
        runBtn.textContent = 'Run Audit';
        runBtn.onclick = () => {
          engineInvoiceInput.value = row.invoiceNumber;
          engineAsinInput.value = row.asin;
          engineWarehouseInput.value = row.warehouseId || '';
          engineMissingQtyInput.value = row.missingQty || '';
          engineCpInput.value = row.cp ? String(row.cp) : '';
          enginePoInput.value = row.po || '';
          
          // Trigger form submit
          engineForm.dispatchEvent(new Event('submit'));
          
          // Scroll down to detailed results section
          document.getElementById('engine-runner-section').scrollIntoView({ behavior: 'smooth' });
        };
        tdAction.appendChild(runBtn);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      tableContainer.innerHTML = '';
      tableContainer.appendChild(table);

      paginationPanel.classList.remove('hidden');
      paginationPanel.innerHTML = `
        <div class="pagination-info">
          Showing <strong>${startIndex + 1}</strong> to <strong>${endIndex}</strong> of <strong>${totalRecords}</strong> records
        </div>
        <div class="pagination-controls">
          <button class="pagination-btn" id="batch-prev" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
          <button class="pagination-btn" id="batch-next" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
        </div>
      `;

      document.getElementById('batch-prev').onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          render();
        }
      };

      document.getElementById('batch-next').onclick = () => {
        if (currentPage < totalPages) {
          currentPage++;
          render();
        }
      };
    }

    render();
  }

  // ==========================================================================
  // Phase 2: Engine Data Populator & Runners
  // ==========================================================================
  function populateEngineInputs() {
    // 1. Extract unique warehouse IDs
    const warehouses = new Set();
    rebniData.forEach(r => {
      if (r.warehouse_id) warehouses.add(r.warehouse_id.trim());
    });
    
    // Populate autocomplete datalist
    const sortedWarehouses = Array.from(warehouses).sort();
    engineWarehouseList.innerHTML = '';
    sortedWarehouses.forEach(wh => {
      const option = document.createElement('option');
      option.value = wh;
      engineWarehouseList.appendChild(option);
    });

    // 2. Extract unique invoice numbers
    const invoices = new Set();
    invoiceData.forEach(r => {
      if (r.invoice_number) invoices.add(r.invoice_number.trim());
    });

    const sortedInvoices = Array.from(invoices).sort();
    const engineInvoiceList = document.getElementById('invoice-list');
    if (engineInvoiceList) {
      engineInvoiceList.innerHTML = '';
      sortedInvoices.forEach(inv => {
        const option = document.createElement('option');
        option.value = inv;
        engineInvoiceList.appendChild(option);
      });
    }

    // 3. Extract unique ASINs
    const asins = new Set();
    invoiceData.forEach(r => {
      if (r.asin) asins.add(r.asin.trim());
    });
    rebniData.forEach(r => {
      if (r.asin) asins.add(r.asin.trim());
    });
    const sortedAsins = Array.from(asins).sort();
    if (engineAsinList) {
      engineAsinList.innerHTML = '';
      sortedAsins.forEach(asin => {
        const option = document.createElement('option');
        option.value = asin;
        engineAsinList.appendChild(option);
      });
    }

    // Hide previous results and show engine runner panel
    engineResultsSection.classList.add('hidden');
    engineRunnerSection.classList.remove('hidden');
    engineError.classList.add('hidden');
    engineForm.reset();
  }

  let activeAsinResults = [];
  let currentActiveAsin = '';

  engineForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    engineError.classList.add('hidden');
    engineError.textContent = '';

    const invoiceNumber = engineInvoiceInput.value.trim();
    const asin = engineAsinInput.value.trim();

    if (!invoiceNumber) {
      engineError.textContent = 'Please enter Invoice Number(s).';
      engineError.classList.remove('hidden');
      return;
    }
    if (!asin) {
      engineError.textContent = 'Please enter ASIN(s).';
      engineError.classList.remove('hidden');
      return;
    }

    // UI Loading State
    runEngineBtn.disabled = true;
    engineBtnSpinner.style.display = 'inline-block';
    runEngineBtn.querySelector('.btn-text').textContent = 'Running Engine...';
    engineResultsSection.classList.add('hidden');

    try {
      const response = await fetch('/api/investigate/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          invoiceNumber,
          asin,
          missingQty: engineMissingQtyInput.value.trim(),
          cp: engineCpInput.value.trim(),
          warehouseId: engineWarehouseInput.value.trim(),
          receivedDate: engineReceivedDateInput.value.trim(),
          shipmentId: engineShipmentInput.value.trim(),
          po: enginePoInput.value.trim()
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to run investigation engine.');
      }

      activeAsinResults = result.asinResults || [];
      const combinedBlurb = result.combinedBlurb || '';

      if (activeAsinResults.length === 0) {
        throw new Error('No ASIN results found.');
      }

      // Show results grid
      engineResultsSection.classList.remove('hidden');
      renderAsinTabs(combinedBlurb);

    } catch (error) {
      console.error(error);
      engineError.textContent = error.message;
      engineError.classList.remove('hidden');
    } finally {
      runEngineBtn.disabled = false;
      engineBtnSpinner.style.display = 'none';
      runEngineBtn.querySelector('.btn-text').textContent = '🚀 Investigate (HUBs)';
    }
  });

  // Clear Engine Form Button Handler
  if (clearEngineBtn) {
    clearEngineBtn.addEventListener('click', () => {
      engineForm.reset();
      engineResultsSection.classList.add('hidden');
      engineError.classList.add('hidden');
      engineError.textContent = '';
    });
  }

  function renderAsinTabs(combinedBlurb) {
    asinTabsList.innerHTML = '';

    // Create a special tab for the Combined Blurb
    const combinedTab = document.createElement('button');
    combinedTab.className = 'asin-tab active';
    combinedTab.innerHTML = `
      <span class="asin-code">✨ Combined Blurb</span>
      <span class="asin-badge primary">Combined</span>
    `;
    currentActiveAsin = '__combined__';

    combinedTab.onclick = () => {
      document.querySelectorAll('.asin-tab').forEach(t => t.classList.remove('active'));
      combinedTab.classList.add('active');
      currentActiveAsin = '__combined__';
      displayCombinedDetail(combinedBlurb);
    };
    asinTabsList.appendChild(combinedTab);
    
    // Create tabs for each evaluated ASIN
    activeAsinResults.forEach((asinRes) => {
      const tab = document.createElement('button');
      tab.className = 'asin-tab';

      // Set class based on result status
      let resultClass = 'info';
      if (asinRes.result === 'Resolved - Fully Processed') resultClass = 'success';
      else if (asinRes.result === 'Completed') resultClass = 'primary';
      else if (asinRes.result === 'Discrepancy Found') resultClass = 'danger';
      else if (asinRes.result === 'Paused') resultClass = 'warning';

      tab.innerHTML = `
        <span class="asin-code">${asinRes.asin}</span>
        <span class="asin-badge ${resultClass}">${asinRes.result}</span>
      `;

      tab.onclick = () => {
        document.querySelectorAll('.asin-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentActiveAsin = asinRes.asin;
        displayAsinDetail(asinRes);
      };

      asinTabsList.appendChild(tab);
    });

    // Default to the combined blurb
    displayCombinedDetail(combinedBlurb);
  }

  function displayCombinedDetail(combinedBlurb) {
    document.getElementById('card-invoice-number').textContent = engineInvoiceInput.value.trim();
    document.getElementById('card-asin').textContent = activeAsinResults.map(r => r.asin).join(', ');
    
    const pos = Array.from(new Set(activeAsinResults.map(r => r.po).filter(p => p && p !== 'N/A')));
    document.getElementById('card-po').textContent = pos.join(', ') || 'N/A';
    document.getElementById('card-warehouse').textContent = engineWarehouseInput.value.trim() || 'N/A';
    document.getElementById('card-status').textContent = 'Mixed Summary';

    const totalBilled = activeAsinResults.reduce((acc, r) => acc + (parseInt(r.billedQty) || 0), 0);
    const totalReceived = activeAsinResults.reduce((acc, r) => acc + (parseInt(r.receivedQty) || 0), 0);
    const totalMissing = activeAsinResults.reduce((acc, r) => acc + (parseInt(r.missingQty) || 0), 0);

    document.getElementById('card-billed-qty').textContent = totalBilled;
    document.getElementById('card-received-qty').textContent = totalReceived;
    document.getElementById('card-missing-qty').textContent = totalMissing;

    const badge = document.getElementById('asin-result-badge');
    badge.textContent = 'Combined';
    badge.className = 'result-badge primary';

    const headerIconContainer = document.getElementById('result-header-icon-container');
    headerIconContainer.className = 'header-icon info-icon';

    // Summary timeline
    const timelineList = document.getElementById('card-timeline-list');
    timelineList.innerHTML = '';

    const summaryTimeline = [
      `🔹 Started multi-item investigation process.`,
      `✔ Total ASINs evaluated: ${activeAsinResults.length}`,
      `✔ Fully Processed (Interfaced/Matched): ${activeAsinResults.filter(r => r.result.includes('Resolved') || r.result.includes('Completed')).length}`,
      `⚠️ Discrepancies / Anomalies Found: ${activeAsinResults.filter(r => r.result.includes('Discrepancy') || r.result.includes('Error')).length}`,
      `🔹 Combined findings compiled into a unified blurb below.`
    ];

    summaryTimeline.forEach(step => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      
      const isCheck = step.startsWith('✔');
      const isWarning = step.startsWith('⚠️');
      const isCross = step.startsWith('❌');

      let iconHtml = '🔹';
      let text = step;
      let itemClass = '';

      if (isCheck) {
        iconHtml = '<span class="step-icon check-icon">✔</span>';
        text = step.slice(1).trim();
        itemClass = 'step-success';
      } else if (isWarning) {
        iconHtml = '<span class="step-icon warn-icon">⚠️</span>';
        text = step.slice(1).trim();
        itemClass = 'step-warning';
      } else if (isCross) {
        iconHtml = '<span class="step-icon error-icon">❌</span>';
        text = step.slice(1).trim();
        itemClass = 'step-error';
      }

      item.innerHTML = `
        ${iconHtml}
        <span class="step-text">${text}</span>
      `;
      if (itemClass) item.classList.add(itemClass);
      timelineList.appendChild(item);
    });

    const blubPre = document.getElementById('card-blub-content');
    blubPre.textContent = combinedBlurb;

    copyBlubBtn.querySelector('.btn-text').textContent = 'Copy';
    copyBlubBtn.classList.remove('success');

    // Aggregate mini tables for all ASINs in this run
    let allInvoiceRecords = [];
    let allRebniRecords = [];
    activeAsinResults.forEach(r => {
      if (r.invoiceRecords) allInvoiceRecords.push(...r.invoiceRecords);
      if (r.rebniRecords) allRebniRecords.push(...r.rebniRecords);
    });
    
    // Deduplicate records to keep display clean
    const uniqueInvoiceRecords = Array.from(new Map(allInvoiceRecords.map(item => [JSON.stringify(item), item])).values());
    const uniqueRebniRecords = Array.from(new Map(allRebniRecords.map(item => [JSON.stringify(item), item])).values());

    renderMiniTable('card-invoice-table-container', uniqueInvoiceRecords, INVOICE_HEADERS);
    renderMiniTable('card-rebni-table-container', uniqueRebniRecords, REBNI_HEADERS);
  }

  function displayAsinDetail(asinRes) {
    document.getElementById('card-invoice-number').textContent = asinRes.invoiceNumber;
    document.getElementById('card-asin').textContent = asinRes.asin;
    document.getElementById('card-po').textContent = asinRes.po;
    document.getElementById('card-warehouse').textContent = asinRes.warehouse;
    document.getElementById('card-status').textContent = asinRes.invoiceStatus;
    document.getElementById('card-billed-qty').textContent = asinRes.billedQty;
    document.getElementById('card-received-qty').textContent = asinRes.receivedQty;
    document.getElementById('card-missing-qty').textContent = asinRes.missingQty;

    const badge = document.getElementById('asin-result-badge');
    badge.textContent = asinRes.result;
    badge.className = 'result-badge';
    if (asinRes.result === 'Resolved - Fully Processed') badge.classList.add('success');
    else if (asinRes.result === 'Completed') badge.classList.add('primary');
    else if (asinRes.result === 'Discrepancy Found') badge.classList.add('danger');
    else if (asinRes.result === 'Paused') badge.classList.add('warning');

    const headerIconContainer = document.getElementById('result-header-icon-container');
    headerIconContainer.className = 'header-icon';
    if (asinRes.result === 'Resolved - Fully Processed' || asinRes.result === 'Completed') {
      headerIconContainer.classList.add('success-icon');
    } else if (asinRes.result === 'Discrepancy Found') {
      headerIconContainer.classList.add('warning-icon');
    } else {
      headerIconContainer.classList.add('info-icon');
    }

    const timelineList = document.getElementById('card-timeline-list');
    timelineList.innerHTML = '';
    asinRes.timeline.forEach(step => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      
      const isCheck = step.startsWith('✔');
      const isWarning = step.startsWith('⚠️');
      const isCross = step.startsWith('❌');

      let iconHtml = '🔹';
      let text = step;
      let itemClass = '';

      if (isCheck) {
        iconHtml = '<span class="step-icon check-icon">✔</span>';
        text = step.slice(1).trim();
        itemClass = 'step-success';
      } else if (isWarning) {
        iconHtml = '<span class="step-icon warn-icon">⚠️</span>';
        text = step.slice(1).trim();
        itemClass = 'step-warning';
      } else if (isCross) {
        iconHtml = '<span class="step-icon error-icon">❌</span>';
        text = step.slice(1).trim();
        itemClass = 'step-error';
      }

      item.innerHTML = `
        ${iconHtml}
        <span class="step-text">${text}</span>
      `;
      if (itemClass) item.classList.add(itemClass);
      timelineList.appendChild(item);
    });

    const blubPre = document.getElementById('card-blub-content');
    blubPre.textContent = asinRes.generatedBlub;

    copyBlubBtn.querySelector('.btn-text').textContent = 'Copy';
    copyBlubBtn.classList.remove('success');

    renderMiniTable('card-invoice-table-container', asinRes.invoiceRecords || [], INVOICE_HEADERS);
    renderMiniTable('card-rebni-table-container', asinRes.rebniRecords || [], REBNI_HEADERS);
  }

  // Copy Blub Event (supports copying combined or individual blurb)
  copyBlubBtn.addEventListener('click', () => {
    let blurbToCopy = '';
    if (currentActiveAsin === '__combined__') {
      blurbToCopy = document.getElementById('card-blub-content').textContent;
    } else {
      const activeRes = activeAsinResults.find(r => r.asin === currentActiveAsin);
      if (activeRes) blurbToCopy = activeRes.generatedBlub;
    }
    
    if (!blurbToCopy) return;

    navigator.clipboard.writeText(blurbToCopy).then(() => {
      copyBlubBtn.querySelector('.btn-text').textContent = 'Copied!';
      copyBlubBtn.classList.add('success');
      setTimeout(() => {
        copyBlubBtn.querySelector('.btn-text').textContent = 'Copy';
        copyBlubBtn.classList.remove('success');
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });

  // ==========================================================================
  // Render Mini Tables (Phase 2 Source Data)
  // ==========================================================================
  function renderMiniTable(containerId, records, headers) {
    const container = document.getElementById(containerId);
    if (!records || records.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No matching records found.</p></div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'animate-fade-in';

    // Header
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h.label;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    records.forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach(h => {
        const td = document.createElement('td');
        td.textContent = row[h.key] !== undefined ? row[h.key] : '';
        if (h.isMono) {
          td.className = 'mono';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);
  }

  // ==========================================================================
  // CSV Downloader Utility
  // ==========================================================================
  // Hook up download buttons
  const invoiceDownloadBtn = document.getElementById('invoice-download-btn');
  const rebniDownloadBtn = document.getElementById('rebni-download-btn');

  if (invoiceDownloadBtn) {
    invoiceDownloadBtn.addEventListener('click', () => {
      if (!invoiceData || invoiceData.length === 0) {
        alert("No data available to download.");
        return;
      }
      const query = document.getElementById('invoice-search-input').value;
      const asin = document.getElementById('invoice-asin-filter').value;
      const number = document.getElementById('invoice-number-filter').value;
      const matchedPo = document.getElementById('invoice-matched-po-filter').value;
      const matchedAsin = document.getElementById('invoice-matched-asin-filter').value;
      const params = new URLSearchParams({ query, asin, number, matchedPo, matchedAsin });
      window.location.href = `/api/download/invoice?${params.toString()}`;
    });
  }
  
  if (rebniDownloadBtn) {
    rebniDownloadBtn.addEventListener('click', () => {
      if (!rebniData || rebniData.length === 0) {
        alert("No data available to download.");
        return;
      }
      const query = document.getElementById('rebni-search-input').value;
      const asin = document.getElementById('rebni-asin-filter').value;
      const po = document.getElementById('rebni-po-filter').value;
      const warehouse = document.getElementById('rebni-warehouse-filter').value;
      const startDate = document.getElementById('rebni-start-date-filter').value;
      const endDate = document.getElementById('rebni-end-date-filter').value;
      const params = new URLSearchParams({ query, asin, po, warehouse, startDate, endDate });
      window.location.href = `/api/download/rebni?${params.toString()}`;
    });
  }

  // ==========================================================================
  // Start Application Ingest
  // ==========================================================================
  loadSellers();
  checkSession();
});
