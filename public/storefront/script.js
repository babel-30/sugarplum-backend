/* =========================================================
   script.js (FULL) — DOES NOT EXCLUDE 3D PRINTS
   - Supports page collections: Apparel / Hats / 3D
   - Shop page: filters + add-to-cart + variant price/printSide
   - Kiosk page: availability display + filters + inactivity splash
   - Cart page: shipping/fee/tax + checkout to backend
   ========================================================= */

/* global API_BASE */

// ========== CONFIG ==========

// Shipping config defaults (front-end; overwritten by admin settings on cart page)
let SHIPPING_FLAT_RATE = 7.99; // example USPS-ish flat rate for ~3 shirts
let FREE_SHIPPING_THRESHOLD = 75; // free shipping when subtotal >= $75

// Front-end fee + tax estimates (mirrors backend intent)
let CONVENIENCE_FEE_RATE = 0.03; // 3% card fee
let TAX_STATE = "MS";
let SALES_TAX_RATE = 0.07; // 7% sales tax estimate

// Global products array (filled from /products)
let products = [];

// ========== PAGE COLLECTION (Apparel / Hats / 3D) ==========
// Determines which “collection” this page should show.
// - shop.html / index.html => Apparel
// - hats.html => Hats
// - 3d.html / 3dprints.html => 3D
function getPageCollection() {
  const path = (window.location.pathname || "").toLowerCase();

  // If you add new pages later, just expand these checks.
  if (path.includes("patches")) return "Patches";
  if (path.includes("hats")) return "Hats";
  if (path.includes("3d") || path.includes("3dprints") || path.includes("prints"))
    return "3D";

  // Default: treat index/shop as Apparel
  return "Apparel";
}
const PAGE_COLLECTION = getPageCollection();

// Normalize category/collection names coming from backend/Square
function normalizeCollectionName(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;

  if (/\bblank[\s_-]*apparel\b|\bapparel[\s_-]*blanks?\b/.test(s)) return 'Blank Apparel';
  if (/\bhat[\s_-]*blanks?\b|\bblank[\s_-]*hats?\b/.test(s)) return "Hat Blanks";

  // Common ways Square categories might be named
  if (
    s.includes("apparel") ||
    s.includes("shirt") ||
    s.includes("hoodie") ||
    s.includes("sweat")
  )
    return "Apparel";
  if (s.includes("patch")) return "Patches";
  if (s.includes("hat") || s.includes("caps") || s.includes("cap") || s.includes("beanie"))
    return "Hats";
  if (s.includes("3d") || s.includes("print") || s.includes("printed")) return "3D";

  // If you have exact category names like "Hats", "3D", etc.
  if (s === "hats") return "Hats";
  if (s === "3d") return "3D";
  if (s === "apparel") return "Apparel";

  return null;
}

// Pull a best-guess category name off the raw backend item.
// (Defensive: backend may use different field names over time.)
function extractCategoryNameFromItem(item) {
  if (!item || typeof item !== "object") return null;

  const candidates = [];

  // Most common
  if (typeof item.category === "string") candidates.push(item.category);
  if (typeof item.categoryName === "string") candidates.push(item.categoryName);
  if (typeof item.primaryCategory === "string") candidates.push(item.primaryCategory);

  // Sometimes comes as object(s)
  if (item.category && typeof item.category === "object") {
    if (typeof item.category.name === "string") candidates.push(item.category.name);
  }
  if (Array.isArray(item.categories)) {
    item.categories.forEach((c) => {
      if (typeof c === "string") candidates.push(c);
      else if (c && typeof c === "object" && typeof c.name === "string") candidates.push(c.name);
    });
  }

  // Sometimes stored in meta/extra fields
  if (item.meta && typeof item.meta === "object") {
    if (typeof item.meta.category === "string") candidates.push(item.meta.category);
    if (typeof item.meta.categoryName === "string") candidates.push(item.meta.categoryName);
    if (typeof item.meta.collection === "string") candidates.push(item.meta.collection);
  }

  if(candidates.some(c=>normalizeCollectionName(c)==="Blank Apparel"))return "Blank Apparel";
  if(candidates.some(c=>normalizeCollectionName(c)==="Hat Blanks"))return "Hat Blanks";
  for (const c of candidates) {
    const norm = normalizeCollectionName(c);
    if (norm) return norm;
  }

  return null;
}

// ===== PRINT SIDE NORMALIZATION =====
function normalizePrintSide(side) {
  if (!side) return null;
  const s = String(side).trim().toLowerCase();

  if (s === "front" || s.includes("front only")) return "Front";
  if (s === "back" || s.includes("back only")) return "Back";

  // include variations like: "Front & Back", "Front and Back", "Front/Back"
  if (
    s.includes("front & back") ||
    s.includes("front and back") ||
    s.includes("front/back") ||
    s.includes("front + back") ||
    s.includes("front+back")
  ) {
    return "Front & Back";
  }

  // If it has both words, treat as Front & Back
  if (s.includes("front") && s.includes("back")) return "Front & Back";

  return side;
}

// ===== STOCK HELPERS =====

// Return qty for a specific color/size variant (currently unused but kept)
function getVariantStock(product, color, size) {
  if (!product.variants || !product.variants.length) return 0;

  const variant = product.variants.find((v) => v.color === color && v.size === size);

  return variant ? Number(variant.qty) || 0 : 0;
}

// Load announcement banner + shop splash from admin config
async function loadAnnouncementBanner() {
  const bar = document.getElementById("announcement-bar");
  const textEl = document.getElementById("announcement-text");

  const splashSection = document.getElementById("shop-splash");
  const splashMessageEl = document.getElementById("shop-splash-message");

  // If neither banner nor splash exist, nothing to do
  if (!bar && !splashSection) return;

  try {
    const res = await fetch(`${API_BASE}/store/config`);
    if (!res.ok) throw new Error("Failed to load admin config");

    const data = await res.json();

    // ----- Announcement bar -----
    if (bar && textEl) {
      const bannerText = (data.bannerText || "").trim();
      const visible = !!data.bannerVisible;

      if (!visible || !bannerText) {
        bar.style.display = "none";
      } else {
        textEl.textContent = bannerText;
        bar.style.display = "";
      }
    }

    // ----- Shop splash / popup (online shop closed) -----
    if (splashSection && splashMessageEl) {
      const popupEnabled = !!data.popupEnabled;
      const popupMode = data.popupMode || "none"; // "none" | "event" | "inventory" | "custom"
      const popupCustomText = (data.popupCustomText || "").trim();

      let showSplash = false;
      let message = "";

      if (popupEnabled) {
        switch (popupMode) {
          case "event":
            showSplash = true;
            message =
              "Our online shop is temporarily closed while we’re at an in-person event. We’ll reopen the shop once we’re back and inventory is updated. Thanks for your patience!";
            break;
          case "inventory":
            showSplash = true;
            message =
              "We’re currently updating inventory. The online shop will reopen shortly once everything is synced. Please check back soon!";
            break;
          case "custom":
            if (popupCustomText) {
              showSplash = true;
              message = popupCustomText;
            }
            break;
          default:
            break;
        }
      }

      if (showSplash) {
        splashMessageEl.textContent = message;
        splashSection.classList.remove("hidden");
      } else {
        splashSection.classList.add("hidden");
      }
    }
  } catch (err) {
    console.error("Error loading banner/splash config:", err);
  }
}

// Does this product have ANY stock at all? (currently unused but kept)
function productHasAnyStock(product) {
  if (!product.variants || !product.variants.length) return true; // no variants = treat as available
  return product.variants.some((v) => Number(v.qty) > 0);
}

// Active filters (shop)
let activeTypeFilter = "all"; // "all", "T-Shirts", "Hoodies", "Sweatshirts", etc.
let activeAudienceFilter = "all"; // "all", "Men/Unisex", "Women", "Kids"

// Active filters (kiosk)
let kioskTypeFilter = "all";
let kioskAudienceFilter = "all";

// ===== Shop filter DOM elements (to mirror kiosk) =====
const shopSearchInput = document.getElementById("shop-search");
const shopSizeFilterSelect = document.getElementById("shop-size-filter");
const shopColorFilterSelect = document.getElementById("shop-color-filter");
const shopClearFiltersBtn = document.getElementById("shop-clear-filters");

// ========== MASTER SIZE & COLOR LISTS (CAPABILITY) ==========
const MASTER_SIZES = [
  "NB",
  "0-3M",
  "3-6M",
  "6-9M",
  "6-12M",
  "12M",
  "18M",
  "24M",
  "2T",
  "3T",
  "4T",
  "5T",
  "YS",
  "YM",
  "YL",
  "YXL",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2X",
  "2XL",
  "XXL",
  "3X",
  "3XL",
  "XXXL",
  "4X",
  "4XL",
  "5X",
  "5XL",
];

const MASTER_COLORS = [
  "Beige",
  "Black",
  "Blue",
  "Dark Blue",
  "Dark Green",
  "Dark Pink",
  "Green",
  "Grey",
  "Hot Pink",
  "Light Blue",
  "Light Green",
  "Light Pink",
  "Light Purple",
  "Orange",
  "Pink",
  "Purple",
  "Red",
  "White",
  "Yellow",
];

// ========== CART PERSISTENCE ==========
const CART_KEY = "spc_cart_v1";

function loadCartFromStorage() {
  try {
    const stored = localStorage.getItem(CART_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent("br-cart-updated"));
  } catch (e) {
    // ignore
  }
}

// ========== BRACKISH ROOTS ALERT MODAL ==========
let spcAlertOverlay = null;
let spcAlertTitleEl = null;
let spcAlertMsgEl = null;
let spcAlertBtnEl = null;

function initSpcAlertModal() {
  spcAlertOverlay = document.getElementById("spc-alert-overlay");
  if (!spcAlertOverlay) {
    return;
  }

  spcAlertTitleEl = spcAlertOverlay.querySelector(".spc-alert-title");
  spcAlertMsgEl = spcAlertOverlay.querySelector(".spc-alert-message");
  spcAlertBtnEl = spcAlertOverlay.querySelector(".spc-alert-button");

  if (spcAlertBtnEl) {
    spcAlertBtnEl.addEventListener("click", () => {
      spcAlertOverlay.classList.remove("active");
    });
  }

  spcAlertOverlay.addEventListener("click", (e) => {
    if (e.target === spcAlertOverlay) {
      spcAlertOverlay.classList.remove("active");
    }
  });
}

