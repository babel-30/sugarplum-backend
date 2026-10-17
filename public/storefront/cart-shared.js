// cart-shared.js
// Shared cart helpers + optional drawer UI
// Uses SAME cart format as script.js:
//  - qty (number)
//  - price in DOLLARS
//  - id/name/type/color/size/printSide/catalogObjectId/squareVariationId

const CART_KEY = "spc_cart_v1";

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart || []));
  } catch {
    // ignore
  }
  updateCartBadges();
  window.dispatchEvent(new CustomEvent("br-cart-updated"));
}

// Count items (sum qty)
function getCartCount(cart = loadCart()) {
  return cart.reduce((sum, it) => sum + Number(it.qty || 0), 0);
}

// Subtotal dollars
function getCartSubtotal(cart = loadCart()) {
  return cart.reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.price || 0), 0);
}

// Update badge(s) on any page (supports both id styles)
function updateCartBadges() {
  const cart = loadCart();
  const count = getCartCount(cart);
  const subtotal = getCartSubtotal(cart);

  // Your script.js header bubble ids
  const badge1 = document.getElementById("cart-count");
  const total1 = document.getElementById("cart-total");

  if (badge1) badge1.textContent = String(count);
  if (total1) total1.textContent = subtotal.toFixed(2);

  // If you later use drawer ids
  const badge2 = document.getElementById("cartCount");
  if (badge2) badge2.textContent = String(count);
}

// Add item in SAME shape as script.js cart items
// If the same variant exists, increments qty
function addToSharedCart(item) {
  const cart = loadCart();

  // Prefer variation id match when possible
  const key = item.catalogObjectId || item.squareVariationId || item.id;

  const idx = cart.findIndex((x) => {
    const xKey = x.catalogObjectId || x.squareVariationId || x.id;
    if (key && xKey) return xKey === key;

    // fallback match
    return (
      x.id === item.id &&
      (x.color || "") === (item.color || "") &&
      (x.size || "") === (item.size || "") &&
      (x.printSide || "") === (item.printSide || "")
    );
  });

  if (idx >= 0) {
    cart[idx].qty = Number(cart[idx].qty || 0) + Number(item.qty || 1);
  } else {
    cart.push({
      ...item,
      qty: Number(item.qty || 1),
      price: Number(item.price || 0),
    });
  }

  saveCart(cart);
}

// Optional: if you use a cart drawer later
function openCartDrawer() {
  const drawer = document.getElementById("cartDrawer");
  if (!drawer) return;
  drawer.classList.add("open");
  renderCartDrawer();
}

function closeCartDrawer() {
  const drawer = document.getElementById("cartDrawer");
  if (!drawer) return;
  drawer.classList.remove("open");
}

function renderCartDrawer() {
  const body = document.getElementById("cartItems");
  const subtotalEl = document.getElementById("cartSubtotal");
  if (!body || !subtotalEl) return;

  const cart = loadCart();
  body.innerHTML = "";

  if (!cart.length) {
    body.innerHTML = `<p style="opacity:.8;">Your cart is empty.</p>`;
    subtotalEl.textContent = "$0.00";
    return;
  }

  cart.forEach((it, idx) => {
    const line = document.createElement("div");
    line.className = "cart-line";

    const title = [it.name, it.type].filter(Boolean).join(" • ");
    const variant = [it.color, it.garmentType, it.sleeve, it.size, it.printSide].filter(Boolean).join(" / ");
    const lineTotal = (Number(it.qty || 0) * Number(it.price || 0)).toFixed(2);

    line.innerHTML = `
      <div class="cart-line-top">
        <div>
          <div class="cart-title">${escapeHtml(title || "Item")}</div>
          <div class="cart-variant">${escapeHtml(variant)}</div>
        </div>
        <button class="cart-remove" data-remove="${idx}">✕</button>
      </div>

      <div class="cart-line-bottom">
        <div class="cart-price">$${Number(it.price || 0).toFixed(2)}</div>

        <div class="cart-qty">
          <button data-dec="${idx}">−</button>
          <input value="${Number(it.qty || 1)}" data-qty="${idx}" />
          <button data-inc="${idx}">+</button>
        </div>

        <div class="cart-line-total">$${lineTotal}</div>
      </div>
    `;

    body.appendChild(line);
  });

  subtotalEl.textContent = `$${getCartSubtotal(cart).toFixed(2)}`;

  // Wire controls
  body.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cart = loadCart();
      cart.splice(Number(btn.dataset.remove), 1);
      saveCart(cart);
      renderCartDrawer();
    });
  });

  body.querySelectorAll("[data-inc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cart = loadCart();
      const i = Number(btn.dataset.inc);
      cart[i].qty = Number(cart[i].qty || 1) + 1;
      saveCart(cart);
      renderCartDrawer();
    });
  });

  body.querySelectorAll("[data-dec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cart = loadCart();
      const i = Number(btn.dataset.dec);
      cart[i].qty = Math.max(1, Number(cart[i].qty || 1) - 1);
      saveCart(cart);
      renderCartDrawer();
    });
  });

  body.querySelectorAll("[data-qty]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const cart = loadCart();
      const i = Number(inp.dataset.qty);
      const n = Math.max(1, Math.floor(Number(inp.value || 1)));
      cart[i].qty = n;
      saveCart(cart);
      renderCartDrawer();
    });
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Auto-init
document.addEventListener("DOMContentLoaded", () => {
  updateCartBadges();
});
