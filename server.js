// Load environment variables
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const db = require("./db");
const crypto = require("crypto");
// NOTE: uuid removed to avoid ERR_REQUIRE_ESM on Node 20
// const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const nodemailer = require("nodemailer");

// ===== Admin Config Storage =====
const ADMIN_CONFIG_PATH = path.join(__dirname, "adminConfig.json");
const EXPORTS_DIR = path.join(__dirname, "exports");

// ===== Product Flags Storage =====
const PRODUCT_CONFIG_PATH = path.join(__dirname, "productConfig.json");

// Admin config now includes popup options for the shop splash
// and shipping settings (used by our checkout, not Shippo directly).
let adminConfig = {
  // Announcement bar
  bannerText: "",
  bannerVisible: false,

  // Shop popup / splash settings
  popupEnabled: false, // master on/off
  popupMode: "none", // "none" | "event" | "inventory" | "custom"
  popupCustomText: "", // used when popupMode === "custom"

  // Shipping settings (stored in *dollars*, used to compute a shipping line item)
  shippingFlatRate: 7.99, // flat-rate shipping in the lower 48
  freeShippingThreshold: 75, // free shipping over this amount ($)
};

// Per-product flags (id → flags)
let productConfig = {};

// ---------- Admin config helpers ----------
function loadAdminConfig() {
  try {
    if (fs.existsSync(ADMIN_CONFIG_PATH)) {
      const raw = fs.readFileSync(ADMIN_CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw);
      // Merge so new fields get defaults even if file is older
      adminConfig = {
        ...adminConfig,
        ...parsed,
      };
    }
  } catch (err) {
    console.error("Error loading admin config:", err);
  }
}

function saveAdminConfig() {
  try {
    fs.writeFileSync(
      ADMIN_CONFIG_PATH,
      JSON.stringify(adminConfig, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Error saving admin config:", err);
  }
}

// ---------- Product config helpers ----------
function loadProductConfig() {
  try {
    if (fs.existsSync(PRODUCT_CONFIG_PATH)) {
      const raw = fs.readFileSync(PRODUCT_CONFIG_PATH, "utf8");
      productConfig = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Error loading product config:", err);
    productConfig = {};
  }
}

function saveProductConfig() {
  try {
    fs.writeFileSync(
      PRODUCT_CONFIG_PATH,
      JSON.stringify(productConfig, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Error saving product config:", err);
  }
}

// ---------- Email helper ----------
function createMailTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });
}

// Load configs once when server starts
loadAdminConfig();
loadProductConfig();

// Use the LEGACY Square SDK
const { Client, Environment } = require("square/legacy");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middleware =====
const allowedOrigins = ["http://127.0.0.1:5500", "http://localhost:5500"];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // keep false on localhost; set true when you ONLY run behind HTTPS
      sameSite: "none",
    },
  })
);

// ---- Square client ----
if (!process.env.SQUARE_ACCESS_TOKEN) {
  console.warn("⚠️  SQUARE_ACCESS_TOKEN is not set in .env");
}

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment:
    process.env.SQUARE_ENVIRONMENT === "production"
      ? Environment.Production
      : Environment.Sandbox,
});

console.log("Square client created");
console.log("Square env:", process.env.SQUARE_ENVIRONMENT || "sandbox");

// Simple test route
app.get("/", (req, res) => {
  res.json({ message: "Sugar Plum backend is running!" });
});

//
// ================== HELPERS ==================
//

// ---------- Helper: decide if an ITEM looks like clothing ----------
function looksLikeApparel(item) {
  const data = item.itemData || {};
  const name = (data.name || "").toLowerCase();

  const variationNames = (data.variations || []).map(
    (v) => (v.itemVariationData?.name || "").toLowerCase()
  );

  const sizeText = variationNames.join(" ");

  const sizeKeywords = [
    "small",
    "medium",
    "large",
    "x-large",
    "xl",
    "2xl",
    "3xl",
    "4xl",
    "5xl",
    "youth",
    "toddler",
    "adult",
    "xs",
    "s.",
    "m.",
    "l.",
  ];

  const apparelKeywords = [
    "shirt",
    "t-shirt",
    "t shirt",
    "tee",
    "hoodie",
    "sweatshirt",
    "crew",
    "long sleeve",
    "tank",
  ];

  const hasSizeFromVariations = sizeKeywords.some((kw) =>
    sizeText.includes(kw)
  );
  const hasApparelWordInName = apparelKeywords.some((kw) => name.includes(kw));

  return hasApparelWordInName || hasSizeFromVariations;
}