function showSpcAlert(message, type = "info") {
  if (!spcAlertOverlay || !spcAlertMsgEl || !spcAlertTitleEl) {
    console.warn("Brackish Roots alert:", type, message);
    return;
  }

  const alertBox = spcAlertOverlay.querySelector(".spc-alert");
  if (alertBox) {
    alertBox.className = "spc-alert spc-alert-" + type;
  }

  spcAlertMsgEl.textContent = message;

  if (type === "error") {
    spcAlertTitleEl.textContent = "Uh-oh!";
  } else if (type === "warning") {
    spcAlertTitleEl.textContent = "Heads Up!";
  } else {
    spcAlertTitleEl.textContent = "Notice";
  }

  spcAlertOverlay.classList.add("active");
}

// Global cart state
let cart = loadCartFromStorage();

// Common cart UI elements (may be null on some pages)

// Header bubble (index.html / shop pages)
const cartCountEl = document.getElementById("cart-count");
const cartTotalEl = document.getElementById("cart-total");

// Cart page summary (cart.html)
const cartSummaryItemsEl = document.getElementById("summary-total-items");
const cartSummarySubtotalEl = document.getElementById("summary-subtotal");
const cartDetailsEl = document.getElementById("cart-details");

// Cart page money breakdown
const cartShippingEl = document.getElementById("summary-shipping");
const cartGrandTotalEl = document.getElementById("summary-order-total");
const cartFeeEl = document.getElementById("summary-convenience-fee");
const cartTaxEl = document.getElementById("summary-sales-tax");

// Free shipping banner
const freeShipBannerEl = document.getElementById("free-shipping-banner");

// Optional checkout customer fields (cart page)
const checkoutNameInput = document.getElementById("checkout-name");
const checkoutEmailInput = document.getElementById("checkout-email");
const checkoutPhoneInput = document.getElementById("checkout-phone");
const checkoutAddress1Input = document.getElementById("checkout-address1");
const checkoutAddress2Input = document.getElementById("checkout-address2");
const checkoutCityInput = document.getElementById("checkout-city");
const checkoutStateInput = document.getElementById("checkout-state");
const checkoutZipInput = document.getElementById("checkout-zip");

// ========== SHIPPING HELPER ==========
function computeShipping(subtotal) {
  if (document.getElementById("checkout-pickup")?.checked) return 0;
  if (subtotal <= 0) return 0;
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return SHIPPING_FLAT_RATE;
}

// ========== CHECKOUT HANDLER ==========
async function handleCheckoutClick() {
  if (!cart || !cart.length) {
    showSpcAlert("Your cart is empty.", "warning");
    return;
  }

  if(cart.some(i=>i.customApparel&&(i.customApparel.requiresPersonalizationReview||i.customApparel.requiresProof||i.customApparel.selections?.some(s=>s.customizable))&&!i.spellingCheckoutAccepted)){showSpcAlert("Confirm the exact spelling for every personalized item before checkout.","warning");return;}
  const firstNameInput = document.getElementById('checkout-first-name');
  const lastNameInput = document.getElementById('checkout-last-name');
  const firstName = firstNameInput?.value.trim();
  const lastName = lastNameInput?.value.trim();
  const customer = {
    name: firstNameInput ? [firstName,lastName].filter(Boolean).join(' ') : checkoutNameInput ? checkoutNameInput.value.trim() : "",
    firstName,
    lastName,
    email: checkoutEmailInput ? checkoutEmailInput.value.trim() : "",
    phone: checkoutPhoneInput ? checkoutPhoneInput.value.trim() : "",
    address1: checkoutAddress1Input ? checkoutAddress1Input.value.trim() : "",
    address2: checkoutAddress2Input ? checkoutAddress2Input.value.trim() : "",
    city: checkoutCityInput ? checkoutCityInput.value.trim() : "",
    state: checkoutStateInput ? checkoutStateInput.value.trim() : "",
    postalCode: checkoutZipInput ? checkoutZipInput.value.trim() : "",
  };

  if (!customer.name || firstNameInput && !firstName) {
    showSpcAlert("Please enter your name.", "warning");
    return;
  }
  if (!customer.email) {
    showSpcAlert("Please enter your email address.", "warning");
    return;
  }

  const merchandiseTotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const shippingAmount = computeShipping(merchandiseTotal);
  const shippingTotalCents = Math.round(shippingAmount * 100);

  try {
    const payloadCart = cart.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      color: item.color,
      size: item.size,
      printSide: item.printSide || null,
      sku: item.sku || null,
      price: Math.round(item.price * 100),
      quantity: item.qty || 1,
      squareVariationId: item.squareVariationId || item.catalogObjectId || null,
      catalogObjectId: item.catalogObjectId || item.squareVariationId || null,
      customHat: item.customHat || null,
      customApparel:item.customApparel?{...item.customApparel,checkoutAccepted:item.spellingCheckoutAccepted===true}:null,
      customerNote: (item.customHat||item.customApparel) ? String(item.customerNote||"").slice(0,250) : undefined,
      kind: item.kind || null,
    }));

    const body = {
      cart: payloadCart,
      customer,
      shippingTotalCents,
      pickup: !!document.getElementById("checkout-pickup")?.checked,
      privateShopToken: cart.some(i=>i.kind==="private") ? JSON.parse(sessionStorage.getItem("br_private_shop_context") || "null")?.token || null : null,
      privateShopPasscode: cart.some(i=>i.kind==="private") ? JSON.parse(sessionStorage.getItem("br_private_shop_context") || "null")?.passcode || null : null,
      source: sessionStorage.getItem("br_campaign_source") || "direct",
    };
    window.dispatchEvent(new CustomEvent("br-track",{detail:{name:"begin_checkout"}}));




    const res = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      let errJson = {};
      try {
        errJson = await res.json();
      } catch (_) {
        errJson = {};
      }

      if (errJson && errJson.type === "OUT_OF_STOCK" && Array.isArray(errJson.conflicts)) {
        const conflicts = errJson.conflicts;

        conflicts.forEach((conf) => {
          const pid = conf.productId || null;
          const confColor = (conf.color || "").toLowerCase();
          const confSize = (conf.size || "").toLowerCase();
          const available = typeof conf.availableQty === "number" ? conf.availableQty : 0;

          for (let i = cart.length - 1; i >= 0; i--) {
            const item = cart[i];
            const itemColor = (item.color || "").toLowerCase();
            const itemSize = (item.size || "").toLowerCase();

            const sameProduct = (!!pid && item.id === pid) || (!pid && item.name === conf.name);

            if (sameProduct && itemColor === confColor && itemSize === confSize) {
              if (available <= 0) {
                cart.splice(i, 1);
              } else if (available < item.qty) {
                item.qty = available;
              }
            }
          }
        });

        saveCartToStorage();
        updateCartDisplay();

        try {
          await loadProducts();
        } catch (e) {
          console.warn("Failed to reload products after conflict:", e);
        }

        const lines = conflicts.map((c) => {
          const name = c.name || "Item";
          const color = c.color ? ` – Color: ${c.color}` : "";
          const size = c.size ? ` – Size: ${c.size}` : "";
          const req = typeof c.requestedQty === "number" ? c.requestedQty : "?";
          const avail =
            typeof c.availableQty === "number" && c.availableQty >= 0 ? c.availableQty : 0;

          if (avail <= 0) {
            return `• ${name}${color}${size} is no longer available and was removed from your cart.`;
          } else if (avail < req) {
            return `• ${name}${color}${size}: you requested ${req}, but only ${avail} remain. Your cart was updated to ${avail}.`;
          } else {
            return `• ${name}${color}${size}: quantity adjusted based on current stock.`;
          }
        });

        const fullMessage =
          "Looks like one or more items in your cart just sold out or changed while you were checking out.\n\n" +
          "We’ve updated your cart to match what’s currently available. Please review your cart and try checkout again.\n\n" +
          lines.join("\n");

        showSpcAlert(fullMessage, "warning");
        return;
      }
    }

    if (!res.ok) {
      console.error("Checkout error status:", res.status);
      let err = {};
      try {
        err = await res.json();
      } catch (_) {
        err = {};
      }
      showSpcAlert(
        "There was a problem starting checkout: " + (err.error || `HTTP ${res.status}`),
        "error"
      );
      return;
    }

    const data = await res.json();

    if (!data.checkoutUrl) {
      showSpcAlert("Checkout URL missing from server response.", "error");
      return;
    }

    // ✅ save pending checkout id so thank-you page can finalize
    try {
      if (data.pendingId) {
        sessionStorage.removeItem("spc_checkout_confirmed");
        sessionStorage.removeItem("spc_cart_cleared_on_thankyou");
        sessionStorage.setItem("spc_pending_checkout_id", String(data.pendingId));
        sessionStorage.setItem("spc_pendingId", String(data.pendingId)); // alias (safe)
      } else {
        console.warn("Checkout response missing pendingId; thank-you finalization may not run.");
      }
    } catch (e) {
      console.warn("Unable to save pendingId to sessionStorage:", e);
    }

    window.location.href = data.checkoutUrl;
  } catch (error) {
    console.error("Checkout failed:", error);
    showSpcAlert("Something went wrong starting checkout. Please try again.", "error");
  }
}

// ========== IMAGE MODAL (SHARED) ==========
let imageModalReturnFocus = null;
const imageModal = document.getElementById("image-modal");
const imageModalImg = imageModal ? document.getElementById("image-modal-img") : null;
const imageModalCaption = imageModal ? document.getElementById("image-modal-caption") : null;
const imageModalCloseBtn = imageModal ? document.querySelector(".image-modal-close") : null;

