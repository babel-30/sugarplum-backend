// admin.js
// Assumes API_BASE is defined in config.js

// Helper: always send session cookies to the backend for admin routes
function adminFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;

  return fetch(url, {
    // IMPORTANT: this lets the browser send/receive the session cookie
    credentials: "include",
    // Allow caller to override/add anything
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

      if (res.ok) {
        // Optionally read admin info:
        // const data = await res.json();
        // console.log("Admin session:", data);
        return true;
      }

      // Not logged in – go to login page
      window.location.href = "admin-login.html";
      return false;
    } catch (err) {
      console.error("Error checking admin session:", err);
      window.location.href = "admin-login.html";
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
  const popupStatusEl =
    document.getElementById("popup-status") || bannerStatusEl;

  // --- Shipping settings ---
  const shippingFlatRateInput = document.getElementById("shippingFlatRate");
  const freeShippingThresholdInput = document.getElementById(
    "freeShippingThreshold"
  );
  const shippingStatusEl = document.getElementById("shipping-status");

  // --- Orders table ---
  const refreshOrdersBtn = document.getElementById("refresh-orders");
  const ordersTbody = document.getElementById("orders-tbody");

  // --- Archive download ---
  // (Button text still says "Archive Current Month" in HTML,
  //  but now it downloads all archived orders as a ZIP.)
  const archiveBtn = document.getElementById("archive-current-month");
  const archiveStatusEl = document.getElementById("archive-status");

  // --- Products / inventory flags ---
  const flagsTbody =
    document.getElementById("flags-tbody") ||
    document.getElementById("products-tbody");
  const flagsStatusEl =
    document.getElementById("flags-status") ||
    document.getElementById("products-status");
  const saveFlagsBtn =
    document.getElementById("save-flags-btn") ||
    document.getElementById("save-products");
  const flagsSection = document.getElementById("flags-section");
  const flagsToggleBtn = document.getElementById("flags-toggle-btn");

  // --- Catalog / Inventory sync buttons ---
  const syncCatalogBtn = document.getElementById("btn-sync-catalog");
  const syncInventoryBtn = document.getElementById("btn-sync-inventory");
  const syncStatusEl = document.getElementById("sync-status");

  // We keep the latest products from /admin/products here
  let adminProducts = [];

  // =======================
  //  HELPER: STATUS MESSAGE
  // =======================
  function showStatus(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "red" : "#000000";
  }

  // =======================
  //  BANNER + POPUP + SHIPPING CONFIG
  // =======================
  async function loadBannerConfig() {
    if (!bannerTextInput || !bannerVisibleCheckbox) return;

    try {
      // Public GET: no auth required
      const res = await fetch(`${API_BASE}/admin/config`);

      if (!res.ok) {
        throw new Error("Failed to load banner config");
      }

      const data = await res.json();

      // Banner
      bannerTextInput.value = data.bannerText || "";
      bannerVisibleCheckbox.checked = !!data.bannerVisible;

      // Popup (shop splash)
      if (popupEnabledCheckbox) {
        popupEnabledCheckbox.checked = !!data.popupEnabled;
      }
      if (popupModeSelect && typeof data.popupMode === "string") {
        popupModeSelect.value = data.popupMode;
      }
      if (popupCustomTextInput) {
        popupCustomTextInput.value = data.popupCustomText || "";
      }

      // Shipping settings
      if (
        shippingFlatRateInput &&
        typeof data.shippingFlatRate !== "undefined" &&
        data.shippingFlatRate !== null
      ) {
        shippingFlatRateInput.value = String(data.shippingFlatRate);
      }
      if (
        freeShippingThresholdInput &&
        typeof data.freeShippingThreshold !== "undefined" &&
        data.freeShippingThreshold !== null
      ) {
        freeShippingThresholdInput.value = String(
          data.freeShippingThreshold
        );
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

    // Include popup fields if those inputs exist
    if (popupEnabledCheckbox) {
      payload.popupEnabled = popupEnabledCheckbox.checked;
    }
    if (popupModeSelect) {
      payload.popupMode = popupModeSelect.value || "none";
    }
    if (popupCustomTextInput) {
      payload.popupCustomText = popupCustomTextInput.value || "";
    }

    // Include shipping settings if present
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

      if (!res.ok) {
        const msg = data.error || "Failed to save banner config";
        throw new Error(msg);
      }

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
        const dateStr = order.createdAt
          ? new Date(order.createdAt).toLocaleString()
          : "-";

        const totalStr =
          typeof order.total === "number"
            ? `$${order.total.toFixed(2)}`
            : "-";

        const customerLabel =
          order.customerName || order.customerEmail || "-";

        const statusValue = order.status || "PENDING";
        const trackingValue = order.trackingNumber || "";

        return `
          <tr data-order-id="${order.id}">
            <td>${dateStr}</td>
            <td>${customerLabel}</td>
            <td>${totalStr}</td>
            <td>
              <select class="order-status-input">
                <option value="PENDING" ${
                  statusValue === "PENDING" ? "selected" : ""
                }>PENDING</option>
                <option value="PAID" ${
                  statusValue === "PAID" ? "selected" : ""
                }>PAID</option>
                <option value="SHIPPED" ${
                  statusValue === "SHIPPED" ? "selected" : ""
                }>SHIPPED</option>
                <option value="CANCELLED" ${
                  statusValue === "CANCELLED" ? "selected" : ""
                }>CANCELLED</option>
                <option value="ARCHIVED" ${
                  statusValue === "ARCHIVED" ? "selected" : ""
                }>ARCHIVED</option>
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
              <button type="button" class="order-packing-btn">
                Packing List
              </button>
            </td>
            <td>
              <button type="button" class="order-save-btn">
                Save
              </button>
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

      if (!res.ok) {
        throw new Error("Failed to load orders");
      }

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

  // Save handler for status + tracking + packing slip
  if (ordersTbody) {
    ordersTbody.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const row = target.closest("tr");
      if (!row) return;
      const orderId = row.getAttribute("data-order-id");
      if (!orderId) return;

      // --- Packing List PDF button ---
      if (target.classList.contains("order-packing-btn")) {
        // Open packing slip PDF in a new tab for download/print
        const url = `${API_BASE}/admin/orders/${orderId}/packing-slip`;
        window.open(url, "_blank");
        return;
      }

      // --- Save button (status + tracking) ---
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
          body: JSON.stringify({
            status,
            trackingNumber,
            notifyCustomer: false,
          }),
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

        // If the order was archived, reload the list so it disappears
        if (status === "ARCHIVED") {
          await loadOrders();
        }

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
  //  ARCHIVE DOWNLOAD (ZIP OF ARCHIVED ORDERS)
  // =======================
  function downloadOrderArchive() {
    if (archiveStatusEl) {
      showStatus(
        archiveStatusEl,
        "Preparing archive download… (your browser should prompt to save a ZIP file)",
        false
      );
    }

    // Open in a new tab/window so you stay on the admin page,
    // but the browser can handle the ZIP download.
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
        const totalInv =
          typeof p.totalInventory === "number" ? p.totalInventory : 0;

        const ribbonType = flags.ribbonType || "none";
        const ribbonText = flags.ribbonCustomText || "";

        return `
          <tr data-product-id="${p.id}">
            <td class="prod-name">${p.name}</td>
            <td class="prod-subcat">${p.subcategory || "-"}</td>
            <td class="prod-inv">${totalInv}</td>

            <!-- Flags: only Pin to top now -->
            <td class="prod-flags">
              <label class="flag-pill">
                <input type="checkbox" class="flag-pinToTop" ${
                  flags.pinToTop ? "checked" : ""
                } />
                Pin to top
              </label>
            </td>

            <!-- Visibility -->
            <td class="prod-visibility">
              <label class="flag-pill">
                <input type="checkbox" class="flag-hideOnline" ${
                  flags.hideOnline ? "checked" : ""
                } />
                Hide Online
              </label>
              <label class="flag-pill">
                <input type="checkbox" class="flag-hideKiosk" ${
                  flags.hideKiosk ? "checked" : ""
                } />
                Hide Kiosk
              </label>
            </td>

            <!-- Ribbon dropdown + custom text -->
            <td class="prod-ribbon">
              <select class="flag-ribbonType">
                <option value="none" ${
                  ribbonType === "none" ? "selected" : ""
                }>No ribbon</option>
                <option value="new" ${
                  ribbonType === "new" ? "selected" : ""
                }>New</option>
                <option value="featured" ${
                  ribbonType === "featured" ? "selected" : ""
                }>Featured</option>
                <option value="custom" ${
                  ribbonType === "custom" ? "selected" : ""
                }>Custom</option>
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
        showStatus(
          flagsStatusEl,
          "Not authorized. Please log in again.",
          true
        );
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to load admin products");
      }

      const data = await res.json();
      adminProducts = Array.isArray(data.products) ? data.products : [];
      console.log("Loaded admin products:", adminProducts);

      renderProductsTable(adminProducts);
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

      const isNew = ribbonType === "new";
      const isFeatured = ribbonType === "featured";

      const flags = {
        isNew,
        isFeatured,
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
        const msg = data.error || "Failed to save product flags.";
        showStatus(flagsStatusEl, msg, true);
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
      const res = await adminFetch(path, {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        showStatus(
          syncStatusEl,
          "Not authorized. Please log in again.",
          true
        );
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error || `${label} failed.`;
        showStatus(syncStatusEl, msg, true);
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
  //  RETURN TO TOP BUTTON
  // =======================
  function initScrollToTopButton() {
    // Avoid duplicates
    if (document.getElementById("scrollToTopBtn")) return;

    const btn = document.createElement("button");
    btn.id = "scrollToTopBtn";
    btn.type = "button";
    btn.textContent = "↑ Top";

    // Basic inline styles; you can override in CSS if you want
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
  if (bannerForm) {
    bannerForm.addEventListener("submit", saveBannerConfig);
  }

  if (refreshOrdersBtn) {
    refreshOrdersBtn.addEventListener("click", loadOrders);
  }

  if (archiveBtn) {
    archiveBtn.addEventListener("click", downloadOrderArchive);
  }

  if (saveFlagsBtn) {
    saveFlagsBtn.addEventListener("click", saveAdminProducts);
  }

  if (flagsToggleBtn && flagsSection) {
    flagsToggleBtn.addEventListener("click", () => {
      const collapsed = flagsSection.classList.toggle("flags-collapsed");
      flagsToggleBtn.textContent = collapsed
        ? "Expand Products"
        : "Collapse Products";
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

  // =======================
  //  INITIAL LOAD
  // =======================
  (async () => {
    const ok = await ensureAdminSession();
    if (!ok) return;

    loadBannerConfig();
    loadOrders();
    loadAdminProducts();
    initScrollToTopButton();
  })();
});