// ---------- Type detection (T-Shirt / Hoodie / Sweatshirt) ----------
function inferType(rawName) {
  const n = (rawName || "").toLowerCase();
  if (n.includes("hoodie")) return "Hoodies";
  if (n.includes("sweatshirt") || n.includes("crew")) return "Sweatshirts";
  if (n.includes("long sleeve")) return "Long Sleeve";
  if (n.includes("tank")) return "Tanks";
  return "T-Shirts"; // default for now
}

// ---------- Parse variation name into size + color ----------
function parseVariationName(vName) {
  if (!vName) return { size: null, color: null };

  const parts = vName.split(/[,/]/).map((p) => p.trim());

  let size = null;
  let color = null;

  parts.forEach((part) => {
    const lower = part.toLowerCase();

    const isSize =
      lower.includes("small") ||
      lower.includes("medium") ||
      lower.includes("large") ||
      lower.includes("xl") ||
      lower.includes("youth") ||
      lower.includes("toddler") ||
      lower.includes("4t") ||
      lower.includes("3t") ||
      lower.includes("2t") ||
      /^\d+t$/.test(lower);

    const isGarmentWord =
      lower.includes("shirt") ||
      lower.includes("t-shirt") ||
      lower.includes("tee") ||
      lower.includes("tank") ||
      lower.includes("hoodie") ||
      lower.includes("sweatshirt");

    if (isSize) {
      if (!size) size = part;
    } else if (!isGarmentWord && !color) {
      color = part;
    }
  });

  return { size, color };
}

// small helper for word-matching in description
function hasWordOrTag(descLower, base) {
  const d = ` ${descLower} `;
  const w = base.toLowerCase();
  if (d.includes(` ${w} `)) return true;
  if (d.includes(`[${w}]`)) return true;
  return false;
}

// ---------- Audience detection (Men/Unisex, Women, Kids, multi) ----------
function inferAudience(name, variations, description) {
  const audiences = new Set();
  const n = (name || "").toLowerCase();
  const d = (description || "").toLowerCase();

  // 1) Manual override via description tags/words
  if (hasWordOrTag(d, "women") || hasWordOrTag(d, "womens")) {
    audiences.add("Women");
  }

  if (
    hasWordOrTag(d, "men/unisex") ||
    hasWordOrTag(d, "men") ||
    hasWordOrTag(d, "unisex")
  ) {
    audiences.add("Men/Unisex");
  }

  if (hasWordOrTag(d, "kids") || hasWordOrTag(d, "youth")) {
    audiences.add("Kids");
  }

  if (audiences.size > 0) {
    return Array.from(audiences);
  }

  // 2) Automatic detection
  const sizeNames = (variations || []).map(
    (v) => (v.itemVariationData?.name || "").toLowerCase()
  );

  let hasYouth = false;
  let hasAdult = false;

  sizeNames.forEach((s) => {
    if (
      s.includes("youth") ||
      s.includes("toddler") ||
      s.includes("4t") ||
      s.includes("3t") ||
      s.includes("2t") ||
      /^\d+t$/.test(s.trim())
    ) {
      hasYouth = true;
    } else if (s.trim()) {
      hasAdult = true;
    }
  });

  if (
    n.includes("youth") ||
    n.includes("toddler") ||
    n.includes("kid") ||
    n.includes("4t") ||
    n.includes("3t") ||
    n.includes("2t")
  ) {
    hasYouth = true;
  }

  if (hasYouth) {
    audiences.add("Kids");
  }

  const femaleNameKeywords = [
    "mama",
    "wife",
    "girly",
    "girl",
    "swiftie",
    "bow",
    "ballerina",
    "cheer",
    "dance",
  ];

  const femaleColorWords = [
    "pink",
    "hot pink",
    "light pink",
    "dark pink",
    "peach",
    "coral",
    "mint",
    "lavender",
    "purple",
    "rose",
  ];

  const looksFemaleName = femaleNameKeywords.some((k) => n.includes(k));
  const variationText = sizeNames.join(" ");
  const looksFemaleColor = femaleColorWords.some((c) =>
    variationText.includes(c)
  );
  const looksExplicitWoman =
    n.includes("women") || n.includes("ladies") || n.includes("female");

  const isFemaleDesign =
    looksFemaleName || looksFemaleColor || looksExplicitWoman;

  if (hasAdult && isFemaleDesign) {
    audiences.add("Women");
  }

  return Array.from(audiences);
}