function openImageModal(src, caption, images = null) {
  if (!src) return;

  let modal = document.getElementById("image-modal");

  // Create the modal automatically if this page
  // does not already contain one.
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "image-modal";
    modal.className = "image-modal hidden";

    modal.innerHTML = `
      <div class="image-modal-backdrop"></div>

      <div
        class="image-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Product image viewer"
      >
        <button
          type="button"
          class="image-modal-close"
          aria-label="Close image viewer"
        >
          ×
        </button>

        <div class="image-modal-main">
          <img
            class="image-modal-img"
            src=""
            alt=""
          >
        </div>

        <div class="image-modal-gallery"></div>

        <div class="image-modal-caption"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      modal.classList.add("hidden");
      document.body.classList.remove("image-modal-open");
    };

    modal
      .querySelector(".image-modal-close")
      .addEventListener("click", closeModal);

    modal
      .querySelector(".image-modal-backdrop")
      .addEventListener("click", closeModal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  const modalImg =
    modal.querySelector(".image-modal-img");

  const modalCaption =
    modal.querySelector(".image-modal-caption");

  const gallery =
    modal.querySelector(".image-modal-gallery");

  modalImg.src = src;
  modalImg.alt = caption || "Product image";

  modalCaption.textContent = caption || "";

  gallery.innerHTML = "";

  const photoList =
    Array.isArray(images) && images.length > 0
      ? images.filter(Boolean)
      : [src];

  // Only show gallery controls when there is
  // more than one product photo.
  if (photoList.length > 1) {
    const labels = [
      "Front",
      "Angled",
      "Back"
    ];

    photoList.slice(0, 3).forEach(
      (photoSrc, index) => {
        const label =
          labels[index] ||
          `Photo ${index + 1}`;

        const button =
          document.createElement("button");

        button.type = "button";
        button.className =
          "image-modal-thumb" +
          (photoSrc === src ? " active" : "");

        button.innerHTML = `
          <img
            src="${photoSrc}"
            alt="${caption || "Product"} ${label}"
          >
          <span>${label}</span>
        `;

        button.addEventListener(
          "click",
          () => {
            modalImg.src = photoSrc;

            gallery
              .querySelectorAll(
                ".image-modal-thumb"
              )
              .forEach((item) => {
                item.classList.remove(
                  "active"
                );
              });

            button.classList.add(
              "active"
            );
          }
        );

        gallery.appendChild(button);
      }
    );
  }

  imageModalReturnFocus = document.activeElement;
  modal.classList.remove("hidden");
  document.body.classList.add("image-modal-open");
  modal.querySelector(".image-modal-close")?.focus();
}

function initImageModalHandlers() {
  if (!imageModal) return;
  const close = () => {
    imageModal.classList.add("hidden");
    document.body.classList.remove("image-modal-open");
    if (imageModalImg) imageModalImg.src = "";
    if (imageModalCaption) imageModalCaption.textContent = "";
    imageModalReturnFocus?.focus();
  };
  imageModalCloseBtn?.addEventListener("click", close);
  imageModal.querySelector(".image-modal-backdrop")?.addEventListener("click", close);
  imageModal.addEventListener("click", event => { if (event.target === imageModal) close(); });
  document.addEventListener("keydown", event => {
    if (imageModal.classList.contains("hidden")) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const focusable = Array.from(imageModal.querySelectorAll("button, [href], input, select, textarea, [tabindex='0']")).filter(node => !node.disabled);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
}

// ========== CART RENDERING & HELPERS ==========

// Helper: pull qty out of a variation from any of several possible fields
function extractQtyFromVariation(v) {
  const fields = [
    "availableQty",
    "available_quantity",
    "inventory",
    "quantity",
    "stock",
    "qty",
    "onHand",
    "on_hand",
    "quantityOnHand",
    "quantity_on_hand",
  ];

  for (const field of fields) {
    if (v[field] !== undefined && v[field] !== null) {
      const n = Number(v[field]);
      if (!Number.isNaN(n)) {
        return n;
      }
    }
  }
  return null;
}

// infer print location from variation name (Square puts it in the name)
function inferPrintLocationFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();

  if (lower.includes("front & back") || lower.includes("front and back")) {
    return "Front & Back";
  }
  if (lower.includes("front")) return "Front";
  if (lower.includes("back")) return "Back";

  return null;
}

// variation lookup now includes printSide
function findSquareVariation(product, color, size, printSide = null) {
  if (!Array.isArray(product.squareVariations)) return null;

  const colorLower = (color || "").toLowerCase();
  const sizeLower = (size || "").toLowerCase();
  const desiredPrint = normalizePrintSide(printSide);

  // Hats use Square variations as colors and do not require a size.
if (["Hats","Hat Blanks","Patches","3D"].includes(product.collection)) {
  return (
    product.squareVariations.find(
      (v) =>
        (v.color || v.name || "").trim().toLowerCase() ===
        colorLower
    ) || null
  );
}

  // First pass: strict match on color+size+printSide (if provided)
  if (desiredPrint) {
    const strict = product.squareVariations.find((v) => {
      const vColor = (v.color || "").toLowerCase();
      const vSize = (v.size || "").toLowerCase();
      const vPrint = normalizePrintSide(v.printLocation || inferPrintLocationFromName(v.name));
      return vColor === colorLower && vSize === sizeLower && vPrint === desiredPrint;
    });
    if (strict) return strict;
  }

  // Second pass: match on color+size only
  const matches = product.squareVariations.filter((v) => {
    const vColor = (v.color || "").toLowerCase();
    const vSize = (v.size || "").toLowerCase();
    return vColor === colorLower && vSize === sizeLower;
  });

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  // If multiple and no desiredPrint, prefer Front if present
  const front = matches.find((v) => {
    const vPrint = normalizePrintSide(v.printLocation || inferPrintLocationFromName(v.name));
    return vPrint === "Front";
  });
  if (front) return front;

  return matches[0];
}

function findSquareVariationId(product, color, size, printSide = null) {
  const match = findSquareVariation(product, color, size, printSide);
  if (!match) return null;
  return match.catalogObjectId || match.id || null;
}

// Get maximum allowed quantity for a specific cart item based on inventory
function getMaxAvailableQtyForCartItem(cartItem) {
  if (!cartItem) return 9999;

  const product = products.find((p) => p.id === cartItem.id);
  if (!product) return 1000;
  if (product.fulfillmentMode === "made-to-order") return 1000;

  // Prefer variation-level inventory if we can match a variation
  if (Array.isArray(product.squareVariations)) {
    const variation = product.squareVariations.find(v=>v.id===cartItem.catalogObjectId)||findSquareVariation(
      product,
      cartItem.color,
      cartItem.size,
      cartItem.printSide || null
    );

    if (variation) {
      const q = extractQtyFromVariation(variation);
      if (typeof q === "number") {
        return Math.max(0,q);
      }
    }
  }

  if (typeof product.inventory === "number" && product.inventory > 0) {
    return product.inventory;
  }

  return 9999;
}

// Centralized cart quantity update (respects stock limits)
function updateCartItemQuantity(index, newQty) {
  const item = cart[index];
  if (!item) return;

  if (newQty <= 0) {
    cart.splice(index, 1);
  } else {
    const maxQty = getMaxAvailableQtyForCartItem(item);
    let finalQty = newQty;
    if (finalQty > maxQty) {
      finalQty = maxQty;
      showSpcAlert("You’ve reached the maximum available stock for this item.", "warning");
    }
    item.qty = finalQty;
  }

  saveCartToStorage();
  updateCartDisplay();
}

function brEscape(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderCartDetails() {
  if (!cartDetailsEl) return;

  if (cart.length === 0) {
    cartDetailsEl.innerHTML = `<div class="cart-empty"><h2>Your cart is empty</h2><p>Find your next favorite or build a hat of your own.</p><a class="br-button br-button-orange" href="hats.html?mode=build">Build your hat →</a></div>`;
    return;
  }

  const linesHtml = cart
    .map((item, index) => {
      const lineTotal = (item.qty * item.price).toFixed(2);

      const metaBits = [];
      if (item.collection) metaBits.push(item.collection);
      if (item.type && item.type !== "Other") metaBits.push(item.type);
      if (item.color) metaBits.push(item.color);
      if (item.garmentType) metaBits.push(item.garmentType);
      if (item.sleeve) metaBits.push(item.sleeve);
      if (item.size) metaBits.push(item.size);
      if (item.printSide) metaBits.push(`${item.printSide} print`);
      if (item.customHat) metaBits.push(`${[item.customHat.patchName,item.customHat.patchVariantName,item.customHat.patchMaterial].filter(Boolean).join(" / ")} patch`, `Wearer’s ${item.customHat.placement}`);
      if(item.customApparel)metaBits.push(item.customApparel.location,...item.customApparel.selections.map(s=>s.side+': '+s.designName+(s.personalization?' / '+s.personalization:'')));
      if (item.kind === "private") metaBits.push("Private collection");
      const metaText = metaBits.join(" • ");

      const imgSrc = item.image || "assets/brackish-roots-logo.png";

      return `
        <div class="cart-line">
          <div class="cart-line-image" data-cart-preview="${index}">
            <img ${item.kind==='private'?'':`src="${brEscape(imgSrc)}"`} alt="${brEscape(item.name)}" />
          </div>
          <div class="cart-line-main">
            <div class="cart-line-name">${brEscape(item.name)}</div>
            <div class="cart-line-meta">
              ${brEscape(metaText)}
            </div>
            ${item.customHat||item.customApparel?`<div class="cart-builder-note"><label for="builder-note-${index}">Item notes (optional)</label><textarea id="builder-note-${index}" class="cart-builder-note-input" data-index="${index}" maxlength="250" placeholder="Optional instructions for this item">${brEscape(String(item.customerNote||'').slice(0,250))}</textarea><div class="cart-note-hint"><span>250 characters maximum. Notes apply to this builder item.</span><span class="cart-note-count">${String(item.customerNote||'').slice(0,250).length}/250</span></div></div>`:''}
          </div>
          <div class="cart-line-controls">
            <button type="button" class="cart-dec" data-index="${index}" aria-label="Decrease quantity of ${brEscape(item.name)}">−</button>
            <span class="cart-qty">${item.qty}</span>
            <button type="button" class="cart-inc" data-index="${index}" aria-label="Increase quantity of ${brEscape(item.name)}">+</button>
            <span class="cart-line-total">$${lineTotal}</span>
            <button type="button" class="cart-remove" data-index="${index}" aria-label="Remove ${brEscape(item.name)}">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");

  cartDetailsEl.innerHTML = linesHtml;
  window.brRenderCartPreviews?.(cartDetailsEl,cart);
  window.brApparelCart?.(cartDetailsEl,cart,saveCartToStorage);
  cartDetailsEl.querySelectorAll('.cart-builder-note-input').forEach(input=>input.addEventListener('input',()=>{const item=cart[Number(input.dataset.index)];if(!item?.customHat&&!item?.customApparel)return;item.customerNote=input.value.slice(0,250);input.value=item.customerNote;input.closest('.cart-builder-note').querySelector('.cart-note-count').textContent=item.customerNote.length+'/250';saveCartToStorage();}));

  hydratePrivateCartPreviews(cartDetailsEl);
  cartDetailsEl.querySelectorAll(".cart-inc").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      const item = cart[idx];
      if (!item) return;
      updateCartItemQuantity(idx, item.qty + 1);
    });
  });

  cartDetailsEl.querySelectorAll(".cart-dec").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      const item = cart[idx];
      if (!item) return;
      updateCartItemQuantity(idx, item.qty - 1);
    });
  });

  cartDetailsEl.querySelectorAll(".cart-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      updateCartItemQuantity(idx, 0);
    });
  });
}

