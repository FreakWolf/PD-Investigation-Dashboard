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
  const engineInvoiceSelect = document.getElementById('invoice-select');
  const engineWarehouseInput = document.getElementById('warehouse-input');
  const engineWarehouseList = document.getElementById('warehouse-list');
  const runEngineBtn = document.getElementById('run-engine-btn');
  const engineBtnSpinner = document.getElementById('engine-btn-spinner');
  const engineError = document.getElementById('engine-error');
  
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
    
    // Clear and show search actions
    searchInput.value = '';
    actionPanel.classList.remove('hidden');
    
    // Set up search handler
    searchInput.oninput = () => {
      const query = searchInput.value.toLowerCase().trim();
      if (!query) {
        filteredData = [...rawData];
      } else {
        filteredData = rawData.filter(row => {
          return Object.values(row).some(val => String(val).toLowerCase().includes(query));
        });
      }
      currentPage = 1;
      render();
    };

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
  // Phase 2: Engine Data Populator & Runners
  // ==========================================================================
  function populateEngineInputs() {
    // 1. Extract unique invoice numbers
    const invoices = new Set();
    invoiceData.forEach(r => {
      if (r.invoice_number) invoices.add(r.invoice_number.trim());
    });
    
    // Sort and populate select dropdown
    const sortedInvoices = Array.from(invoices).sort();
    engineInvoiceSelect.innerHTML = '<option value="" disabled selected>Select Invoice</option>';
    sortedInvoices.forEach(inv => {
      const option = document.createElement('option');
      option.value = inv;
      option.textContent = inv;
      engineInvoiceSelect.appendChild(option);
    });

    // 2. Extract unique warehouse IDs
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

    const invoiceNumber = engineInvoiceSelect.value;
    const warehouseId = engineWarehouseInput.value.trim();

    if (!invoiceNumber) {
      engineError.textContent = 'Please select an Invoice Number.';
      engineError.classList.remove('hidden');
      return;
    }
    if (!warehouseId) {
      engineError.textContent = 'Please enter a Warehouse ID.';
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
        body: JSON.stringify({ invoiceNumber, warehouseId })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to run investigation engine.');
      }

      activeAsinResults = result.asinResults || [];
      if (activeAsinResults.length === 0) {
        throw new Error('No ASINs found to investigate under this invoice.');
      }

      // Show results grid
      engineResultsSection.classList.remove('hidden');
      renderAsinTabs();

    } catch (error) {
      console.error(error);
      engineError.textContent = error.message;
      engineError.classList.remove('hidden');
    } finally {
      runEngineBtn.disabled = false;
      engineBtnSpinner.style.display = 'none';
      runEngineBtn.querySelector('.btn-text').textContent = 'Run Engine';
    }
  });

  function renderAsinTabs() {
    asinTabsList.innerHTML = '';
    
    activeAsinResults.forEach((asinRes, idx) => {
      const tab = document.createElement('button');
      tab.className = 'asin-tab';
      if (idx === 0) {
        tab.classList.add('active');
        currentActiveAsin = asinRes.asin;
      }

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

    // Display first ASIN detail by default
    if (activeAsinResults.length > 0) {
      displayAsinDetail(activeAsinResults[0]);
    }
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

    // Result Badge
    const badge = document.getElementById('asin-result-badge');
    badge.textContent = asinRes.result;
    badge.className = 'result-badge'; // reset
    if (asinRes.result === 'Resolved - Fully Processed') badge.classList.add('success');
    else if (asinRes.result === 'Completed') badge.classList.add('primary');
    else if (asinRes.result === 'Discrepancy Found') badge.classList.add('danger');
    else if (asinRes.result === 'Paused') badge.classList.add('warning');

    // Header Icon class
    const headerIconContainer = document.getElementById('result-header-icon-container');
    headerIconContainer.className = 'header-icon';
    if (asinRes.result === 'Resolved - Fully Processed' || asinRes.result === 'Completed') {
      headerIconContainer.classList.add('success-icon');
    } else if (asinRes.result === 'Discrepancy Found') {
      headerIconContainer.classList.add('warning-icon');
    } else {
      headerIconContainer.classList.add('info-icon');
    }

    // Timeline checklist
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
      if (itemClass) {
        item.classList.add(itemClass);
      }
      timelineList.appendChild(item);
    });

    // Blub box
    const blubPre = document.getElementById('card-blub-content');
    blubPre.textContent = asinRes.generatedBlub;

    // Reset copy button
    copyBlubBtn.querySelector('.btn-text').textContent = 'Copy';
    copyBlubBtn.classList.remove('success');
  }

  // Copy Blub Event
  copyBlubBtn.addEventListener('click', () => {
    const activeRes = activeAsinResults.find(r => r.asin === currentActiveAsin);
    if (!activeRes || !activeRes.generatedBlub) return;

    navigator.clipboard.writeText(activeRes.generatedBlub).then(() => {
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
  // Start Application Ingest
  // ==========================================================================
  loadSellers();
});