// ---------- Subcategory detection ----------
function inferSubcategory(name, description) {
  const text = ((name || "") + " " + (description || "")).toLowerCase();

  if (
    text.includes("grinch") ||
    text.includes("christmas") ||
    text.includes("xmas") ||
    text.includes("santa") ||
    text.includes("elf") ||
    text.includes("reindeer")
  ) {
    return "Christmas";
  }

  if (
    text.includes("thanksgiving") ||
    text.includes("turkey") ||
    text.includes("gobble") ||
    text.includes("thankful") ||
    text.includes("fall") ||
    text.includes("autumn")
  ) {
    return "Thanksgiving";
  }

  if (
    text.includes("halloween") ||
    text.includes("witch") ||
    text.includes("ghost") ||
    text.includes("pumpkin") ||
    text.includes("spooky") ||
    text.includes("boo") ||
    text.includes("skeleton")
  ) {
    return "Halloween";
  }

  if (
    text.includes("valentine") ||
    text.includes("valentines") ||
    text.includes("love") ||
    text.includes("heart") ||
    text.includes("cupid")
  ) {
    return "Valentine";
  }

  if (
    text.includes("easter") ||
    text.includes("bunny") ||
    text.includes("egg") ||
    text.includes("resurrection")
  ) {
    return "Easter";
  }

  if (
    text.includes("usa") ||
    text.includes("american") ||
    text.includes("america") ||
    text.includes("flag") ||
    text.includes("patriotic") ||
    text.includes("freedom") ||
    text.includes("merica") ||
    text.includes("4th of july") ||
    text.includes("independence")
  ) {
    return "Patriotic";
  }

  if (
    text.includes("faith") ||
    text.includes("jesus") ||
    text.includes("cross") ||
    text.includes("blessed") ||
    text.includes("bible") ||
    text.includes("pray") ||
    text.includes("prayer") ||
    text.includes("church") ||
    text.includes("god ")
  ) {
    return "Faith";
  }

  if (
    text.includes("dog") ||
    text.includes("dogs") ||
    text.includes("cat") ||
    text.includes("cow") ||
    text.includes("goat") ||
    text.includes("chicken") ||
    text.includes("horse") ||
    text.includes("animal") ||
    text.includes("paw")
  ) {
    return "Animals";
  }

  if (
    text.includes("hunt") ||
    text.includes("hunting") ||
    text.includes("deer") ||
    text.includes("buck") ||
    text.includes("duck") ||
    text.includes("antler") ||
    text.includes("fishing") ||
    text.includes("fish") ||
    text.includes("bass") ||
    text.includes("crappie") ||
    text.includes("rifle") ||
    text.includes("bowhunting") ||
    text.includes("bow hunting")
  ) {
    return "Hunting & Fishing";
  }

  if (
    text.includes("football") ||
    text.includes("baseball") ||
    text.includes("softball") ||
    text.includes("basketball") ||
    text.includes("soccer") ||
    text.includes("sports") ||
    text.includes("touchdown") ||
    text.includes("homerun") ||
    text.includes("home run")
  ) {
    return "Sports";
  }

  if (
    text.includes("sarcasm") ||
    text.includes("funny") ||
    text.includes("humor") ||
    text.includes("snark") ||
    text.includes("trendy") ||
    text.includes("meme") ||
    text.includes("coffee") ||
    text.includes("wine")
  ) {
    return "Humor / Trendy";
  }

  return null;
}

// ---------- Normalize product flags ----------
function normalizeFlags(rawFlags = {}) {
  return {
    isNew: !!rawFlags.isNew,
    isFeatured: !!rawFlags.isFeatured,
    pinToTop: !!rawFlags.pinToTop,
    hideOnline: !!rawFlags.hideOnline,
    hideKiosk: !!rawFlags.hideKiosk,
    ribbonType:
      typeof rawFlags.ribbonType === "string" ? rawFlags.ribbonType : "none", // "none" | "new" | "featured" | "custom" | etc.
    ribbonCustomText:
      typeof rawFlags.ribbonCustomText === "string"
        ? rawFlags.ribbonCustomText
        : "",
  };
}