const privateCartPreviewCache=new Map();
function hydratePrivateCartPreviews(container){
 const entries=cart.map((item,index)=>({item,index})).filter(x=>x.item.kind==='private');if(!entries.length)return;
 let context;try{context=JSON.parse(sessionStorage.getItem('br_private_shop_context')||'null');}catch{}
 if(!context?.token)return;
 const headers={'X-Shop-Token':context.token,'X-Shop-Passcode':context.passcode||''};
 const catalogKey='shop:'+context.token;
 if(!privateCartPreviewCache.has(catalogKey))privateCartPreviewCache.set(catalogKey,fetch(API_BASE+'/private-shop',{headers}).then(async r=>{if(!r.ok)throw new Error('Open your team shop to refresh its previews.');return r.json();}));
 for(const {item,index}of entries){const img=container.querySelector('[data-cart-preview="'+index+'"] img');if(!img)continue;
  privateCartPreviewCache.get(catalogKey).then(async shop=>{if(shop.id!==item.shopId)return;const product=shop.items.find(p=>p.id===item.id);if(!product?.mockupId)return;
   const key=context.token+':'+product.mockupId;if(!privateCartPreviewCache.has(key))privateCartPreviewCache.set(key,fetch(API_BASE+'/private-shop/files/'+encodeURIComponent(product.mockupId),{headers}).then(async r=>{if(!r.ok)throw new Error('Preview unavailable');return URL.createObjectURL(await r.blob());}));
   const url=await privateCartPreviewCache.get(key);if(img.isConnected)img.src=url;
  }).catch(()=>{if(img.isConnected)img.alt=item.name+' — open the team shop to refresh its preview';});
 }
}
function cartEstimateTotals(subtotal,shipping,feeRate,taxRate){
 const baseCents=Math.round(subtotal*100)+Math.round(shipping*100);
 const feeCents=feeRate>0?Math.round(baseCents*feeRate):0;
 const taxCents=taxRate>0?Math.round(baseCents*taxRate):0;
 return {convenienceFee:feeCents/100,estimatedTax:taxCents/100,grandTotal:(baseCents+feeCents+taxCents)/100};
}
function updateCartDisplay() {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);

  const shipping = computeShipping(subtotal);

  let localTaxRate = 0;
  const stateInput = document.getElementById("checkout-state");
  if (stateInput) {
    const stateVal = stateInput.value.trim().toUpperCase();
    if (stateVal === TAX_STATE || TAX_STATE === "MS" && stateVal === "MISSISSIPPI") {
      localTaxRate = SALES_TAX_RATE;
    }
  }

  const {convenienceFee,estimatedTax,grandTotal}=cartEstimateTotals(subtotal,shipping,CONVENIENCE_FEE_RATE,localTaxRate);

  if (cartCountEl) cartCountEl.textContent = totalItems;
  if (cartTotalEl) cartTotalEl.textContent = subtotal.toFixed(2);

  if (cartSummaryItemsEl) cartSummaryItemsEl.textContent = totalItems;
  if (cartSummarySubtotalEl) {
    cartSummarySubtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  }
  if (cartShippingEl) {
    cartShippingEl.textContent = `$${shipping.toFixed(2)}`;
  }
  if (cartFeeEl) {
    cartFeeEl.textContent = `$${convenienceFee.toFixed(2)}`;
  }
  if (cartTaxEl) {
    cartTaxEl.textContent = `$${estimatedTax.toFixed(2)}`;
  }
  if (cartGrandTotalEl) {
    cartGrandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;
  }

  if (freeShipBannerEl) {
    if (subtotal <= 0) {
      freeShipBannerEl.textContent = `Free shipping on orders of at least $${FREE_SHIPPING_THRESHOLD.toFixed(
        2
      )}.`;
    } else if (subtotal >= FREE_SHIPPING_THRESHOLD) {
      freeShipBannerEl.textContent = "You’re getting FREE shipping!";
    } else {
      const diff = FREE_SHIPPING_THRESHOLD - subtotal;
      freeShipBannerEl.textContent = `Add $${diff.toFixed(2)} more for FREE shipping.`;
    }
  }

  renderCartDetails();
}

// ========== STOCK STATUS HELPER ==========
function getStockStatus(product) {
  const inv = typeof product.inventory === "number" ? product.inventory : 0;

  if (inv <= 0) {
    return { text: "Out of stock", cssClass: "stock-out" };
  } else if (inv > 0 && inv <= 3) {
    return { text: `Low stock (${inv} left)`, cssClass: "stock-low" };
  } else {
    return { text: `${inv} in stock`, cssClass: "stock-in" };
  }
}

// Add-to-cart with stock limit enforcement + variant-specific price/IDs (includes printSide)
function addToCart(product, color, size, qty, printSide = null, exactVariation = null) {
 if(cart.some(i=>i.kind==='private')){showSpcAlert('Complete or remove your private-shop items before adding public products.','warning');return;}
  if (qty <= 0) return;

  const normalizedPrintSide = normalizePrintSide(printSide) || null;

  const existing = cart.find(
    (item) =>
      !item.customHat && !item.customApparel && item.kind !== "private" &&
      item.id === product.id &&
      (!exactVariation || item.catalogObjectId===exactVariation.id) &&
      item.color === color &&
      item.size === size &&
      (normalizePrintSide(item.printSide) || null) === normalizedPrintSide
  );

  const tempItem = { id: product.id, color, size, printSide: normalizedPrintSide, catalogObjectId:exactVariation?.id };
  const maxAvailable = getMaxAvailableQtyForCartItem(tempItem);

  const currentQty = existing ? existing.qty : 0;
  let requestedTotal = currentQty + qty;

  if (requestedTotal > maxAvailable) {
    requestedTotal = maxAvailable;
    showSpcAlert("You’ve reached the maximum available stock for this item.", "warning");
  }

  const amountToAdd = requestedTotal - currentQty;
  if (amountToAdd <= 0) return;

  const variation = exactVariation || findSquareVariation(product, color, size, normalizedPrintSide);

  let priceDollars = product.price;
  let variationId = null;
  let sku = null;

  if (variation) {
    if (typeof variation.price === "number") {
      priceDollars = variation.price;
    } else if (variation.price != null) {
      const parsed = Number(variation.price);
      if (!Number.isNaN(parsed)) priceDollars = parsed;
    }

    variationId = variation.catalogObjectId || variation.id || null;
    sku = variation.sku || null;
  }

  if (existing) {
    existing.qty = requestedTotal;
    existing.price = priceDollars;
    existing.squareVariationId = variationId;
    existing.catalogObjectId = variationId;
    existing.sku = sku;
    existing.printSide = normalizedPrintSide;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      collection: product.collection || null, // ✅ keep which collection it belongs to
      type: product.type,
      price: priceDollars,
      color,
      size,
      printSide: normalizedPrintSide,
      qty: requestedTotal,
      image: variation?.image || product.image || null,
      sleeve:variation?.sleeve||null,garmentType:variation?.garmentType||null,garmentOptions:variation?.options||{},colorHex:variation?.colorHex||null,
      squareVariationId: variationId,
      catalogObjectId: variationId,
      sku,
    });
  }

  saveCartToStorage();
  updateCartDisplay();
  window.dispatchEvent(new CustomEvent("br-track", {detail:{name:"add_to_cart",productId:product.id}}));
}

