// admin.js
// Assumes API_BASE is defined in config-admin.js (same-origin on backend)

// Helper: always send session cookies to the backend for admin routes
function adminFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;

  return fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // =======================
  //  AUTH GUARD
  // =======================
  async function ensureAdminSession() {
    try {
      const res = await adminFetch("/admin/me");
      if (res.ok) return true;

      window.location.href = "/admin-login";
      return false;
    } catch (err) {
      console.error("Error checking admin session:", err);
      window.location.href = "/admin-login";
      return false;
    }
  }

  // =======================
  //  ELEMENT REFERENCES
  // =======================

  // --- Banner + popup ---
  const bannerForm = document.getElementById("banner-form");
  const bannerTextInput = document.getElementById("bannerText");
  const bannerVisibleCheckbox = document.getElementById("bannerVisible");
  const bannerStatusEl = document.getElementById("banner-status");

  // New popup controls (shop splash)
  const popupEnabledCheckbox = document.getElementById("popupEnabled");
  const popupModeSelect = document.getElementById("popupMode");
  const popupCustomTextInput = document.getElementById("popupCustomText");
  const popupStatusEl = document.getElementById("popup-status") || bannerStatusEl;

  // --- Shipping settings ---
  const shippingFlatRateInput = document.getElementById("shippingFlatRate");
  const freeShippingThresholdInput = document.getElementById("freeShippingThreshold");
  const shippingStatusEl = document.getElementById("shipping-status");

  // --- Orders table + section ---
  const refreshOrdersBtn = document.getElementById("refresh-orders");
  const ordersTbody = document.getElementById("orders-tbody");
  const ordersSection = document.getElementById("orders-section");
  const ordersToggleBtn = document.getElementById("orders-toggle-btn");

  // --- Archive download ---
  const archiveBtn = document.getElementById("archive-current-month");
  const archiveStatusEl = document.getElementById("archive-status");

  // --- Products / inventory flags ---
  const flagsTbody =
    document.getElementById("flags-tbody") || document.getElementById("products-tbody");
  const flagsStatusEl =
    document.getElementById("flags-status") || document.getElementById("products-status");
  const saveFlagsBtn =
    document.getElementById("save-flags-btn") || document.getElementById("save-products");
  const flagsSection = document.getElementById("flags-section");
  const flagsToggleBtn = document.getElementById("flags-toggle-btn");
  const flagsSearchInput = document.getElementById("flags-search");
  const flagsSubcatFilter = document.getElementById("flags-filter-subcat");

  // --- Catalog / Inventory sync buttons ---
  const syncCatalogBtn = document.getElementById("btn-sync-catalog");
  const syncInventoryBtn = document.getElementById("btn-sync-inventory");
  const syncStatusEl = document.getElementById("sync-status");

  // --- Barcode / Inventory Management section + controls ---
  const barcodeSection = document.getElementById("barcode-section");
  const barcodeToggleBtn = document.getElementById("barcode-toggle-btn");
  const barcodeSearchInput = document.getElementById("barcode-search");
  const barcodeSubcatFilter = document.getElementById("barcode-filter-subcat");
  const barcodeShowZeroCheckbox = document.getElementById("barcode-show-zero");
  const barcodeRefreshBtn = document.getElementById("barcode-refresh-btn");
  const barcodePrintSelectedBtn = document.getElementById("barcode-print-selected-btn");
  const barcodeStatusEl = document.getElementById("barcode-status");
  const barcodeProductsContainer = document.getElementById("barcode-products-container");

  // Dedicated scan display/input box at top of barcode section (optional)
  const barcodeScanInput = document.getElementById("barcode-scan-input");

  // Output mode checkbox
  const barcodePrintToLabelCheckbox = document.getElementById("barcode-print-to-label");
  // (kept for compatibility; not used right now)
  const barcodeDownloadPdfCheckbox = document.getElementById("barcode-download-pdf");

  const barcodeApplyInventoryBtn = document.getElementById("barcode-apply-inventory-btn");

  // ===================== INACTIVITY AUTO-LOGOUT =====================
  const INACTIVITY_DEFAULT_MS = 15 * 60 * 1000; // 15 minutes
  const INACTIVITY_EXTENDED_MS = 4 * 60 * 60 * 1000; // 4 hours

  const timeoutToggle = document.getElementById("extend-timeout-toggle");
  let inactivityTimerId = null;

  function getCurrentTimeoutDuration() {
    if (timeoutToggle && timeoutToggle.checked) return INACTIVITY_EXTENDED_MS;
    return INACTIVITY_DEFAULT_MS;
  }

  function scheduleInactivityLogout() {
    if (inactivityTimerId) clearTimeout(inactivityTimerId);
    inactivityTimerId = setTimeout(handleInactivityLogout, getCurrentTimeoutDuration());
  }

  async function handleInactivityLogout() {
    try {
      await adminFetch("/admin/logout", { method: "POST" });
    } catch (err) {
      console.error("Auto-logout request failed:", err);
    } finally {
      window.location.href = "/admin-login";
    }
  }

  ["click", "keydown", "mousemove", "scroll", "touchstart", "touchmove"].forEach((evt) => {
    window.addEventListener(evt, scheduleInactivityLogout, { passive: true });
  });

  if (timeoutToggle) {
    timeoutToggle.addEventListener("change", scheduleInactivityLogout);
  }

  // =======================
  //  DATA STORES
  // =======================

  // Latest products from /admin/products
  let adminProducts = [];

  // Latest products from /admin/barcode-products
  let barcodeProductsRaw = [];

  // Scan-based counted qty per SKU (delta to send to Square)
  const scanCountsBySku = {};

  // Persist “selected for label print” across searching/filtering/re-render
  const selectedBarcodeSkus = new Set();

  // Persist “labels to print” qty per SKU across searching/filtering/re-render
  const labelQtyBySku = {};

  // Quick lookup: scanned code (barcode or SKU) -> canonical SKU
  let scanSkuIndex = {};

  function rebuildScanSkuIndex() {
    scanSkuIndex = {};
    (barcodeProductsRaw || []).forEach((p) => {
      const vars = Array.isArray(p.variations) ? p.variations : [];
      vars.forEach((v) => {
        if (!v) return;
        const sku = v.sku || "";
        if (sku) scanSkuIndex[sku] = sku;

        // If backend ever gives a separate barcode/UPC, map that too
        const barcode = v.barcode || v.upc || v.barcodeValue;
        if (barcode) scanSkuIndex[barcode] = sku || barcode;
      });
    });
  }

  function resolveSkuFromScan(codeRaw) {
    const raw = (codeRaw || "").trim();
    if (!raw) return null;

    if (!barcodeProductsRaw || !barcodeProductsRaw.length) return null;

    if (scanSkuIndex[raw]) return scanSkuIndex[raw];

    for (const p of barcodeProductsRaw) {
      const vars = Array.isArray(p.variations) ? p.variations : [];
      for (const v of vars) {
        if (v && typeof v.sku === "string" && v.sku === raw) return v.sku;
      }
    }
    return null;
  }

  // =======================
  //  HELPERS
  // =======================
  function showStatus(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "red" : "#000000";
  }

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function playScanBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      if (ctx.state === "suspended" && ctx.resume) {
        ctx.resume().catch(() => {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close().catch(() => {});
      }, 80);
    } catch (_) {}
  }

  // Find a variant by SKU in barcodeProductsRaw
  function findVariantBySku(sku) {
    const rawSku = (sku || "").trim();
    if (!rawSku) return null;

    for (const p of barcodeProductsRaw || []) {
      const vars = Array.isArray(p.variations) ? p.variations : [];
      for (const v of vars) {
        if (v && String(v.sku || "").trim() === rawSku) {
          return { product: p, variant: v };
        }
      }
    }
    return null;
  }

  // Ensure row is visible (expand variants) + scroll to it
  function scrollAndRevealSkuRow(sku) {
    if (!barcodeProductsContainer || !sku) return;

    const selectorSku =
      typeof CSS !== "undefined" && CSS.escape
        ? `.barcode-variant-row[data-sku="${CSS.escape(sku)}"]`
        : `.barcode-variant-row[data-sku="${sku}"]`;

    const row = barcodeProductsContainer.querySelector(selectorSku);
    if (!row) return;

    // Ensure variants container visible
    const productEl = row.closest(".barcode-product");
    if (productEl) {
      const variantsEl = productEl.querySelector(".barcode-variants");
      const toggleBtn = productEl.querySelector(".barcode-toggle");
      if (variantsEl) {
        const isHidden =
          variantsEl.style.display === "none" ||
          getComputedStyle(variantsEl).display === "none";

        if (isHidden) {
          variantsEl.style.display = "";
          if (toggleBtn) toggleBtn.textContent = "▾";
        }
      }
    }

    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Persistent highlighting:
  // - previous last becomes seen
  // - current becomes last
  function markRowAsLastScanned(row) {
    if (!barcodeProductsContainer || !row) return;

    const prevLast = barcodeProductsContainer.querySelector(
      ".barcode-variant-row.scan-last"
    );

    if (prevLast && prevLast !== row) {
      prevLast.classList.remove("scan-last");
      prevLast.classList.add("scan-seen");
    }

    row.classList.add("scan-last");
    row.classList.remove("scan-seen");
  }

  // Apply scanCountsBySku to any rendered rows
  function applyScanCountsToDom() {
    if (!barcodeProductsContainer) return;

    const rows = barcodeProductsContainer.querySelectorAll(".barcode-variant-row");
    rows.forEach((row) => {
      const sku = row.getAttribute("data-sku");
      if (!sku) return;

      const val = scanCountsBySku[sku];
      if (typeof val === "number" && Number.isFinite(val) && val !== 0) {
        const input = row.querySelector(".inv-count-input");
        if (input) input.value = String(val);
      }
    });
  }

  // Increment in-memory count for a SKU and update row if visible
  function bumpScanCountForSku(sku) {
    if (!sku) return 0;

    const current = Number(scanCountsBySku[sku] || 0);
    const nextVal = Number.isFinite(current) ? current + 1 : 1;
    scanCountsBySku[sku] = nextVal;

    // If row exists now, update input and highlight
    if (barcodeProductsContainer) {
      const selectorSku =
        typeof CSS !== "undefined" && CSS.escape
          ? `.barcode-variant-row[data-sku="${CSS.escape(sku)}"]`
          : `.barcode-variant-row[data-sku="${sku}"]`;

      const row = barcodeProductsContainer.querySelector(selectorSku);
      if (row) {
        const input = row.querySelector(".inv-count-input");
        if (input) input.value = String(nextVal);

        markRowAsLastScanned(row);
      }
    }

    // Always scroll/reveal if possible (after count update)
    scrollAndRevealSkuRow(sku);

    // Beep on successful scan
    playScanBeep();

    return nextVal;
  }

  // Helper: ensure row becomes renderable even if filters hide it
  function ensureRowVisibleThenScroll(sku) {
    if (!barcodeProductsContainer || !sku) return;

    const selectorSku =
      typeof CSS !== "undefined" && CSS.escape
        ? `.barcode-variant-row[data-sku="${CSS.escape(sku)}"]`
        : `.barcode-variant-row[data-sku="${sku}"]`;

    const exists = !!barcodeProductsContainer.querySelector(selectorSku);
    if (exists) {
      scrollAndRevealSkuRow(sku);
      return;
    }

    // Clear filters so row can render
    if (barcodeSearchInput) barcodeSearchInput.value = "";
    if (barcodeSubcatFilter) barcodeSubcatFilter.value = "";
    if (barcodeShowZeroCheckbox) barcodeShowZeroCheckbox.checked = true;

    applyBarcodeFiltersAndRender();

    // Wait a tick for DOM to render, then scroll/highlight
    setTimeout(() => {
      scrollAndRevealSkuRow(sku);
      const row = barcodeProductsContainer.querySelector(selectorSku);
      if (row) markRowAsLastScanned(row);
    }, 50);
  }

  // =======================
  //  BANNER + POPUP + SHIPPING CONFIG
  // =======================
  async function loadBannerConfig() {
    if (!bannerTextInput || !bannerVisibleCheckbox) return;

    try {
      const res = await fetch(`${API_BASE}/admin/config`);
      if (!res.ok) throw new Error("Failed to load banner config");

      const data = await res.json();

      bannerTextInput.value = data.bannerText || "";
      bannerVisibleCheckbox.checked = !!data.bannerVisible;

      if (popupEnabledCheckbox) popupEnabledCheckbox.checked = !!data.popupEnabled;
      if (popupModeSelect && typeof data.popupMode === "string") popupModeSelect.value = data.popupMode;
      if (popupCustomTextInput) popupCustomTextInput.value = data.popupCustomText || "";

      if (shippingFlatRateInput && data.shippingFlatRate != null) {
        shippingFlatRateInput.value = String(data.shippingFlatRate);
      }
      if (freeShippingThresholdInput && data.freeShippingThreshold != null) {
        freeShippingThresholdInput.value = String(data.freeShippingThreshold);
      }

      showStatus(bannerStatusEl, "Banner & popup loaded.", false);
      showStatus(shippingStatusEl, "Shipping settings loaded.", false);
    } catch (err) {
      console.error("Error loading banner config:", err);
      showStatus(bannerStatusEl, "Failed to load banner settings.", true);
      showStatus(shippingStatusEl, "Failed to load shipping settings.", true);
    }
  }

  async function saveBannerConfig(e) {
    e.preventDefault();
    if (!bannerTextInput || !bannerVisibleCheckbox) return;

    const payload = {
      bannerText: bannerTextInput.value || "",
      bannerVisible: bannerVisibleCheckbox.checked,
    };

    if (popupEnabledCheckbox) payload.popupEnabled = popupEnabledCheckbox.checked;
    if (popupModeSelect) payload.popupMode = popupModeSelect.value || "none";
    if (popupCustomTextInput) payload.popupCustomText = popupCustomTextInput.value || "";

    if (shippingFlatRateInput) {
      const v = parseFloat(shippingFlatRateInput.value);
      payload.shippingFlatRate = isNaN(v) ? 0 : v;
    }
    if (freeShippingThresholdInput) {
      const v = parseFloat(freeShippingThresholdInput.value);
      payload.freeShippingThreshold = isNaN(v) ? 0 : v;
    }

    showStatus(bannerStatusEl, "Saving...", false);
    showStatus(shippingStatusEl, "Saving shipping settings...", false);

    try {
      const res = await adminFetch("/admin/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save banner config");

      console.log("Saved banner/popup/shipping config:", data);
      showStatus(bannerStatusEl, "Settings saved.", false);
      showStatus(popupStatusEl, "Popup settings saved.", false);
      showStatus(shippingStatusEl, "Shipping settings saved.", false);
    } catch (err) {
      console.error("Error saving banner config:", err);
      showStatus(bannerStatusEl, "Failed to save banner settings.", true);
      showStatus(popupStatusEl, "Failed to save popup settings.", true);
      showStatus(shippingStatusEl, "Failed to save shipping settings.", true);
    }
  }

  // =======================
  //  ORDERS TABLE
  // =======================
  function renderOrdersTable(orders) {
    if (!ordersTbody) return;

    if (!Array.isArray(orders) || orders.length === 0) {
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="7">No orders found.</td>
        </tr>
      `;
      return;
    }

    const rowsHtml = orders
      .map((order) => {
        const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString() : "-";
        const totalStr = typeof order.total === "number" ? `$${order.total.toFixed(2)}` : "-";
        const customerLabel = order.customerName || order.customerEmail || "-";
        const statusValue = order.status || "PENDING";
        const trackingValue = order.trackingNumber || "";

        return `
          <tr data-order-id="${order.id}">
            <td>${dateStr}</td>
            <td>${customerLabel}</td>
            <td>${totalStr}</td>
            <td>
              <select class="order-status-input">
                <option value="PENDING" ${statusValue === "PENDING" ? "selected" : ""}>PENDING</option>
                <option value="PAID" ${statusValue === "PAID" ? "selected" : ""}>PAID</option>
                <option value="SHIPPED" ${statusValue === "SHIPPED" ? "selected" : ""}>SHIPPED</option>
                <option value="CANCELLED" ${statusValue === "CANCELLED" ? "selected" : ""}>CANCELLED</option>
                <option value="ARCHIVED" ${statusValue === "ARCHIVED" ? "selected" : ""}>ARCHIVED</option>
              </select>
            </td>
            <td>
              <input
                type="text"
                class="order-tracking-input"
                placeholder="Tracking #"
                value="${trackingValue.replace(/"/g, "&quot;")}"
              />
            </td>
            <td>
              <button type="button" class="order-packing-btn">Packing List</button>
            </td>
            <td>
              <button type="button" class="order-save-btn">Save</button>
            </td>
          </tr>
        `;
      })
      .join("");

    ordersTbody.innerHTML = rowsHtml;
  }

  async function loadOrders() {
    if (!ordersTbody) return;

    ordersTbody.innerHTML = `
      <tr>
        <td colspan="7">Loading orders…</td>
      </tr>
    `;

    try {
      const res = await adminFetch("/admin/orders");

      if (res.status === 401) {
        ordersTbody.innerHTML = `
          <tr>
            <td colspan="7">Not authorized. Please log in again.</td>
          </tr>
        `;
        return;
      }

      if (!res.ok) throw new Error("Failed to load orders");

      const data = await res.json();
      console.log("Loaded admin orders:", data);
      renderOrdersTable(data.orders || []);
    } catch (err) {
      console.error("Error loading orders:", err);
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="7">Error loading orders.</td>
        </tr>
      `;
    }
  }

  if (ordersTbody) {
    ordersTbody.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const row = target.closest("tr");
      if (!row) return;

      const orderId = row.getAttribute("data-order-id");
      if (!orderId) return;

      if (target.classList.contains("order-packing-btn")) {
        const url = `${API_BASE}/admin/orders/${orderId}/packing-slip`;
        window.open(url, "_blank");
        return;
      }

      if (!target.classList.contains("order-save-btn")) return;

      const statusSelect = row.querySelector(".order-status-input");
      const trackingInput = row.querySelector(".order-tracking-input");

      const status = statusSelect ? statusSelect.value : undefined;
      const trackingNumber = trackingInput ? trackingInput.value : "";

      const originalText = target.textContent;
      target.disabled = true;
      target.textContent = "Saving...";

      try {
        const res = await adminFetch(`/admin/orders/${orderId}`, {
          method: "PUT",
          body: JSON.stringify({ status, trackingNumber, notifyCustomer: false }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error("Failed to update order:", data);
          target.textContent = "Error";
          setTimeout(() => {
            target.textContent = originalText;
            target.disabled = false;
          }, 1500);
          return;
        }

        console.log("Order updated:", data);
        target.textContent = "Saved";

        if (status === "ARCHIVED") await loadOrders();

        setTimeout(() => {
          target.textContent = originalText;
          target.disabled = false;
        }, 1200);
      } catch (err) {
        console.error("Error updating order:", err);
        target.textContent = "Error";
        setTimeout(() => {
          target.textContent = originalText;
          target.disabled = false;
        }, 1500);
      }
    });
  }

  // =======================
  //  ARCHIVE DOWNLOAD
  // =======================
  function downloadOrderArchive() {
    if (archiveStatusEl) {
      showStatus(
        archiveStatusEl,
        "Preparing archive download… (your browser should prompt to save a ZIP file)",
        false
      );
    }
    window.open(`${API_BASE}/admin/orders/archive-download`, "_blank");
  }

  // =======================
  //  PRODUCTS / FLAGS UI
  // =======================
  function renderProductsTable(products) {
    if (!flagsTbody) return;

    if (!Array.isArray(products) || products.length === 0) {
      flagsTbody.innerHTML = `
        <tr>
          <td colspan="7">No products found.</td>
        </tr>
      `;
      return;
    }

    const rowsHtml = products
      .map((p) => {
        const flags = p.flags || {};
        const totalInv = typeof p.totalInventory === "number" ? p.totalInventory : 0;

        const ribbonType = flags.ribbonType || "none";
        const ribbonText = flags.ribbonCustomText || "";

        return `
  <tr data-product-id="${p.id}">
    <td class="prod-name">${p.name}</td>
    <td class="prod-subcat">${p.subcategory || "-"}</td>
    <td class="prod-inv">${totalInv}</td>

    <td class="prod-flags">
      <label class="flag-pill">
        <input type="checkbox" class="flag-pinToTop" ${flags.pinToTop ? "checked" : ""} />
        Pin to top
      </label>
    </td>

    <td class="prod-hide-online">
      <label class="flag-pill">
        <input type="checkbox" class="flag-hideOnline" ${flags.hideOnline ? "checked" : ""} />
        Hide Online
      </label>
    </td>

    <td class="prod-hide-kiosk">
      <label class="flag-pill">
        <input type="checkbox" class="flag-hideKiosk" ${flags.hideKiosk ? "checked" : ""} />
        Hide Kiosk
      </label>
    </td>

    <td class="prod-ribbon">
      <select class="flag-ribbonType">
        <option value="none" ${ribbonType === "none" ? "selected" : ""}>No ribbon</option>
        <option value="new" ${ribbonType === "new" ? "selected" : ""}>New</option>
        <option value="featured" ${ribbonType === "featured" ? "selected" : ""}>Featured</option>
        <option value="custom" ${ribbonType === "custom" ? "selected" : ""}>Custom</option>
      </select>
      <input
        type="text"
        class="flag-ribbonCustomText"
        placeholder="Custom ribbon text"
        value="${ribbonText.replace(/"/g, "&quot;")}"
      />
    </td>
  </tr>
`;
      })
      .join("");

    flagsTbody.innerHTML = rowsHtml;
  }

  function applyFlagsFiltersAndRender() {
    if (!flagsTbody) return;

    const query = (flagsSearchInput?.value || "").trim().toLowerCase();
    const subcatFilter = (flagsSubcatFilter?.value || "").trim().toLowerCase();

    const filtered = (adminProducts || []).filter((p) => {
      if (!p) return false;

      const name = (p.name || "").toLowerCase();
      const subcat = (p.subcategory || "").toLowerCase();

      const matchesSearch = !query || name.includes(query) || subcat.includes(query);
      const matchesSubcat = !subcatFilter || (subcat && subcat === subcatFilter);

      return matchesSearch && matchesSubcat;
    });

    renderProductsTable(filtered);
  }

  async function loadAdminProducts() {
    if (!flagsTbody) return;

    flagsTbody.innerHTML = `
      <tr>
        <td colspan="7">Loading products…</td>
      </tr>
    `;

    showStatus(flagsStatusEl, "Loading products...", false);

    try {
      const res = await adminFetch("/admin/products");

      if (res.status === 401) {
        flagsTbody.innerHTML = `
          <tr>
            <td colspan="7">Not authorized. Please log in again.</td>
          </tr>
        `;
        showStatus(flagsStatusEl, "Not authorized. Please log in again.", true);
        return;
      }

      if (!res.ok) throw new Error("Failed to load admin products");

      const data = await res.json();
      adminProducts = Array.isArray(data.products) ? data.products : [];
      console.log("Loaded admin products:", adminProducts);

      if (flagsSubcatFilter) {
        const subcats = new Set();
        adminProducts.forEach((p) => {
          if (p.subcategory) subcats.add(p.subcategory);
        });

        const currentValue = flagsSubcatFilter.value;
        flagsSubcatFilter.innerHTML =
          '<option value="">All subcategories</option>' +
          Array.from(subcats)
            .sort()
            .map((s) => `<option value="${s}">${s}</option>`)
            .join("");

        if (currentValue) flagsSubcatFilter.value = currentValue;
      }

      applyFlagsFiltersAndRender();
      showStatus(flagsStatusEl, "Products loaded.", false);
    } catch (err) {
      console.error("Error loading admin products:", err);
      flagsTbody.innerHTML = `
        <tr>
          <td colspan="7">Error loading products.</td>
        </tr>
      `;
      showStatus(flagsStatusEl, "Error loading products.", true);
    }
  }

  async function saveAdminProducts() {
    if (!flagsTbody) return;

    showStatus(flagsStatusEl, "Saving product flags...", false);

    const rows = flagsTbody.querySelectorAll("tr[data-product-id]");
    const updates = [];

    rows.forEach((row) => {
      const id = row.getAttribute("data-product-id");
      if (!id) return;

      const pinToTopEl = row.querySelector(".flag-pinToTop");
      const hideOnlineEl = row.querySelector(".flag-hideOnline");
      const hideKioskEl = row.querySelector(".flag-hideKiosk");
      const ribbonTypeEl = row.querySelector(".flag-ribbonType");
      const ribbonTextEl = row.querySelector(".flag-ribbonCustomText");

      const ribbonType = ribbonTypeEl ? ribbonTypeEl.value || "none" : "none";
      const ribbonCustomText = ribbonTextEl ? ribbonTextEl.value || "" : "";

      const flags = {
        isNew: ribbonType === "new",
        isFeatured: ribbonType === "featured",
        pinToTop: !!(pinToTopEl && pinToTopEl.checked),
        hideOnline: !!(hideOnlineEl && hideOnlineEl.checked),
        hideKiosk: !!(hideKioskEl && hideKioskEl.checked),
        ribbonType,
        ribbonCustomText,
      };

      updates.push({ id, flags });
    });

    try {
      const res = await adminFetch("/admin/products", {
        method: "PUT",
        body: JSON.stringify({ products: updates }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showStatus(flagsStatusEl, data.error || "Failed to save product flags.", true);
        return;
      }

      console.log("Saved productConfig:", data);
      showStatus(flagsStatusEl, "Product flags saved.", false);
    } catch (err) {
      console.error("Error saving product flags:", err);
      showStatus(flagsStatusEl, "Error saving product flags.", true);
    }
  }

  // =======================
  //  CATALOG / INVENTORY SYNC
  // =======================
  async function callSyncEndpoint(path, label) {
    if (!syncStatusEl) return;

    showStatus(syncStatusEl, `${label}…`, false);

    try {
      const res = await adminFetch(path, { method: "POST", body: JSON.stringify({}) });

      if (res.status === 401) {
        showStatus(syncStatusEl, "Not authorized. Please log in again.", true);
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showStatus(syncStatusEl, data.error || `${label} failed.`, true);
        return;
      }

      console.log("Sync result:", data);
      showStatus(syncStatusEl, `${label} completed.`, false);
    } catch (err) {
      console.error("Sync error:", err);
      showStatus(syncStatusEl, `${label} failed (network error).`, true);
    }
  }

  // =======================
  //  BARCODE LABELS / INVENTORY
  // =======================
  function renderBarcodeProducts(products) {
    if (!barcodeProductsContainer) return;

    if (!Array.isArray(products) || products.length === 0) {
      barcodeProductsContainer.innerHTML = "<p>No products found for the current filters.</p>";
      return;
    }

    const html = products
      .map((p) => {
        const safeName = escapeHtml(p.name || "Unnamed product");
        const safeSubcat = escapeHtml(p.subcategory || "");

        const variations = Array.isArray(p.variations)
          ? [...p.variations].sort((a, b) => {
              const nameA = (a.name || "").toLowerCase();
              const nameB = (b.name || "").toLowerCase();
              if (nameA !== nameB) return nameA.localeCompare(nameB);

              const colorA = (a.color || "").toLowerCase();
              const colorB = (b.color || "").toLowerCase();
              if (colorA !== colorB) return colorA.localeCompare(colorB);

              const sizeA = (a.size || "").toLowerCase();
              const sizeB = (b.size || "").toLowerCase();
              if (sizeA !== sizeB) return sizeA.localeCompare(sizeB);

              const skuA = (a.sku || "").toLowerCase();
              const skuB = (b.sku || "").toLowerCase();
              return skuA.localeCompare(skuB);
            })
          : [];

        if (!variations.length) return "";

        const varsHtml = variations
          .map((v) => {
            const sku = v.sku || "";
            const safeSku = escapeHtml(sku);
            const vName = v.name || "";
            const safeVName = escapeHtml(vName);
            const color = v.color || "";
            const size = v.size || "";
            const safeColor = escapeHtml(color);
            const safeSize = escapeHtml(size);
            const qty =
              typeof v.quantity === "number" && !Number.isNaN(v.quantity) ? v.quantity : 0;

            const isChecked = sku && selectedBarcodeSkus.has(sku);
            const savedLabelQty =
              sku && Number.isFinite(Number(labelQtyBySku[sku])) ? Number(labelQtyBySku[sku]) : 1;

            // Apply persistent “seen/last” classes based on session scans
            const scannedVal = Number(scanCountsBySku[sku] || 0);
            const rowClassExtra = scannedVal > 0 ? " scan-seen" : "";

            return `
            <tr
              class="barcode-variant-row${rowClassExtra}"
              data-sku="${safeSku}"
              data-product-name="${safeName}"
            >
              <td>
                <input type="checkbox" class="barcode-variant-check" ${isChecked ? "checked" : ""} />
              </td>
              <td class="bc-variant-name">${safeVName}</td>
              <td class="bc-variant-sku">${safeSku || "-"}</td>
              <td class="bc-variant-color">${safeColor || "-"}</td>
              <td class="bc-variant-size">${safeSize || "-"}</td>
              <td class="bc-variant-stock">${qty}</td>
              <td>
                <input type="number" class="inv-count-input" min="0" step="1" style="width: 4rem;" />
              </td>
              <td>
                <input
                  type="number"
                  class="barcode-qty-input"
                  min="1"
                  step="1"
                  value="${savedLabelQty}"
                  style="width: 4rem;"
                />
              </td>
            </tr>
          `;
          })
          .join("");

        if (!varsHtml) return "";

        return `
        <div class="barcode-product" data-product-id="${p.id}">
          <div class="barcode-product-header">
            <button type="button" class="barcode-toggle" aria-label="Toggle variants">▾</button>
            <div class="barcode-product-title">
              <div class="barcode-product-name">${safeName}</div>
              <div class="barcode-product-subcat">${
                safeSubcat ? `Subcategory: ${safeSubcat}` : "&nbsp;"
              }</div>
            </div>
            <div class="barcode-product-actions">
              <label class="admin-checkbox">
                <input type="checkbox" class="barcode-product-check-all" />
                <span>Check all</span>
              </label>
            </div>
          </div>
          <div class="barcode-variants">
            <table class="admin-table barcode-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Variant</th>
                  <th>SKU</th>
                  <th>Color</th>
                  <th>Size</th>
                  <th>In-stock</th>
                  <th>Counted qty</th>
                  <th>Labels to print</th>
                </tr>
              </thead>
              <tbody>${varsHtml}</tbody>
            </table>
          </div>
        </div>
      `;
      })
      .join("");

    barcodeProductsContainer.innerHTML = html || "<p>No products found.</p>";

    applyScanCountsToDom();
  }

  function applyBarcodeFiltersAndRender() {
    if (!barcodeProductsContainer) return;

    const query = (barcodeSearchInput?.value || "").trim().toLowerCase();
    const showZero = barcodeShowZeroCheckbox ? barcodeShowZeroCheckbox.checked : true;
    const subcatFilter = (barcodeSubcatFilter?.value || "").trim().toLowerCase();

    const filteredProducts = (barcodeProductsRaw || [])
      .map((p) => {
        const baseMatchesName = !query || (p.name && p.name.toLowerCase().includes(query));
        const baseMatchesSubcat =
          !query || (p.subcategory && p.subcategory.toLowerCase().includes(query));

        const baseMatchesSubcatFilter =
          !subcatFilter || (p.subcategory && p.subcategory.toLowerCase() === subcatFilter);

        const variations = Array.isArray(p.variations) ? p.variations : [];

        const filteredVars = variations.filter((v) => {
          const vName = (v.name || "").toLowerCase();
          const vSku = (v.sku || "").toLowerCase();
          const vColor = (v.color || "").toLowerCase();
          const vSize = (v.size || "").toLowerCase();

          const searchMatches =
            (!query ||
              baseMatchesName ||
              baseMatchesSubcat ||
              vName.includes(query) ||
              vSku.includes(query) ||
              vColor.includes(query) ||
              vSize.includes(query)) &&
            baseMatchesSubcatFilter;

          if (!searchMatches) return false;

          if (!showZero) {
            const qty = typeof v.quantity === "number" && !Number.isNaN(v.quantity) ? v.quantity : 0;
            if (qty <= 0) return false;
          }

          return true;
        });

        if (!filteredVars.length) return null;

        return { ...p, variations: filteredVars };
      })
      .filter(Boolean);

    const sortedProducts = filteredProducts.sort((a, b) => {
      const subA = (a.subcategory || "").toLowerCase();
      const subB = (b.subcategory || "").toLowerCase();
      if (subA !== subB) return subA.localeCompare(subB);

      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });

    renderBarcodeProducts(sortedProducts);
  }

  async function loadBarcodeProducts() {
    if (!barcodeProductsContainer) return;

    barcodeProductsContainer.innerHTML = "<p>Loading products…</p>";
    showStatus(barcodeStatusEl, "Loading barcode products...", false);

    try {
      const res = await adminFetch("/admin/barcode-products");

      if (res.status === 401) {
        showStatus(barcodeStatusEl, "Not authorized. Please log in again.", true);
        barcodeProductsContainer.innerHTML = "<p>Not authorized. Please log in again.</p>";
        return;
      }

      if (!res.ok) throw new Error("Failed to load barcode products");

      const data = await res.json();
      barcodeProductsRaw = Array.isArray(data.products) ? data.products : [];
      console.log("Loaded barcode products:", barcodeProductsRaw);

      rebuildScanSkuIndex();

      if (barcodeSubcatFilter) {
        const subcats = new Set();
        barcodeProductsRaw.forEach((p) => {
          if (p.subcategory) subcats.add(p.subcategory);
        });

        const currentValue = barcodeSubcatFilter.value;
        barcodeSubcatFilter.innerHTML =
          '<option value="">All subcategories</option>' +
          Array.from(subcats)
            .sort()
            .map(
              (s) =>
                `<option value="${escapeHtml(s)}"${
                  currentValue === s ? " selected" : ""
                }>${escapeHtml(s)}</option>`
            )
            .join("");
      }

      applyBarcodeFiltersAndRender();
      showStatus(barcodeStatusEl, "Barcode products loaded.", false);
    } catch (err) {
      console.error("Error loading barcode products:", err);
      barcodeProductsContainer.innerHTML = "<p>Error loading barcode products.</p>";
      showStatus(barcodeStatusEl, "Error loading barcode products.", true);
    }
  }

  // Delegate clicks/changes/inputs inside barcode container
  if (barcodeProductsContainer) {
    barcodeProductsContainer.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("barcode-toggle")) {
        const productEl = target.closest(".barcode-product");
        if (!productEl) return;

        const variantsEl = productEl.querySelector(".barcode-variants");
        if (!variantsEl) return;

        const isHidden =
          variantsEl.style.display === "none" ||
          getComputedStyle(variantsEl).display === "none";

        variantsEl.style.display = isHidden ? "" : "none";
        target.textContent = isHidden ? "▾" : "▸";
      }
    });

    barcodeProductsContainer.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("barcode-variant-check")) {
        const row = target.closest(".barcode-variant-row");
        if (!row) return;

        const sku = row.getAttribute("data-sku") || "";
        if (!sku) return;

        if (target.checked) selectedBarcodeSkus.add(sku);
        else selectedBarcodeSkus.delete(sku);
        return;
      }

      if (target.classList.contains("barcode-product-check-all")) {
        const productEl = target.closest(".barcode-product");
        if (!productEl) return;

        const checks = productEl.querySelectorAll(".barcode-variant-check");
        checks.forEach((cb) => {
          cb.checked = target.checked;

          const row = cb.closest(".barcode-variant-row");
          const sku = row ? row.getAttribute("data-sku") || "" : "";
          if (!sku) return;

          if (target.checked) selectedBarcodeSkus.add(sku);
          else selectedBarcodeSkus.delete(sku);
        });
        return;
      }
    });

    barcodeProductsContainer.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("barcode-qty-input")) {
        const row = target.closest(".barcode-variant-row");
        if (!row) return;

        const sku = row.getAttribute("data-sku") || "";
        if (!sku) return;

        const n = parseInt(target.value, 10);
        labelQtyBySku[sku] = Number.isFinite(n) && n > 0 ? n : 1;
      }
    });
  }

  async function handleBarcodePrintSelected() {
    if (!barcodeProductsContainer) return;

    const selectedSkus = Array.from(selectedBarcodeSkus);

    if (!selectedSkus.length) {
      showStatus(
        barcodeStatusEl,
        "No variants are selected. Check at least one row (selection persists across searches).",
        true
      );
      return;
    }

    const items = [];

    selectedSkus.forEach((sku) => {
      const found = findVariantBySku(sku);
      if (!found) return;

      const { product, variant } = found;

      const productName = product?.name || "";
      const variantName = variant?.name || "";
      const color = variant?.color || "";
      const size = variant?.size || "";

      const qty = Number.isFinite(Number(labelQtyBySku[sku]))
        ? Math.max(1, parseInt(labelQtyBySku[sku], 10))
        : 1;

      const labelParts = [];
      if (productName) labelParts.push(productName);
      const detailParts = [variantName, color, size].filter(Boolean);
      if (detailParts.length) labelParts.push(detailParts.join(" "));

      const labelText = labelParts.join(" - ").trim() || sku || "Label";

      items.push({ sku: sku || null, labelText, quantity: qty });
    });

    if (!items.length) {
      showStatus(barcodeStatusEl, "No valid items collected for barcode generation.", true);
      return;
    }

    if (barcodePrintToLabelCheckbox && !barcodePrintToLabelCheckbox.checked) {
      showStatus(barcodeStatusEl, "Check 'Print to label printer' before printing labels.", true);
      return;
    }

    showStatus(barcodeStatusEl, "Sending labels to printer…", false);

    try {
      const res = await adminFetch("/admin/generate-barcodes", {
        method: "POST",
        body: JSON.stringify({ items, mode: "print" }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.error) {
        console.error("Barcode generation/print failed:", data);
        showStatus(
          barcodeStatusEl,
          data && data.error ? `Failed to print labels: ${data.error}` : "Failed to print labels.",
          true
        );
        return;
      }

      console.log("Barcode print result:", data);
      showStatus(barcodeStatusEl, data.message || "Labels processed and sent to label printer.", false);
    } catch (err) {
      console.error("Error generating barcode labels:", err);
      showStatus(barcodeStatusEl, "Error generating barcode labels (network or server error).", true);
    }
  }

  // =======================
  //  BARCODE SCAN → COUNTED QTY
  // =======================
  (function initBarcodeScanToCount() {
    let scanBuffer = "";
    let lastEventTime = 0;

    // Some scanners are slower; 220ms works better than 120ms
    const SCAN_RESET_MS = 220;

    // Prime audio once (helps Chrome allow beep)
    let audioPrimed = false;
    function primeAudioOnce() {
      if (audioPrimed) return;
      audioPrimed = true;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        ctx.resume?.().finally(() => ctx.close().catch(() => {}));
      } catch (_) {}
    }
    window.addEventListener("click", primeAudioOnce, { once: true });
    window.addEventListener("keydown", primeAudioOnce, { once: true });

    function isTextArea(el) {
      return !!el && el.tagName && el.tagName.toLowerCase() === "textarea";
    }

    function isInputLike(el) {
      if (!el || !el.tagName) return false;
      if (barcodeScanInput && el === barcodeScanInput) return false; // allow scanner box
      const tag = el.tagName.toLowerCase();
      if (tag !== "input") return false;
      const type = (el.getAttribute("type") || "").toLowerCase();
      return type === "text" || type === "number" || type === "search" || type === "email" || type === "tel";
    }

    function handleScanComplete(codeRaw) {
      const raw = (codeRaw || "").trim();
      if (!raw) return;

      const sku = resolveSkuFromScan(raw);
      if (!sku) {
        showStatus(
          barcodeStatusEl,
          `Scanned "${raw}" but it doesn't match any SKU in the current list.`,
          true
        );
        return;
      }

      // Ensure it can be shown (clear filters if needed), then increment
      ensureRowVisibleThenScroll(sku);
      const nextVal = bumpScanCountForSku(sku);

      showStatus(barcodeStatusEl, `Scanned ${raw} → SKU ${sku} — counted qty now ${nextVal}`, false);
    }

    function handleKeydown(e) {
      const now = Date.now();
      const dt = now - lastEventTime;

      // If user is typing slowly in an input, ignore.
      // If it's fast like scanner, still capture.
      if ((isInputLike(e.target) || isTextArea(e.target)) && dt > SCAN_RESET_MS) {
        lastEventTime = now;
        scanBuffer = "";
        return;
      }

      if (dt > SCAN_RESET_MS) {
        scanBuffer = "";
        if (barcodeScanInput) barcodeScanInput.value = "";
      }
      lastEventTime = now;

      // Many scanners end with Enter or Tab
      if (e.key === "Enter" || e.key === "Tab") {
        const code = scanBuffer;
        scanBuffer = "";
        if (barcodeScanInput) barcodeScanInput.value = "";
        if (code) {
          e.preventDefault();
          handleScanComplete(code);
        }
        return;
      }

      // Collect printable characters only
      if (e.key && e.key.length === 1) {
        scanBuffer += e.key;
        if (barcodeScanInput) barcodeScanInput.value = scanBuffer;
      }
    }

    window.addEventListener("keydown", handleKeydown);
  })();

  // =======================
  //  RETURN TO TOP BUTTON
  // =======================
  function initScrollToTopButton() {
    if (document.getElementById("scrollToTopBtn")) return;

    const btn = document.createElement("button");
    btn.id = "scrollToTopBtn";
    btn.type = "button";
    btn.textContent = "↑ Top";

    Object.assign(btn.style, {
      position: "fixed",
      right: "1.25rem",
      bottom: "1.25rem",
      zIndex: "999",
      padding: "0.5rem 0.9rem",
      borderRadius: "999px",
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "0.9rem",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 0.2s ease-in-out",
      backgroundColor: "#b42ea0",
      color: "#ffffff",
    });

    document.body.appendChild(btn);

    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("scroll", () => {
      if (window.scrollY > 300) {
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
      } else {
        btn.style.opacity = "0";
        btn.style.pointerEvents = "none";
      }
    });
  }

  // =======================
  //  EVENT LISTENERS
  // =======================
  if (bannerForm) bannerForm.addEventListener("submit", saveBannerConfig);
  if (refreshOrdersBtn) refreshOrdersBtn.addEventListener("click", loadOrders);
  if (archiveBtn) archiveBtn.addEventListener("click", downloadOrderArchive);
  if (saveFlagsBtn) saveFlagsBtn.addEventListener("click", saveAdminProducts);

  if (flagsSearchInput) flagsSearchInput.addEventListener("input", applyFlagsFiltersAndRender);
  if (flagsSubcatFilter) flagsSubcatFilter.addEventListener("change", applyFlagsFiltersAndRender);

  if (flagsToggleBtn && flagsSection) {
    flagsSection.classList.add("flags-collapsed");
    flagsToggleBtn.textContent = "Expand Products";

    flagsToggleBtn.addEventListener("click", () => {
      const collapsed = flagsSection.classList.toggle("flags-collapsed");
      flagsToggleBtn.textContent = collapsed ? "Expand Products" : "Collapse Products";
    });
  }

  if (ordersToggleBtn && ordersSection) {
    ordersSection.classList.add("orders-collapsed");
    ordersToggleBtn.textContent = "Expand Orders";

    ordersToggleBtn.addEventListener("click", () => {
      const collapsed = ordersSection.classList.toggle("orders-collapsed");
      ordersToggleBtn.textContent = collapsed ? "Expand Orders" : "Collapse Orders";
    });
  }

  if (syncCatalogBtn) {
    syncCatalogBtn.addEventListener("click", () =>
      callSyncEndpoint("/admin/sync/catalog", "Catalog + inventory sync")
    );
  }

  if (syncInventoryBtn) {
    syncInventoryBtn.addEventListener("click", () =>
      callSyncEndpoint("/admin/sync/inventory", "Inventory-only sync")
    );
  }

  if (barcodeSearchInput) barcodeSearchInput.addEventListener("input", applyBarcodeFiltersAndRender);
  if (barcodeSubcatFilter) barcodeSubcatFilter.addEventListener("change", applyBarcodeFiltersAndRender);
  if (barcodeShowZeroCheckbox) barcodeShowZeroCheckbox.addEventListener("change", applyBarcodeFiltersAndRender);

  if (barcodeRefreshBtn) barcodeRefreshBtn.addEventListener("click", loadBarcodeProducts);
  if (barcodePrintSelectedBtn) barcodePrintSelectedBtn.addEventListener("click", handleBarcodePrintSelected);

  // Send deltas to Square using scanCountsBySku + confirm totals
  if (barcodeApplyInventoryBtn) {
    barcodeApplyInventoryBtn.addEventListener("click", () => {
      const updatesMap = {};

      // 1) Start with scans (works even if row not visible)
      Object.keys(scanCountsBySku).forEach((sku) => {
        const delta = Number(scanCountsBySku[sku]);
        if (!sku) return;
        if (!Number.isFinite(delta) || delta === 0) return;
        updatesMap[sku] = delta;
      });

      // 2) Merge in manual edits visible in DOM (override scan values)
      if (barcodeProductsContainer) {
        const rows = barcodeProductsContainer.querySelectorAll(".barcode-variant-row");
        rows.forEach((row) => {
          const sku = row.getAttribute("data-sku");
          const input = row.querySelector(".inv-count-input");
          if (!sku || !input) return;

          const raw = input.value.trim();
          if (raw === "") return;

          const delta = Number(raw);
          if (!Number.isFinite(delta) || delta === 0) return;

          updatesMap[sku] = delta;
        });
      }

      const updates = Object.entries(updatesMap).map(([sku, newQty]) => ({ sku, newQty }));

      if (!updates.length) {
        showStatus(
          barcodeStatusEl,
          "No quantity changes found. Scan items or enter + / - numbers in Counted qty.",
          true
        );
        return;
      }

      const totalSkus = updates.length;
      const totalDelta = updates.reduce((sum, u) => sum + Number(u.newQty || 0), 0);

      const ok = window.confirm(
        `Send inventory deltas to Square?\n\n` +
          `• SKUs to update: ${totalSkus}\n` +
          `• Total delta (sum): ${totalDelta}\n\n` +
          `Press OK to continue, Cancel to review.`
      );

      if (!ok) {
        showStatus(barcodeStatusEl, "Cancelled — review counted qty before sending.", true);
        return;
      }

      showStatus(barcodeStatusEl, "Sending inventory changes to Square...", false);

      fetch(`${API_BASE}/admin/apply-inventory-count`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "set_absolute", // kept for compatibility; backend ignores this now
          updates,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            showStatus(barcodeStatusEl, "Error updating Square inventory: " + data.error, true);
            return;
          }

          showStatus(barcodeStatusEl, "Inventory updated in Square successfully.", false);

          // Clear scan memory + visible inputs after success
          Object.keys(scanCountsBySku).forEach((k) => delete scanCountsBySku[k]);

          if (barcodeProductsContainer) {
            const rows = barcodeProductsContainer.querySelectorAll(".barcode-variant-row");
            rows.forEach((row) => {
              row.classList.remove("scan-last", "scan-seen");
              const input = row.querySelector(".inv-count-input");
              if (input) input.value = "";
            });
          }
        })
        .catch((err) => {
          console.error(err);
          showStatus(barcodeStatusEl, "Request failed while updating inventory.", true);
        });
    });
  }

  if (barcodeToggleBtn && barcodeSection) {
    barcodeSection.classList.add("barcode-collapsed");
    barcodeToggleBtn.textContent = "Expand Inventory";

    barcodeToggleBtn.addEventListener("click", () => {
      const collapsed = barcodeSection.classList.toggle("barcode-collapsed");
      barcodeToggleBtn.textContent = collapsed ? "Expand Inventory" : "Collapse Inventory";
    });
  }

  // =======================
  //  INITIAL LOAD
  // =======================
  (async () => {
    const ok = await ensureAdminSession();
    if (!ok) return;

    scheduleInactivityLogout();

    loadBannerConfig();
    loadOrders();
    loadAdminProducts();

    if (barcodeProductsContainer) loadBarcodeProducts();

    initScrollToTopButton();
  })();
});