// ---------- Shared loader for apparel products + inventory ----------
async function loadApparelProductsWithInventory() {
  const catalogApi = squareClient.catalogApi;
  const inventoryApi = squareClient.inventoryApi;

  let cursor = undefined;
  const allObjects = [];

  // Pull ALL catalog pages
  do {
    const resp = await catalogApi.listCatalog(cursor);
    if (resp.result.objects) {
      allObjects.push(...resp.result.objects);
    }
    cursor = resp.result.cursor;
  } while (cursor);

  console.log("Total catalog objects:", allObjects.length);

  const items = allObjects.filter((obj) => obj.type === "ITEM");
  console.log("Total ITEM objects:", items.length);

  const apparelItems = [];
  const allVariationIds = [];

  // First pass: figure out which items are apparel & collect variation IDs
  for (const item of items) {
    const data = item.itemData || {};
    const rawName = data.name || "";

    if (!Array.isArray(data.variations) || data.variations.length === 0) {
      continue;
    }

    if (!looksLikeApparel(item)) {
      continue;
    }

    const variationNames = data.variations.map(
      (v) => v.itemVariationData?.name || ""
    );
    const parsedVariations = variationNames.map((n) => parseVariationName(n));

    const allSizesNull = parsedVariations.every((p) => p.size === null);
    const allColorsRegular = parsedVariations.every(
      (p) => (p.color || "").toLowerCase() === "regular"
    );

    if (
      rawName === "T-Shirt" &&
      !data.imageUrl &&
      allSizesNull &&
      allColorsRegular
    ) {
      // skip generic template
      continue;
    }

    apparelItems.push(item);

    for (const v of data.variations) {
      if (v.id) {
        allVariationIds.push(v.id);
      }
    }
  }

  console.log("Total apparel ITEMs:", apparelItems.length);
  console.log(
    "Total variation IDs for inventory lookup:",
    allVariationIds.length
  );

  // Second pass: inventory counts
  const quantityByVariationId = {};

  if (allVariationIds.length > 0) {
    try {
      const invResp = await inventoryApi.batchRetrieveInventoryCounts({
        catalogObjectIds: allVariationIds,
      });

      const counts = invResp.result.counts || [];
      console.log("Inventory counts returned:", counts.length);

      for (const c of counts) {
        const varId = c.catalogObjectId;
        const q = c.quantity ? Number(c.quantity) : 0;

        if (!quantityByVariationId[varId]) {
          quantityByVariationId[varId] = 0;
        }
        quantityByVariationId[varId] += isNaN(q) ? 0 : q;
      }
    } catch (invErr) {
      console.error("Error retrieving inventory counts:", invErr);
    }
  }

  // Third pass: build final product list
  const finalProducts = [];

  for (const item of apparelItems) {
    const data = item.itemData || {};
    const rawName = data.name || "";

    // IMAGE
    let imageUrl = data.imageUrl || null;

    if (!imageUrl && Array.isArray(data.imageIds) && data.imageIds.length > 0) {
      const imgId = data.imageIds[0];
      try {
        const imgResp = await catalogApi.retrieveCatalogObject(imgId);
        const imgObj = imgResp.result.object;
        if (imgObj?.imageData?.url) {
          imageUrl = imgObj.imageData.url;
        }
      } catch (err) {
        console.error(
          "Error retrieving image object for",
          rawName,
          "id:",
          imgId,
          err.message || err
        );
      }
    }

    const type = inferType(rawName);
    const audience = inferAudience(
      rawName,
      data.variations,
      data.description
    );
    const subcategory = inferSubcategory(rawName, data.description);

    const variations = data.variations.map((v) => {
      const vData = v.itemVariationData || {};
      const { size, color } = parseVariationName(vData.name || "");

      let price = 0;
      if (vData.priceMoney && vData.priceMoney.amount != null) {
        price = Number(vData.priceMoney.amount) / 100;
      }

      const quantity = quantityByVariationId[v.id] ?? 0;

      return {
        id: v.id,
        name: vData.name,
        price,
        size,
        color,
        quantity,
      };
    });

    finalProducts.push({
      id: item.id,
      name: rawName,
      description: data.description || "",
      type,
      audience,
      subcategory,
      image: imageUrl,
      variations,
    });
  }

  return finalProducts;
}