// Helpers for kiosk and shop filters
function sortByMasterOrder(values, masterList) {
  const orderMap = new Map();
  masterList.forEach((val, idx) => orderMap.set(val, idx));
  return values.slice().sort((a, b) => {
    const ai = orderMap.has(a) ? orderMap.get(a) : 999;
    const bi = orderMap.has(b) ? orderMap.get(b) : 999;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}

// ========== TRANSFORM BACKEND PRODUCTS ==========
function transformSquareProducts(squareItems) {
  if (!Array.isArray(squareItems)) return [];

  return squareItems.map((item) => {
    const name = item.name || "Unnamed Item";

    // ✅ NEW: determine collection from category-ish fields
    const inferredCollection = extractCategoryNameFromItem(item) || "Apparel";

    // type is your “within-apparel” grouping: T-Shirts / Hoodies / Sweatshirts, etc.
    // If the backend doesn't send type, ONLY default to T-Shirts if the collection is Apparel.
    let type = item.type || "";
    if (!type) {
      type = inferredCollection === "Apparel" ? "T-Shirts" : "Other";
    }

    const audience = Array.isArray(item.audience) ? item.audience : [];
    const subcategory = item.subcategory || null;
    const variations = Array.isArray(item.variations) ? item.variations : [];

    const rawFlags = item.flags || {};
    const flags = {
      isNew: !!rawFlags.isNew,
      isFeatured: !!rawFlags.isFeatured,
      pinToTop: !!rawFlags.pinToTop,
      hideOnline: !!rawFlags.hideOnline,
      hideKiosk: !!rawFlags.hideKiosk,
      ribbonType: typeof rawFlags.ribbonType === "string" ? rawFlags.ribbonType : "none",
      ribbonCustomText:
        typeof rawFlags.ribbonCustomText === "string" ? rawFlags.ribbonCustomText : "",
    };

    let ribbonFromFlags = null;
    switch (flags.ribbonType) {
      case "new":
        ribbonFromFlags = "New";
        break;
      case "featured":
        ribbonFromFlags = "Featured";
        break;
      case "custom":
        ribbonFromFlags = flags.ribbonCustomText.trim() || "Featured";
        break;
      default:
        ribbonFromFlags = null;
    }

    const meta = item.meta || {};
    const finalRibbon = ribbonFromFlags || item.ribbon || meta.ribbon || null;
    const isFeatured =
      flags.isFeatured || (item.isFeatured !== undefined ? item.isFeatured : !!meta.isFeatured);
    const isNew = flags.isNew || (item.isNew !== undefined ? item.isNew : !!meta.isNew);
    const pinToTop =
      flags.pinToTop || (item.pinToTop !== undefined ? item.pinToTop : !!meta.pinToTop);

    let basePrice = 0;
    const sizeSet = new Set();
    const colorSet = new Set();
    const printLocationSet = new Set();
    let totalInventory = 0;

    for (const v of variations) {
      const p = typeof v.price === "number" ? v.price : Number(v.price) || 0;
      if (p > 0 && (basePrice === 0 || p < basePrice)) {
        basePrice = p;
      }
      if (v.size) sizeSet.add(v.size);
      if (v.color) colorSet.add(v.color);

      let printLocation = v.printLocation || inferPrintLocationFromName(v.name);
      if (printLocation) {
        v.printLocation = normalizePrintSide(printLocation);
        printLocationSet.add(v.printLocation);
      }

      const q = extractQtyFromVariation(v);
      if (typeof q === "number" && q > 0) {
        totalInventory += q;
      }
    }

    let sizes =
  sizeSet.size > 0
    ? Array.from(sizeSet)
    : ["Hats","Hat Blanks","Patches","3D"].includes(inferredCollection)
    ? []
    : ["Standard"];

let colors =
  colorSet.size > 0
    ? Array.from(colorSet)
    : ["Hats","Hat Blanks","Patches","3D"].includes(inferredCollection)
    ? []
    : ["Default"];

    sizes = sortByMasterOrder(sizes, MASTER_SIZES);
    colors = sortByMasterOrder(colors, MASTER_COLORS);

    let inventory = totalInventory;
    if (inventory === 0 && typeof item.inventory === "number") {
      inventory = item.inventory;
    }

    const printLocations = printLocationSet.size > 0 ? Array.from(printLocationSet) : [];

    return {
      id: item.id,
      name,
      description: item.description || "",
      collection: inferredCollection,
      fulfillmentMode: item.fulfillmentMode || "stocked",
      builderEligible: !!item.builderEligible,
      productionDays: item.productionDays || null,
      details: item.details || "",
      type,
      audience,
      subcategory,
      image: item.image || null,
      price: basePrice,
      colors,
      sizes,
      inventory,
      squareVariations: variations,
      printLocations,
      ribbon: finalRibbon,
      isFeatured,
      isNew,
      pinToTop,
      flags,
    };
  });
}

// ========== SHOP PAGE RENDERING ==========
const productGrid = document.getElementById("product-grid");
const categoryFilterContainer = document.getElementById("category-filters");
const audienceFilterContainer = document.getElementById("audience-filters");

function productMatchesFilters(p, typeFilter, audienceFilter) {
  const matchesType = typeFilter === "all" ? true : p.type === typeFilter;

  const matchesAudience =
    audienceFilter === "all"
      ? true
      : Array.isArray(p.audience) && p.audience.includes(audienceFilter);

  return matchesType && matchesAudience;
}

// Helper: get the correct variant price for a given color/size/printSide
function getVariantPrice(product, color, size, printSide = null) {
  const variation = findSquareVariation(product, color, size, printSide);
  if (variation) {
    if (typeof variation.price === "number") return variation.price;
    if (variation.price != null) {
      const parsed = Number(variation.price);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return product.price || 0;
}

function renderShop() {
  if (!productGrid) return;

  productGrid.innerHTML = "";

  const searchTerm = shopSearchInput ? shopSearchInput.value.trim().toLowerCase() : "";
  const sizeVal = shopSizeFilterSelect ? shopSizeFilterSelect.value : "";
  const colorVal = shopColorFilterSelect ? shopColorFilterSelect.value : "";

  const filtered = products.filter((p) => {
    if (p.flags && p.flags.hideOnline) return false;

    // ✅ filter by page collection (Apparel / Hats / 3D)
    if ((p.collection || "Apparel") !== PAGE_COLLECTION) return false;

    // Only apply type/audience filters inside shop/kiosk UIs that have them
    if (!productMatchesFilters(p, activeTypeFilter, activeAudienceFilter)) {
      return false;
    }

    if (searchTerm && !p.name.toLowerCase().includes(searchTerm)) {
      return false;
    }

    if (sizeVal && !(p.sizes || []).includes(sizeVal)) {
      return false;
    }

    if (colorVal && !(p.colors || []).includes(colorVal)) {
      return false;
    }

    return true;
  });

  const sorted = filtered.slice().sort((a, b) => {
    if (a.pinToTop !== b.pinToTop) return b.pinToTop - a.pinToTop;
    if (a.isFeatured !== b.isFeatured) return b.isFeatured - a.isFeatured;
    if (a.isNew !== b.isNew) return b.isNew - a.isNew;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach((p) => {
    const div = document.createElement("div");
    div.className = "product";
    div.dataset.productId = p.id;

    const allVariations = Array.isArray(p.squareVariations) ? p.squareVariations : [];

    const inStockVariations = allVariations.filter((v) => {
      const q = extractQtyFromVariation(v);
      return typeof q === "number" && q > 0;
    });

    const variationsForUi = inStockVariations.length > 0 ? inStockVariations : allVariations;

    const sizesByColor = {};
    const printByColorSize = {};

    if (variationsForUi.length > 0) {
      variationsForUi.forEach((v) => {
        const colorKey = v.color || "Default";
        const sizeLabel = (v.size || "").trim();
        if (!sizeLabel) return;

        if (!sizesByColor[colorKey]) sizesByColor[colorKey] = new Set();
        sizesByColor[colorKey].add(sizeLabel);

        const printLoc = normalizePrintSide(v.printLocation || inferPrintLocationFromName(v.name));
        if (printLoc) {
          const key = `${colorKey}||${sizeLabel}`;
          if (!printByColorSize[key]) printByColorSize[key] = new Set();
          printByColorSize[key].add(printLoc);
        }
      });
    }

    if (Object.keys(sizesByColor).length === 0) {
      (p.colors || []).forEach((c) => {
        sizesByColor[c] = new Set(p.sizes || []);
      });
    }

    const colors =
      (p.colors && p.colors.length > 0 ? p.colors : Object.keys(sizesByColor)) || [];

    const getSizeOptionsHtml = (colorVal2) => {
      const setForColor = sizesByColor[colorVal2];
      let sizesArr;
      if (setForColor && setForColor.size > 0) sizesArr = Array.from(setForColor);
      else sizesArr = p.sizes || [];
      return sizesArr.slice().sort(window.BrackishVariations?.compareSizes).map((s) => `<option value="${s}">${s}</option>`).join("");
    };

    const initialColor = window.BrackishVariations?.defaultColor(p,colors) || colors[0] || Object.keys(sizesByColor)[0] || "";
    let initialSize = "";
    const initialSet = sizesByColor[initialColor];
    if (initialSet && initialSet.size > 0) initialSize = Array.from(initialSet).sort(window.BrackishVariations?.compareSizes)[0];
    else if (p.sizes && p.sizes.length > 0) initialSize = p.sizes.slice().sort(window.BrackishVariations?.compareSizes)[0];

    // For non-apparel pages, show collection label instead of type
    const typeLabel =
      PAGE_COLLECTION === "Apparel"
        ? p.type === "Other"
          ? ""
          : `${p.type} • `
        : `${p.collection} • `;

    const stock = getStockStatus(p);
    const isOutOfStock = p.fulfillmentMode !== "made-to-order" && (typeof p.inventory === "number" ? p.inventory <= 0 : false);

    const ribbonHtml = p.ribbon
      ? `<div class="product-ribbon product-ribbon-${p.ribbon
          .toLowerCase()
          .replace(/\s+/g, "-")}">${p.ribbon}</div>`
      : "";

    function getPrintOptionsFor(colorV, sizeV) {
      const key = `${colorV}||${sizeV}`;
      const set = printByColorSize[key];
      const arr = set && set.size > 0 ? Array.from(set) : p.printLocations || [];
      const order = { Front: 1, "Front & Back": 2, Back: 3 };
      return (arr || []).slice().sort((a, b) => (order[a] || 99) - (order[b] || 99));
    }

    const initialPrintOptions = getPrintOptionsFor(initialColor, initialSize);
    const hasPrintOptions = initialPrintOptions.length > 0;
    const initialPrint = hasPrintOptions ? initialPrintOptions[0] : null;

    const initialPrice = getVariantPrice(p, initialColor, initialSize, initialPrint);
    const initialSizeOptions = getSizeOptionsHtml(initialColor);

    const getHatVariation = (color) => {
  if (!["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) return null;

  return (
    allVariations.find(
      (v) =>
        (v.color || v.name || "").trim().toLowerCase() ===
        String(color || "").trim().toLowerCase()
    ) || null
  );
};

const getHatImages = (variation) => {
  if (!variation) return [];

  if (Array.isArray(variation.images) && variation.images.length > 0) {
    return variation.images.filter(Boolean);
  }

  if (variation.image) return [variation.image];
  if (p.image) return [p.image];

  return [];
};

const initialHatVariation = getHatVariation(initialColor);
const initialHatImages = getHatImages(initialHatVariation);

const initialDisplayImage =
  initialHatImages[0] ||
  p.image ||
  "https://via.placeholder.com/300x300?text=No+Image";
    
  const printLabelHtml = hasPrintOptions
      ? `
      <label>
        Print:
        <select class="product-print" ${isOutOfStock ? "disabled" : ""}>
          ${initialPrintOptions.map((loc) => `<option value="${loc}">${loc}</option>`).join("")}
        </select>
      </label>
    `
      : "";

    div.innerHTML = `
      <div class="product-image-wrap">
        ${ribbonHtml}
        <img
         src="${initialDisplayImage}"
          alt="${p.name}"
          class="product-img"
        />
      </div>

      ${
  p.image
    ? `<button class="product-view-btn">${
        ["Hats","Hat Blanks","Patches","3D"].includes(p.collection)
          ? "View Larger / More Photos"
          : "View Larger"
      }</button>`
    : ""
}

      <h3 class="product-name">${p.name}</h3>
      <p class="product-type">${typeLabel}$${initialPrice.toFixed(2)}</p>
      <p class="stock-status ${stock.cssClass}">${stock.text}</p>

      <label>
        Color:
        <select class="product-color" ${isOutOfStock ? "disabled" : ""}>
          ${colors.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </label>

      ${
  ["Hats","Hat Blanks","Patches","3D"].includes(p.collection)
    ? ""
    : `<label>
  Size:
  <select class="product-size" ${isOutOfStock ? "disabled" : ""}>
    ${initialSizeOptions}
  </select>
</label>`
}

      ${printLabelHtml}

      <div class="product-actions">
        <label>
          Qty:
          <input type="number" min="1" value="1" class="product-qty" ${
            isOutOfStock ? "disabled" : ""
          }>
        </label>
        <button class="add-to-cart" ${isOutOfStock ? "disabled" : ""}>
          Add to Cart
        </button>
      </div>
    `;

    const colorSelect = div.querySelector(".product-color");
    window.BrackishVariations?.decorate?.(colorSelect,allVariations);
    const sizeSelect = div.querySelector(".product-size");
    const printSelect = div.querySelector(".product-print");
    const qtyInput = div.querySelector(".product-qty");
    const addBtn = div.querySelector(".add-to-cart");
    const viewBtn = div.querySelector(".product-view-btn");
    const detailsLink=document.createElement("a");detailsLink.href="product.html?id="+encodeURIComponent(p.id);detailsLink.textContent="Details & share →";detailsLink.className="br-product-details-link";div.appendChild(detailsLink);window.brAppendStockAlerts?.(div,p);
    const priceEl = div.querySelector(".product-type");
    const stockEl = div.querySelector(".stock-status");
const mainImg = div.querySelector(".product-img");

let apparelSelector=null,selectedApparelVariation=null;
function syncApparelVariation(v){selectedApparelVariation=v;if(!v)return;const made=p.fulfillmentMode==='made-to-order',qty=made?1000:Number(v.quantity||0);if(mainImg&&(v.image||v.images?.[0]||p.image))mainImg.src=v.images?.[0]||v.image||p.image;priceEl.textContent=typeLabel+'$'+Number(v.price).toFixed(2);stockEl.className='stock-status '+(made||qty>3?'stock-in':qty>0?'stock-low':'stock-out');stockEl.textContent=made?'Made to order — allow '+(p.productionDays||7)+' days':qty<=0?'Out of stock':qty<=3?'Low stock ('+qty+' left)':qty+' in stock';qtyInput.disabled=qty<=0;qtyInput.max=String(Math.max(1,qty));if(Number(qtyInput.value)>qty)qtyInput.value=String(Math.max(1,qty));addBtn.disabled=qty<=0;}
if(p.collection==='Apparel'&&window.BrackishVariations){[colorSelect,sizeSelect,printSelect].filter(Boolean).forEach(select=>select.closest('label').hidden=true);const fields=document.createElement('div');fields.className='product-square-options';div.insertBefore(fields,div.querySelector('.product-actions'));apparelSelector=window.BrackishVariations.mount(fields,allVariations,{idPrefix:'product-'+p.id,onChange:syncApparelVariation});}
function syncHatVariation() {
  if (!["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) return;

  const selectedColor = getSelectedColor();
  const variation = getHatVariation(selectedColor);

  if (!variation) return;

  // Switch the main image to this color's Front photo.
  const images = getHatImages(variation);

  if (mainImg && images.length > 0) {
    mainImg.src = images[0];
  }

  // Show inventory for the selected color instead of
  // the total inventory for every color combined.
  const q = extractQtyFromVariation(variation);
  const qty = p.fulfillmentMode === "made-to-order" ? 1000 : typeof q === "number" ? q : 0;

  if (stockEl) {
    stockEl.classList.remove(
      "stock-in",
      "stock-low",
      "stock-out"
    );

    if (p.fulfillmentMode === "made-to-order") { stockEl.textContent = `Made to order — allow ${p.productionDays || 7} days`; stockEl.classList.add("stock-in");
    } else if (qty <= 0) {
      stockEl.textContent = "Out of stock";
      stockEl.classList.add("stock-out");
    } else if (qty <= 3) {
      stockEl.textContent = `Low stock (${qty} left)`;
      stockEl.classList.add("stock-low");
    } else {
      stockEl.textContent = `${qty} in stock`;
      stockEl.classList.add("stock-in");
    }
  }

  if (qtyInput) {
    qtyInput.max = String(Math.max(qty, 1));
    qtyInput.disabled = qty <= 0;

    if (Number(qtyInput.value) > qty) {
      qtyInput.value = String(Math.max(qty, 1));
    }
  }

  if (addBtn) {
    addBtn.disabled = qty <= 0;
  }

  updateDisplayedPrice();
}

function getSelectedColor() {
  if(apparelSelector)return selectedApparelVariation?.color||'Default';
  return (
    (colorSelect && colorSelect.value) ||
    initialColor ||
    "Default"
  );
}

function getSelectedSize() {
  if(apparelSelector)return selectedApparelVariation?.size||'';
  // Hats use the Square variation as the color
  // and do not have a size selection.
  if (["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) {
    return "";
  }

  let selectedSize =
    (sizeSelect && sizeSelect.value) ||
    initialSize ||
    "Standard";

  if (
    (!selectedSize || selectedSize === "") &&
    sizeSelect
  ) {
    const opt = sizeSelect.options[0];

    if (opt) {
      selectedSize = opt.value;
    }
  }

  return selectedSize;
}

function getSelectedPrint() {
  if(apparelSelector)return selectedApparelVariation?.printLocation||null;
  if (!printSelect) {
    return null;
  }

  return (
    normalizePrintSide(printSelect.value) ||
    null
  );
}

function syncPrintOptions() {
  if(apparelSelector)return;
  if (!printSelect) return;

  const c = getSelectedColor();
  const s = getSelectedSize();
  const options = getPrintOptionsFor(c, s);

  if (!options || options.length === 0) {
    printSelect.innerHTML = "";
    printSelect.disabled = true;
    return;
  }

  const previous =
    normalizePrintSide(printSelect.value);

  printSelect.disabled = false;

  printSelect.innerHTML = options
    .map(
      (loc) =>
        `<option value="${loc}">${loc}</option>`
    )
    .join("");

  const stillValid = options.some(
    (o) =>
      normalizePrintSide(o) === previous
  );

  printSelect.value =
    stillValid
      ? previous
      : options[0];
}

function updateDisplayedPrice() {
  if(apparelSelector){syncApparelVariation(selectedApparelVariation);return;}
  const c = getSelectedColor();
  const s = getSelectedSize();
  const pr = getSelectedPrint();

  const price =
    getVariantPrice(p, c, s, pr);

  if (priceEl) {
    priceEl.textContent =
      `${typeLabel}$${price.toFixed(2)}`;
  }
}

    if (initialColor && colorSelect) {
      colorSelect.value = initialColor;
    }

    if (initialSize && sizeSelect) {
      sizeSelect.value = initialSize;
    }

    if (printSelect && initialPrint) {
      printSelect.value = initialPrint;
    }

    if (colorSelect) {
      colorSelect.addEventListener("change", () => {
        // Hats select their Square variation directly by color.
        if (["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) {
          syncHatVariation();
          return;
        }

        // Existing Apparel behavior.
        if (sizeSelect) {
          const selectedColor = colorSelect.value;

          sizeSelect.innerHTML =
            getSizeOptionsHtml(selectedColor);

          const setForColor =
            sizesByColor[selectedColor];

          const newSize =
            setForColor && setForColor.size > 0
              ? Array.from(setForColor)[0]
              : (p.sizes && p.sizes[0]) || "";

          if (newSize) {
            sizeSelect.value = newSize;
          }
        }

        syncPrintOptions();
        updateDisplayedPrice();
      });
    }

    if (sizeSelect) {
      sizeSelect.addEventListener("change", () => {
        syncPrintOptions();
        updateDisplayedPrice();
      });
    }

    if (printSelect) {
      printSelect.addEventListener("change", () => {
        updateDisplayedPrice();
      });
    }

    syncPrintOptions();
    updateDisplayedPrice();

    if (["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) {
      syncHatVariation();
    }

    if (addBtn && !isOutOfStock) {
      addBtn.addEventListener("click", () => {
        const color = getSelectedColor();
        const size = getSelectedSize();
        const printSide =
          printSelect ? getSelectedPrint() : null;
        const qty =
          parseInt(qtyInput.value, 10) || 1;

        addToCart(
          p,
          color,
          size,
          qty,
          printSide,
          selectedApparelVariation
        );

        const originalText = addBtn.textContent;

        addBtn.textContent = "Added to cart";
        addBtn.disabled = true;

        setTimeout(() => {
          addBtn.textContent = originalText;

          if (["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) {
            const variation =
              getHatVariation(getSelectedColor());

            const q =
              extractQtyFromVariation(variation);

            addBtn.disabled =
              typeof q === "number"
                ? q <= 0
                : false;
          } else {
            if(apparelSelector)syncApparelVariation(selectedApparelVariation);else addBtn.disabled = false;
          }
        }, 1000);
      });
    }

   if (viewBtn) {
  viewBtn.addEventListener("click", () => {
    const currentImage =
      mainImg ? mainImg.src : p.image;

    if (!currentImage) return;

    // Hats can have multiple photos for each color.
    if (["Hats","Hat Blanks","Patches","3D"].includes(p.collection)) {
      const variation =
        getHatVariation(getSelectedColor());

      const images =
        getHatImages(variation);

      openImageModal(
        currentImage,
        `${p.name} - ${getSelectedColor()}`,
        images
      );

      return;
    }

    // All other products use the standard viewer.
    openImageModal(
      currentImage,
      p.name
    );
  });
}

    productGrid.appendChild(div);
  });
}

function initShop() {
  if (!productGrid) return;

  renderShop();

  if (categoryFilterContainer) {
    const buttons = categoryFilterContainer.querySelectorAll("button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.type || btn.dataset.filter || "all";
        activeTypeFilter = filter;

        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        renderShop();
      });
    });
  }

  if (audienceFilterContainer) {
    const buttons = audienceFilterContainer.querySelectorAll("button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const aud = btn.dataset.audience || "all";
        activeAudienceFilter = aud;

        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        renderShop();
      });
    });
  }

  if (shopSearchInput) shopSearchInput.addEventListener("input", renderShop);
  if (shopSizeFilterSelect) shopSizeFilterSelect.addEventListener("change", renderShop);
  if (shopColorFilterSelect) shopColorFilterSelect.addEventListener("change", renderShop);

  if (shopClearFiltersBtn) {
    shopClearFiltersBtn.addEventListener("click", () => {
      if (shopSearchInput) shopSearchInput.value = "";
      if (shopSizeFilterSelect) shopSizeFilterSelect.value = "";
      if (shopColorFilterSelect) shopColorFilterSelect.value = "";

      activeTypeFilter = "all";
      if (categoryFilterContainer) {
        const buttons = categoryFilterContainer.querySelectorAll("button");
        buttons.forEach((b) => b.classList.remove("active"));
        const allBtn = categoryFilterContainer.querySelector(
          '[data-filter="all"], [data-type="all"]'
        );
        if (allBtn) allBtn.classList.add("active");
      }

      activeAudienceFilter = "all";
      if (audienceFilterContainer) {
        const buttons = audienceFilterContainer.querySelectorAll("button");
        buttons.forEach((b) => b.classList.remove("active"));
        const allBtn = audienceFilterContainer.querySelector('[data-audience="all"]');
        if (allBtn) allBtn.classList.add("active");
      }

      renderShop();
    });
  }
}

// ========== KIOSK PAGE RENDERING ==========
const kioskGrid = document.getElementById("kiosk-grid");
const kioskTypeFilterContainer = document.getElementById("kiosk-filters");
const kioskAudienceFilterContainer = document.getElementById("kiosk-audience-filters");

// Splash + main references
const kioskMain = document.getElementById("kiosk-main");
const kioskSplash = document.getElementById("kiosk-splash");

// Optional extra kiosk filters
const kioskSearchInput = document.getElementById("kiosk-search");
const kioskSizeFilterSelect = document.getElementById("kiosk-size-filter");
const kioskColorFilterSelect = document.getElementById("kiosk-color-filter");
const kioskClearFiltersBtn = document.getElementById("kiosk-clear-filters");

function getAllAvailableSizesFromProducts() {
  const set = new Set();
  products.forEach((p) => {
    if ((p.collection || "Apparel") !== PAGE_COLLECTION) return;
    (p.sizes || []).forEach((s) => s && set.add(s));
  });
  return sortByMasterOrder(Array.from(set), MASTER_SIZES);
}

function getAllAvailableColorsFromProducts() {
  const set = new Set();
  products.forEach((p) => {
    if ((p.collection || "Apparel") !== PAGE_COLLECTION) return;
    (p.colors || []).forEach((c) => c && set.add(c));
  });
  return sortByMasterOrder(Array.from(set), MASTER_COLORS);
}

function decorateColorFilter(select) {
  const V=window.BrackishVariations;if(!V?.decorate)return;
  V.decorate(select,[],option=>{
    const codes=[...new Set(products.flatMap(p=>p.squareVariations||[]).filter(v=>v.color===option.value).map(v=>V.hex(v.colorHex)).filter(Boolean))];
    return codes.length===1?codes[0]:null;
  });
}
function populateShopFilterOptions() {
  if (shopSizeFilterSelect) {
    shopSizeFilterSelect.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "All Sizes";
    shopSizeFilterSelect.appendChild(first);

    getAllAvailableSizesFromProducts().forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      shopSizeFilterSelect.appendChild(opt);
    });
  }

  if (shopColorFilterSelect) {
    shopColorFilterSelect.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "All Colors";
    shopColorFilterSelect.appendChild(first);

    getAllAvailableColorsFromProducts().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      shopColorFilterSelect.appendChild(opt);
    });
    decorateColorFilter(shopColorFilterSelect);
  }
}

function populateKioskFilterOptions() {
  if (kioskSizeFilterSelect) {
    kioskSizeFilterSelect.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "All Sizes";
    kioskSizeFilterSelect.appendChild(first);

    getAllAvailableSizesFromProducts().forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      kioskSizeFilterSelect.appendChild(opt);
    });
  }

  if (kioskColorFilterSelect) {
    kioskColorFilterSelect.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "All Colors";
    kioskColorFilterSelect.appendChild(first);

    getAllAvailableColorsFromProducts().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      kioskColorFilterSelect.appendChild(opt);
    });
    decorateColorFilter(kioskColorFilterSelect);
  }
}