//
// ============== PRODUCTS ENDPOINT ==============
// Includes real-time inventory per variation + product flags + sorting
//
app.get("/products", async (req, res) => {
  console.log("HIT /products"); // debug

  try {
    const baseProducts = await loadApparelProductsWithInventory();

    // Attach flags from productConfig
    let decorated = baseProducts.map((p) => {
      const flagsRaw = productConfig[p.id] || {};
      const flags = normalizeFlags(flagsRaw);
      return { ...p, flags };
    });

    // Hide from online shop if flagged
    decorated = decorated.filter((p) => !p.flags.hideOnline);

    // Sort: pinToTop → featured → new → name A–Z
    decorated.sort((a, b) => {
      if (a.flags.pinToTop !== b.flags.pinToTop) {
        return a.flags.pinToTop ? -1 : 1;
      }
      if (a.flags.isFeatured !== b.flags.isFeatured) {
        return a.flags.isFeatured ? -1 : 1;
      }
      if (a.flags.isNew !== b.flags.isNew) {
        return a.flags.isNew ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json(decorated);
  } catch (error) {
    console.error("Square API error:", error);
    res.status(500).json({ error: "Error loading products from Square" });
  }
});

//
// ============== DEBUG CATALOG ENDPOINT ==============
//
app.get("/debug-catalog", async (req, res) => {
  try {
    const catalogApi = squareClient.catalogApi;

    let cursor = undefined;
    const items = [];

    do {
      const resp = await catalogApi.listCatalog(cursor);
      const objs = resp.result.objects || [];

      for (const obj of objs) {
        if (obj.type === "ITEM") {
          items.push({
            id: obj.id,
            type: obj.type,
            name: obj.itemData?.name || null,
            categoryId: obj.itemData?.categoryId || null,
          });
        }
      }

      cursor = resp.result.cursor;
    } while (cursor);

    const nameFilter = (req.query.name || "").toLowerCase();
    const filtered = nameFilter
      ? items.filter((i) =>
          (i.name || "").toLowerCase().includes(nameFilter)
        )
      : items;

    res.json(filtered);
  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).json({
      error: "debug-catalog failed",
      details: err.message || String(err),
    });
  }
});

//
// ============== CHECKOUT ENDPOINT ==============
// Uses adminConfig.shippingFlatRate + adminConfig.freeShippingThreshold
// to add a "Shipping" line item to the Square Payment Link.
// Shippo is then used later INSIDE Square to buy the label.
//
app.post("/checkout", async (req, res) => {
  try {
    const { cart, customer } = req.body;
    console.log("Incoming checkout cart (backend):", cart);
    console.log("Incoming customer:", customer);

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) {
      console.error("Missing SQUARE_LOCATION_ID in environment.");
      return res
        .status(500)
        .json({ error: "Server misconfigured (no location id)." });
    }

    // Build line items from cart (no shipping yet)
    const lineItems = cart.map((item) => {
      const qty = item.quantity || item.qty || 1;
      const priceCents = item.price || 0; // price already in cents from frontend

      const optionText = [item.color, item.size].filter(Boolean).join(" / ");

      return {
        name: optionText ? `${item.name} (${optionText})` : item.name,
        quantity: String(qty),
        basePriceMoney: {
          amount: priceCents,
          currency: "USD",
        },
      };
    });

    // Subtotal in cents (no shipping yet)
    const subtotalCents = lineItems.reduce(
      (sum, li) =>
        sum +
        Number(li.basePriceMoney.amount) * Number(li.quantity || "1"),
      0
    );
    console.log("Computed subtotal (cents):", subtotalCents);

    if (subtotalCents <= 0) {
      return res.status(400).json({ error: "Invalid cart total" });
    }

    // ----- Shipping calculation (flat rate + free shipping) -----
    // Values are stored in dollars in adminConfig
    const shippingFlat = Number(adminConfig.shippingFlatRate || 0); // dollars
    const freeThresh =
      adminConfig.freeShippingThreshold != null
        ? Number(adminConfig.freeShippingThreshold)
        : null; // dollars

    let shippingCents = Math.round(shippingFlat * 100);

    if (freeThresh != null && subtotalCents / 100 >= freeThresh) {
      // qualifies for free shipping
      shippingCents = 0;
    }

    if (shippingCents > 0) {
      lineItems.push({
        name: "Shipping",
        quantity: "1",
        basePriceMoney: {
          amount: shippingCents,
          currency: "USD",
        },
      });
    }

    const totalCents = subtotalCents + shippingCents;
    console.log("Grand total (cents) including shipping:", totalCents);

    const checkoutApi = squareClient.checkoutApi;
    const idempotencyKey = crypto.randomUUID();

    const checkoutBody = {
      idempotencyKey,
      order: {
        locationId,
        lineItems,
      },
      checkoutOptions: {
        redirectUrl:
          process.env.CHECKOUT_REDIRECT_URL ||
          "https://phpstack-1556413-6032046.cloudwaysapps.com/thank-you.html",
        prePopulateBuyerEmail: customer?.email || undefined,
      },
    };

    const response = await checkoutApi.createPaymentLink(checkoutBody);
    const paymentLink = response.result.paymentLink;

    if (!paymentLink || !paymentLink.url) {
      console.error("No paymentLink.url in Square response:", response.result);
      return res
        .status(500)
        .json({ error: "Failed to create Square payment link." });
    }

    const now = new Date().toISOString();

    // Bundle shipping info in a simple object (for DB / admin use)
    const shippingInfo = {
      name: customer?.name || null,
      email: customer?.email || null,
      phone: customer?.phone || null,
      address1: customer?.address1 || null,
      address2: customer?.address2 || null,
      city: customer?.city || null,
      state: customer?.state || null,
      zip: customer?.zip || null,
      subtotalCents,
      shippingCents,
      totalCents,
    };

    const insert = db.prepare(`
      INSERT INTO orders (
        square_order_id,
        square_payment_link_id,
        customer_name,
        customer_email,
        status,
        tracking_number,
        items_json,
        total_money,
        currency,
        created_at,
        updated_at,
        shipping_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      paymentLink.orderId || null,
      paymentLink.id,
      customer?.name || null,
      customer?.email || null,
      "PENDING",
      null,
      JSON.stringify(cart), // cart items only
      totalCents,
      "USD",
      now,
      now,
      JSON.stringify(shippingInfo)
    );

    // ----- Order confirmation email -----
    const transporter = createMailTransport();
    if (transporter && customer?.email) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || customer.email,
          to: customer.email,
          subject: "We received your order – Sugar Plum Creations",
          html: `
            <p>Hi ${customer.name || "there"},</p>
            <p>Thank you for your order! Your payment link is ready:</p>
            <p><a href="${paymentLink.url}">${paymentLink.url}</a></p>
            <p>Order total: $${(totalCents / 100).toFixed(2)}${
              shippingCents === 0 ? " (includes FREE shipping)" : ""
            }</p>
            <p>If you have any questions, just reply to this email.</p>
          `,
        });
      } catch (mailErr) {
        console.error("Failed to send order confirmation email:", mailErr);
      }
    }

    res.json({ checkoutUrl: paymentLink.url });
  } catch (err) {
    console.error("Error in /checkout:", err.response?.body || err);
    res.status(500).json({ error: "Failed to start checkout" });
  }
});

// ===== Simple Admin Auth (DEV MODE – NO LOGIN) =====
// WARNING: This bypasses all admin security. Use only on your
// local machine while building/testing. Before going live,
// restore the real version with session checks.

/*
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: "Not authorized" });
}
*/

function requireAdmin(req, res, next) {
  // Dev-only: allow every request through
  return next();
}

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: "Invalid username or password." });
});

app.post("/admin/logout", (req, res) => {
  if (req.session) {
    req.session.destroy(() => {});
  }
  res.json({ ok: true });
});

app.get("/admin/me", (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ isAdmin: true });
  }
  return res.status(401).json({ error: "Not authorized" });
});

// ===== Admin Routes =====

// Get current banner + popup + shipping config (public – used by frontend)
app.get("/admin/config", (req, res) => {
  res.json(adminConfig);
});

// Update banner + popup config + shipping settings (protected)
app.put("/admin/config", requireAdmin, (req, res) => {
  const {
    bannerText,
    bannerVisible,
    popupEnabled,
    popupMode,
    popupCustomText,
    shippingFlatRate,
    freeShippingThreshold,
  } = req.body || {};

  adminConfig.bannerText = typeof bannerText === "string" ? bannerText : "";
  adminConfig.bannerVisible = !!bannerVisible;

  if (typeof popupEnabled === "boolean") {
    adminConfig.popupEnabled = popupEnabled;
  }
  if (typeof popupMode === "string") {
    adminConfig.popupMode = popupMode;
  }
  if (typeof popupCustomText === "string") {
    adminConfig.popupCustomText = popupCustomText;
  }

  // Shipping settings (numbers in dollars)
  if (shippingFlatRate !== undefined) {
    const v = Number(shippingFlatRate);
    adminConfig.shippingFlatRate = isNaN(v) ? 0 : v;
  }
  if (freeShippingThreshold !== undefined) {
    const v = Number(freeShippingThreshold);
    adminConfig.freeShippingThreshold = isNaN(v) ? 0 : v;
  }

  saveAdminConfig();
  res.json({ ok: true, config: adminConfig });
});

//
// ===== Admin: Orders from local DB (NOT from Square) =====
//

// List recent orders (for admin dashboard)
app.get("/admin/orders", requireAdmin, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT
        id,
        square_order_id,
        square_payment_link_id,
        customer_name,
        customer_email,
        status,
        tracking_number,
        total_money,
        currency,
        created_at,
        updated_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const rows = stmt.all();

    const orders = rows.map((row) => {
      let total = null;
      if (row.total_money != null) {
        total = Number(row.total_money) / 100;
      }

      return {
        id: row.id,
        createdAt: row.created_at,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        total,
        status: row.status || "PENDING",
        trackingNumber: row.tracking_number || "",
        currency: row.currency || "USD",
        squareOrderId: row.square_order_id,
        paymentLinkId: row.square_payment_link_id,
      };
    });

    res.json({ orders });
  } catch (err) {
    console.error("Error fetching local orders:", err);
    res.status(500).json({ error: "Failed to load orders." });
  }
});

// Get full details for a single order
app.get("/admin/orders/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid order id." });
    }

    const stmt = db.prepare(`
      SELECT
        id,
        square_order_id,
        square_payment_link_id,
        customer_name,
        customer_email,
        status,
        tracking_number,
        items_json,
        shipping_json,
        total_money,
        currency,
        created_at,
        updated_at
      FROM orders
      WHERE id = ?
    `);

    const row = stmt.get(id);

    if (!row) {
      return res.status(404).json({ error: "Order not found." });
    }

    let items = [];
    let shipping = null;

    try {
      if (row.items_json) items = JSON.parse(row.items_json);
    } catch (e) {
      console.error("Failed to parse items_json for order", id, e);
    }

    try {
      if (row.shipping_json) shipping = JSON.parse(row.shipping_json);
    } catch (e) {
      console.error("Failed to parse shipping_json for order", id, e);
    }

    const total =
      row.total_money != null ? Number(row.total_money) / 100 : null;

    res.json({
      id: row.id,
      squareOrderId: row.square_order_id,
      paymentLinkId: row.square_payment_link_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      status: row.status || "PENDING",
      trackingNumber: row.tracking_number || "",
      items,
      shipping,
      total,
      currency: row.currency || "USD",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    console.error("Error fetching order details:", err);
    res.status(500).json({ error: "Failed to load order details." });
  }
});

// Update order status + tracking, optionally email customer
app.put("/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid order id." });
    }

    const { status, trackingNumber, notifyCustomer } = req.body || {};

    const select = db.prepare(`
      SELECT
        id,
        customer_name,
        customer_email,
        status AS old_status,
        tracking_number AS old_tracking,
        total_money,
        currency,
        shipping_json
      FROM orders
      WHERE id = ?
    `);

    const row = select.get(id);
    if (!row) {
      return res.status(404).json({ error: "Order not found." });
    }

    const now = new Date().toISOString();

    const newStatus = typeof status === "string" ? status : row.old_status;
    const newTracking =
      typeof trackingNumber === "string"
        ? trackingNumber.trim()
        : row.old_tracking || "";

    const update = db.prepare(`
      UPDATE orders
      SET status = ?, tracking_number = ?, updated_at = ?
      WHERE id = ?
    `);

    update.run(newStatus, newTracking, now, id);

    // Optionally notify customer
    if (notifyCustomer && row.customer_email) {
      const transporter = createMailTransport();
      if (transporter) {
        try {
          let subject = "Order update – Sugar Plum Creations";
          let bodyText = `Hi ${row.customer_name || "there"},\n\n`;
          let bodyHtml = `<p>Hi ${row.customer_name || "there"},</p>`;

          if (newStatus.toUpperCase() === "SHIPPED" && newTracking) {
            subject = "Your order has shipped – Sugar Plum Creations";
            bodyText += `Your order has been shipped.\nTracking number: ${newTracking}\n\nThank you for shopping with us!`;
            bodyHtml += `<p>Your order has been shipped.</p><p><strong>Tracking number:</strong> ${newTracking}</p><p>Thank you for shopping with us!</p>`;
          } else {
            bodyText += `Your order status is now: ${newStatus}.\n\nThank you!`;
            bodyHtml += `<p>Your order status is now: <strong>${newStatus}</strong>.</p><p>Thank you!</p>`;
          }

          await transporter.sendMail({
            from: process.env.SMTP_FROM || row.customer_email,
            to: row.customer_email,
            subject,
            text: bodyText,
            html: bodyHtml,
          });
        } catch (mailErr) {
          console.error("Failed to send order update email:", mailErr);
        }
      }
    }

    return res.json({
      ok: true,
      id,
      status: newStatus,
      trackingNumber: newTracking,
      updatedAt: now,
    });
  } catch (err) {
    console.error("Error updating order:", err);
    res.status(500).json({ error: "Failed to update order." });
  }
});

// Admin: products list + flags (for inventory/feature UI)
app.get("/admin/products", requireAdmin, async (req, res) => {
  try {
    const baseProducts = await loadApparelProductsWithInventory();
    const products = baseProducts.map((p) => {
      const flags = normalizeFlags(productConfig[p.id] || {});
      const totalInventory = (p.variations || []).reduce(
        (sum, v) => sum + (v.quantity || 0),
        0
      );
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        subcategory: p.subcategory || null,
        totalInventory,
        flags,
      };
    });

    // Sort by name alphabetically
    products.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ products });
  } catch (err) {
    console.error("Error in /admin/products:", err);
    res.status(500).json({ error: "Failed to load admin products." });
  }
});

// Admin: update product flags (isNew, isFeatured, pinToTop, hides, ribbon)
app.put("/admin/products", requireAdmin, (req, res) => {
  const body = req.body || {};
  const updates = Array.isArray(body.products) ? body.products : null;

  if (!updates) {
    return res
      .status(400)
      .json({ error: "Request body must include products array." });
  }

  updates.forEach((u) => {
    if (!u || !u.id) return;

    const existing = productConfig[u.id] || {};
    const incomingFlags = u.flags || {};

    const merged = normalizeFlags({
      ...existing,
      ...incomingFlags,
    });

    productConfig[u.id] = merged;
  });

  saveProductConfig();

  res.json({ ok: true, productConfig });
});

// Create and email a monthly archive of receipts/invoices (protected)
app.post("/admin/monthly-archive", requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(EXPORTS_DIR)) {
      console.warn("EXPORTS_DIR does not exist, returning no files.");
      return res.json({
        ok: true,
        message: "No exports directory found yet; nothing to archive.",
      });
    }

    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth();
    const monthLabel = String(monthIndex + 1).padStart(2, "0");

    const allNames = fs.readdirSync(EXPORTS_DIR);
    const filesToArchive = [];

    for (const name of allNames) {
      const fullPath = path.join(EXPORTS_DIR, name);
      const stat = fs.statSync(fullPath);

      if (!stat.isFile()) continue;
      if (name.toLowerCase().endsWith(".zip")) continue;

      const mtime = stat.mtime;
      if (mtime.getFullYear() === year && mtime.getMonth() === monthIndex) {
        filesToArchive.push({ name, path: fullPath });
      }
    }

    if (filesToArchive.length === 0) {
      return res.json({
        ok: true,
        message: "No files found for the current month to archive.",
      });
    }

    const zipName = `receipts-${year}-${monthLabel}.zip`;
    const zipPath = path.join(EXPORTS_DIR, zipName);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);

      filesToArchive.forEach((file) => {
        archive.file(file.path, { name: file.name });
      });

      archive.finalize();
    });

    let msg = `Archive created: ${zipName}`;

    const smtpHost = process.env.SMTP_HOST;
    const archiveTo = process.env.ARCHIVE_EMAIL_TO;

    if (smtpHost && archiveTo) {
      const transporter = createMailTransport();

      if (transporter) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || archiveTo,
          to: archiveTo,
          subject: `Monthly Receipts Archive - ${year}-${monthLabel}`,
          text: "Attached is the monthly receipts archive from your website.",
          attachments: [
            {
              filename: zipName,
              path: zipPath,
            },
          ],
        });

        msg += " and emailed.";
      } else {
        msg += ". (Email transport not configured correctly.)";
      }
    } else {
      msg += ". (Email not configured; archive stored on server only.)";
    }

    for (const file of filesToArchive) {
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        console.error("Failed to delete original file:", file.path, e);
      }
    }

    return res.json({ ok: true, message: msg });
  } catch (err) {
    console.error("Error generating monthly archive:", err);
    return res
      .status(500)
      .json({ error: "Failed to create monthly archive." });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