function getKioskFilteredProducts() {
  const search = kioskSearchInput ? kioskSearchInput.value.trim().toLowerCase() : "";
  const sizeVal = kioskSizeFilterSelect ? kioskSizeFilterSelect.value : "";
  const colorVal = kioskColorFilterSelect ? kioskColorFilterSelect.value : "";

  return products.filter((p) => {
    if (p.flags && p.flags.hideKiosk) return false;

    // ✅ filter by page collection
    if ((p.collection || "Apparel") !== PAGE_COLLECTION) return false;

    if (!productMatchesFilters(p, kioskTypeFilter, kioskAudienceFilter)) {
      return false;
    }

    if (search && !p.name.toLowerCase().includes(search)) return false;
    if (sizeVal && !p.sizes.includes(sizeVal)) return false;
    if (colorVal && !p.colors.includes(colorVal)) return false;

    return true;
  });
}

function renderKiosk() {
  if (!kioskGrid) return;

  kioskGrid.innerHTML = "";

  const filtered = getKioskFilteredProducts();

  filtered.forEach((p) => {
    const div = document.createElement("div");
    div.className = "kiosk-item";

    const ribbonHtml = p.ribbon
      ? `<div class="product-ribbon product-ribbon-${p.ribbon
          .toLowerCase()
          .replace(/\s+/g, "-")}">${p.ribbon}</div>`
      : "";

    const sizesByColor = {};
    const printByColorSize = {};
    const qtyByColorSizePrint = {};

    if (Array.isArray(p.squareVariations) && p.squareVariations.length > 0) {
      p.squareVariations.forEach((v) => {
        const colorKey = v.color || "Default";
        const sizeRaw = (v.size || "").trim();
        if (!sizeRaw) return;

        if (!sizesByColor[colorKey]) sizesByColor[colorKey] = new Set();
        sizesByColor[colorKey].add(sizeRaw);

        const printLoc = normalizePrintSide(v.printLocation || inferPrintLocationFromName(v.name));

        if (printLoc) {
          const key = `${colorKey}||${sizeRaw}`;
          if (!printByColorSize[key]) printByColorSize[key] = new Set();
          printByColorSize[key].add(printLoc);

          const q = extractQtyFromVariation(v);
          const k2 = `${colorKey}||${sizeRaw}||${printLoc}`;
          if (typeof q === "number") qtyByColorSizePrint[k2] = q;
        } else {
          const q = extractQtyFromVariation(v);
          const k2 = `${colorKey}||${sizeRaw}||`;
          if (typeof q === "number") qtyByColorSizePrint[k2] = q;
        }
      });
    }

    if (Object.keys(sizesByColor).length === 0) {
      (p.colors || []).forEach((c) => {
        sizesByColor[c] = new Set(p.sizes || []);
      });
    }

    const colors =
      (p.colors && p.colors.length > 0 ? p.colors : Object.keys(sizesByColor)) || [];

    const colorOptions = colors.map((c) => `<option value="${c}">${c}</option>`).join("");

    const getSizeOptionsHtmlForColor = (colorVal) => {
      const setForColor = sizesByColor[colorVal];
      const sizesArr =
        setForColor && setForColor.size > 0 ? Array.from(setForColor) : p.sizes;
      return (sizesArr || []).slice().sort(window.BrackishVariations?.compareSizes).map((s) => `<option value="${s}">${s}</option>`).join("");
    };

    function getPrintOptionsFor(colorV, sizeV) {
      const key = `${colorV}||${sizeV}`;
      const set = printByColorSize[key];
      const arr = set && set.size > 0 ? Array.from(set) : p.printLocations || [];
      const order = { Front: 1, "Front & Back": 2, Back: 3 };
      return (arr || []).slice().sort((a, b) => (order[a] || 99) - (order[b] || 99));
    }

    function getQtyText(colorV, sizeV, printV) {
      const pr = normalizePrintSide(printV) || "";
      const key = `${colorV}||${sizeV}||${pr}`;
      const q = qtyByColorSizePrint[key];
      if (typeof q === "number") return q;
      return "Ask for availability";
    }

    const initialColor = window.BrackishVariations?.defaultColor(p,colors) || colors[0] || Object.keys(sizesByColor)[0] || "";
    let initialSize = "";
    const initialSet = sizesByColor[initialColor];
    if (initialSet && initialSet.size > 0) initialSize = Array.from(initialSet).sort(window.BrackishVariations?.compareSizes)[0];
    else if (p.sizes && p.sizes.length > 0) initialSize = p.sizes.slice().sort(window.BrackishVariations?.compareSizes)[0];

    const initialSizeOptions = getSizeOptionsHtmlForColor(initialColor);

    const initialPrintOptions = getPrintOptionsFor(initialColor, initialSize);
    const hasPrintOptions = initialPrintOptions.length > 0;
    const initialPrint = hasPrintOptions ? initialPrintOptions[0] : null;

    const initialQtyText =
      initialColor && initialSize
        ? getQtyText(initialColor, initialSize, initialPrint)
        : "Ask for availability";

    const printHtml = hasPrintOptions
      ? `
        <p>
          <strong>Print:</strong>
          <select class="kiosk-print">
            ${initialPrintOptions.map((loc) => `<option value="${loc}">${loc}</option>`).join("")}
          </select>
        </p>
      `
      : "";

    div.innerHTML = `
      <div class="product-image-wrap">
        ${ribbonHtml}
        <img
          src="${p.image || "https://via.placeholder.com/300x300?text=No+Image"}"
          alt="${p.name}"
          class="product-img"
        />
      </div>

      ${
  p.image
    ? `<button class="product-view-btn">${
        ["Hats","Hat Blanks","Patches","3D"].includes(p.collection)
          ? "View Larger / More Photos"
          : "View Larger"
      }</button>`
    : ""
}

      <h2 class="product-name kiosk-name">${p.name}</h2>

      <div class="kiosk-details">
        <p>
          <strong>Color:</strong>
          <select class="kiosk-color">
            ${colorOptions}
          </select>
        </p>
        <p>
          <strong>Size:</strong>
          <select class="kiosk-size">
            ${initialSizeOptions}
          </select>
        </p>
        ${printHtml}
        <p class="kiosk-qty">
          <strong>Qty Available:</strong> ${initialQtyText}
        </p>
      </div>
    `;

    const colorSelect = div.querySelector(".kiosk-color");
    window.BrackishVariations?.decorate?.(colorSelect,p.squareVariations||[]);
    const sizeSelect = div.querySelector(".kiosk-size");
    const printSelect = div.querySelector(".kiosk-print");
    const qtyEl = div.querySelector(".kiosk-qty");
    const viewBtn = div.querySelector(".product-view-btn");
    const detailsLink=document.createElement("a");detailsLink.href="product.html?id="+encodeURIComponent(p.id);detailsLink.textContent="Details & share →";detailsLink.className="br-product-details-link";div.appendChild(detailsLink);

    if (colorSelect && sizeSelect && qtyEl) {
      if (initialColor) colorSelect.value = initialColor;
      if (initialSize) sizeSelect.value = initialSize;
      if (printSelect && initialPrint) printSelect.value = initialPrint;

      const syncPrint = () => {
        if (!printSelect) return;
        const c = colorSelect.value;
        const s = sizeSelect.value;
        const options = getPrintOptionsFor(c, s);

        if (!options || options.length === 0) {
          printSelect.innerHTML = "";
          printSelect.disabled = true;
          return;
        }

        const prev = normalizePrintSide(printSelect.value);
        printSelect.disabled = false;

        printSelect.innerHTML = options.map((loc) => `<option value="${loc}">${loc}</option>`).join(
          ""
        );

        const stillValid = options.some((o) => normalizePrintSide(o) === prev);
        printSelect.value = stillValid ? prev : options[0];
      };

      const updateQty = () => {
        const c = colorSelect.value;
        const s = sizeSelect.value;
        const pr = printSelect ? normalizePrintSide(printSelect.value) : null;
        const qtyText = getQtyText(c, s, pr);
        qtyEl.innerHTML = `<strong>Qty Available:</strong> ${qtyText}`;
      };

      colorSelect.addEventListener("change", () => {
        const c = colorSelect.value;
        sizeSelect.innerHTML = getSizeOptionsHtmlForColor(c);

        const setForColor = sizesByColor[c];
        const newSize =
          setForColor && setForColor.size > 0
            ? Array.from(setForColor)[0]
            : (p.sizes && p.sizes[0]) || "";
        sizeSelect.value = newSize;

        syncPrint();
        updateQty();
      });

      sizeSelect.addEventListener("change", () => {
        syncPrint();
        updateQty();
      });

      if (printSelect) {
        printSelect.addEventListener("change", updateQty);
      }

      syncPrint();
      updateQty();
    }

    if (viewBtn && p.image) {
      viewBtn.addEventListener("click", () => {
        openImageModal(p.image, p.name);
      });
    }

    window.brAppendStockAlerts?.(div,p);
    kioskGrid.appendChild(div);
  });
}

function initKioskFilters() {
  if (kioskTypeFilterContainer) {
    const buttons = kioskTypeFilterContainer.querySelectorAll("button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.type || btn.dataset.filter || "all";
        kioskTypeFilter = filter;

        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        renderKiosk();
      });
    });
  }

  if (kioskAudienceFilterContainer) {
    const buttons = kioskAudienceFilterContainer.querySelectorAll("button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const aud = btn.dataset.audience || "all";
        kioskAudienceFilter = aud;

        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        renderKiosk();
      });
    });
  }

  if (kioskSearchInput) kioskSearchInput.addEventListener("input", renderKiosk);
  if (kioskSizeFilterSelect) kioskSizeFilterSelect.addEventListener("change", renderKiosk);
  if (kioskColorFilterSelect) kioskColorFilterSelect.addEventListener("change", renderKiosk);

  if (kioskClearFiltersBtn) {
    kioskClearFiltersBtn.addEventListener("click", () => {
      if (kioskSearchInput) kioskSearchInput.value = "";
      if (kioskSizeFilterSelect) kioskSizeFilterSelect.value = "";
      if (kioskColorFilterSelect) kioskColorFilterSelect.value = "";

      kioskTypeFilter = "all";
      if (kioskTypeFilterContainer) {
        const buttons = kioskTypeFilterContainer.querySelectorAll("button");
        buttons.forEach((b) => b.classList.remove("active"));
        const allBtn = kioskTypeFilterContainer.querySelector(
          '[data-filter="all"], [data-type="all"]'
        );
        if (allBtn) allBtn.classList.add("active");
      }

      kioskAudienceFilter = "all";
      if (kioskAudienceFilterContainer) {
        const buttons = kioskAudienceFilterContainer.querySelectorAll("button");
        buttons.forEach((b) => b.classList.remove("active"));
        const allBtn = kioskAudienceFilterContainer.querySelector('[data-audience="all"]');
        if (allBtn) allBtn.classList.add("active");
      }

      renderKiosk();
    });
  }
}

// ========== KIOSK INACTIVITY TIMER ==========
let kioskInactivityTimer = null;

function showKioskSplash() {
  if (!kioskSplash || !kioskMain) return;
  kioskMain.classList.add("hidden");
  kioskSplash.classList.remove("hidden");
}

function hideKioskSplash() {
  if (!kioskSplash || !kioskMain) return;
  kioskSplash.classList.add("hidden");
  kioskMain.classList.remove("hidden");
}

function resetKioskInactivityTimer() {
  if (!kioskGrid) return;

  if (kioskSplash && !kioskSplash.classList.contains("hidden")) {
    return;
  }

  if (kioskInactivityTimer) {
    clearTimeout(kioskInactivityTimer);
  }

  kioskInactivityTimer = setTimeout(() => {
    showKioskSplash();
  }, 90 * 1000);
}

function initKioskInactivityWatcher() {
  if (!kioskGrid) return;

  showKioskSplash();

  if (kioskSplash) {
    kioskSplash.addEventListener("click", () => {
      hideKioskSplash();
      renderKiosk();
      resetKioskInactivityTimer();
    });
  }

  ["click", "mousemove", "keydown", "touchstart", "scroll"].forEach((evt) => {
    document.addEventListener(evt, resetKioskInactivityTimer);
  });
}

function initKiosk() {
  if (!kioskGrid) return;

  renderKiosk();
  initKioskFilters();
  initKioskInactivityWatcher();
}

// ========== LOAD PRODUCTS FROM BACKEND ==========
async function loadProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Catalog request failed: ${res.status}`);
    const squareProducts = await res.json();
    console.log("Loaded products from backend:", squareProducts);

products = transformSquareProducts(squareProducts);

// Make the already-transformed Square products available
// to page-specific scripts such as hats.js.
window.spcProducts = products;

console.log("Transformed products:", products);

// Let page-specific scripts know the shared product data is ready.
window.dispatchEvent(
  new CustomEvent("spc-products-ready", {
    detail: {
      products: window.spcProducts
    }
  })
);

    if (document.getElementById("product-grid")) {
      populateShopFilterOptions();
      initShop();
    }
    if (document.getElementById("kiosk-grid")) {
      populateKioskFilterOptions();
      initKiosk();
    }

    updateCartDisplay();
  } catch (err) {
    console.error("Error loading products:", err);
    products = [];
    window.spcProducts = [];
    window.dispatchEvent(new CustomEvent("spc-products-ready", { detail: { products: [], error: true } }));

    if (document.getElementById("product-grid")) {
      populateShopFilterOptions();
      initShop();
    }
    if (document.getElementById("kiosk-grid")) {
      populateKioskFilterOptions();
      initKiosk();
    }

    updateCartDisplay();
  }
}

// ========== INITIALIZE ==========
document.addEventListener("DOMContentLoaded", () => {
  initSpcAlertModal();
  loadAnnouncementBanner();
  initImageModalHandlers();

  loadProducts();
  updateCartDisplay();

  const checkoutBtn = document.getElementById("checkout-btn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", handleCheckoutClick);
  }

  const checkoutStateInput2 = document.getElementById("checkout-state");
  if (checkoutStateInput2) {
    checkoutStateInput2.addEventListener("input", updateCartDisplay);
    checkoutStateInput2.addEventListener("change", updateCartDisplay);
    checkoutStateInput2.addEventListener("blur", updateCartDisplay);
  }

  const moveToTopBtn = document.getElementById("moveToTopBtn");
  if (moveToTopBtn) {
    const toggleMoveToTop = () => {
      if (window.scrollY > 200) {
        moveToTopBtn.classList.add("visible");
      } else {
        moveToTopBtn.classList.remove("visible");
      }
    };

    window.addEventListener("scroll", toggleMoveToTop);
    toggleMoveToTop();

    moveToTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
});

// ===============================
//  CART PAGE: SHIPPING/FEE/TAX + BANNER
// ===============================
function spcRecalcCartShipping() {
  const cartPage = document.querySelector(".cart-page");
  if (!cartPage) return;
  updateCartDisplay();
}

async function spcInitCartShipping() {
  const cartPage = document.querySelector(".cart-page");
  if (!cartPage) return;

  try {
    const res = await fetch(`${API_BASE}/store/config`);
    if (res.ok) {
      const data = await res.json();
      CONVENIENCE_FEE_RATE = Number(data.convenienceFeePercent || 0)/100;
      SALES_TAX_RATE = Number(data.salesTaxPercent || 0)/100;
      TAX_STATE = data.taxState || "MS";
      const pickup = document.getElementById("pickup-option");if(pickup)pickup.hidden=!data.localPickupEnabled;
      document.getElementById("checkout-pickup")?.addEventListener("change",updateCartDisplay);

      if (data.shippingFlatRate != null && !isNaN(data.shippingFlatRate)) {
        SHIPPING_FLAT_RATE = parseFloat(data.shippingFlatRate);
      }
      if (data.freeShippingThreshold != null && !isNaN(data.freeShippingThreshold)) {
        FREE_SHIPPING_THRESHOLD = parseFloat(data.freeShippingThreshold);
      }
    }
  } catch (err) {
    console.error("Failed to load shipping settings for cart:", err);
  }

  spcRecalcCartShipping();
}

document.addEventListener("DOMContentLoaded", spcInitCartShipping);

// Configured hats and private products retain their metadata through the shared cart.
window.brAddConfiguredHat = (hat,variation,customHat,priceCents) => {
 if(cart.some(i=>i.kind==='private'))throw new Error('Complete or remove your private-shop items before adding public products.');
 const used=cart.filter(i=>(i.catalogObjectId||i.squareVariationId)===variation.id).reduce((n,i)=>n+i.qty,0);
 const max=hat.fulfillmentMode==='made-to-order'?1000:Number(variation.quantity||0);
 if(used>=max)throw new Error('You have reached the available quantity for this hat color.');
 const existing=cart.find(i=>i.id===hat.id&&i.color===(variation.color||variation.name)&&i.customHat?.patchId===customHat.patchId&&i.customHat?.patchVariantId===customHat.patchVariantId&&i.customHat?.placement===customHat.placement);
 if(existing)existing.qty+=1;else cart.push({id:hat.id,name:hat.name,type:'Custom Hat',collection:'Hats',color:variation.color||variation.name,size:'',qty:1,price:priceCents/100,image:customHat.preview?.hatImage||variation.images?.[0]||variation.image||hat.image,catalogObjectId:variation.id,squareVariationId:variation.id,customHat});
 saveCartToStorage();updateCartDisplay();window.dispatchEvent(new CustomEvent('br-track',{detail:{name:'add_to_cart',productId:hat.id}}));
};
window.brAddPrivateItem = item => {
 if(cart.some(i=>i.kind!=='private'))throw new Error('Complete or remove your public-shop items before adding private products.');
 const existingShops=cart.filter(i=>i.kind==='private').map(i=>i.shopId);
 if(existingShops.some(id=>id!==item.shopId))throw new Error('Complete or remove your current group-shop items before ordering from another group.');
 const existing=cart.find(i=>i.kind==='private'&&i.id===item.id&&i.color===item.color&&i.size===item.size&&i.shopId===item.shopId);
 if(existing)existing.qty+=item.qty;else cart.push(item);
 saveCartToStorage();updateCartDisplay();
};

window.brAddConfiguredApparel=(product,variation,customApparel,priceCents,editIndex)=>{if(cart.some(i=>i.kind==='private'))throw new Error('Complete the private-shop cart first.');const item={id:product.id,name:product.name,type:'Custom Apparel',collection:'Apparel',color:variation.color||variation.name,size:variation.size||'',sleeve:variation.sleeve||null,garmentType:variation.garmentType||null,garmentOptions:variation.options||{},colorHex:variation.colorHex||null,qty:1,price:priceCents/100,image:customApparel.frontImage,catalogObjectId:variation.id,squareVariationId:variation.id,sku:variation.sku||'',customApparel,spellingCheckoutAccepted:false};if(Number.isInteger(editIndex)&&cart[editIndex]?.customApparel){item.qty=cart[editIndex].qty;item.customerNote=cart[editIndex].customerNote;cart[editIndex]=item;}else cart.push(item);saveCartToStorage();updateCartDisplay();};
