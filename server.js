// Load environment variables   
require("dotenv").config();

// ===== DEBUG ENV KEYS FOR SQUARE / RENDER =====
console.log("DEBUG NODE_ENV:", process.env.NODE_ENV);
console.log(
  "DEBUG SQUARE env keys:",
  Object.keys(process.env).filter((k) => k.includes("SQUARE"))
);
if (process.env.SQUARE_ACCESS_TOKEN) {
  console.log(
    "DEBUG SQUARE_ACCESS_TOKEN present, length:",
    process.env.SQUARE_ACCESS_TOKEN.length
  );
} else {
  console.log("DEBUG SQUARE_ACCESS_TOKEN is MISSING at process.env level");
}

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

// Optional PDF support (packing list)
let PDFDocument = null;
try {
  PDFDocument = require("pdfkit");
} catch (err) {
  console.warn(
    'pdfkit not installed; packing slip PDF endpoint "/admin/orders/:id/packing-slip" will be disabled.'
  );
}

// ===== EMAIL CONFIG & HELPERS =====
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM,
  EMAIL_OWNER,
} = process.env;

const FROM_EMAIL = EMAIL_FROM || SMTP_USER;

let mailTransporter = null;

if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && EMAIL_FROM) {
  mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // true for 465, false for 587/25
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
} else {
  console.warn(
    "Email not fully configured – missing SMTP_* or EMAIL_FROM in .env"
  );
}

async function sendEmail({ to, subject, text, html, bcc }) {
  if (!mailTransporter) {
    console.warn("sendEmail called but transporter is not configured");
    return;
  }

  const message = {
    from: `"Sugar Plum Creations" <${FROM_EMAIL}>`,
    to,
    subject,
    text: text || "",
    html: html || text || "",
  };

  if (bcc) {
    message.bcc = bcc;
  }

  try {
    await mailTransporter.sendMail(message);
  } catch (err) {
    console.error("Error sending email:", err);
  }
}

// Try to turn a tracking number into a clickable URL
function buildTrackingUrl(trackingNumber) {
  if (!trackingNumber) return null;
  const trimmed = trackingNumber.trim();

  // If they pasted a full URL, just use it
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Otherwise, send them to a universal tracking page
  return `https://www.17track.net/en/track?nums=${encodeURIComponent(trimmed)}`;
}

// Build a branded SPC email HTML body
function buildBrandedEmail({
  title,
  intro,
  lines = [],
  trackingNumber,
  trackingUrl, // kept for future use if you ever re-add a button
  footerNote,
  ctaLabel,
  ctaUrl,
}) {
  const safeTitle = title || "Sugar Plum Creations";
  const safeIntro = intro || "";
  const footer = footerNote || "Thank you for supporting our small business!";

  const logoUrl = "https://shopsugarplum.co/spc-logo-round.png";

  const baseFontStack =
    "'Handwash','Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,Arial,sans-serif";

  const linesHtml = lines
    .map(
      (line) =>
        `<p style="margin: 0 0 6px; font-size: 14px; font-family:${baseFontStack}; color:#fff5ff;">${line}</p>`
    )
    .join("");

  // Tracking block with ONLY tracking number pill (no 17track button)
  let trackingHtml = "";
  if (trackingNumber) {
    trackingHtml += `
      <div style="margin-top: 16px;">
        <p style="
          margin: 0 0 8px;
          font-size: 14px;
          font-family:${baseFontStack};
          color:#fff5ff;
        ">
          <strong>Tracking:</strong>
        </p>

        <!-- Tracking Number Pill -->
        <div style="margin-bottom: 12px;">
          <span style="
            display:inline-block;
            border:none;
            border-radius:999px;
            padding:0.35rem 0.75rem;
            font-size:0.9rem;
            background:#ffffff;
            color:#6a4d7a;
            font-weight:600;
            font-family:${baseFontStack};
          ">
            ${trackingNumber}
          </span>
        </div>
      </div>
    `;
  }

  // Main CTA button (for things like "Pay Now", "View Order", etc.)
  let ctaHtml = "";
  if (ctaLabel && ctaUrl) {
    ctaHtml = `
      <div style="margin-top: 24px; text-align: center;">
        <a href="${ctaUrl}"
           style="
             display:inline-block;
             border:none;
             border-radius:999px;
             padding:0.4rem 0.9rem;
             font-size:0.9rem;
             cursor:pointer;
             background:#ffffff;
             color:#6a4d7a;
             text-decoration:none;
             font-family:${baseFontStack};
             font-weight:600;
           ">
          ${ctaLabel}
        </a>
      </div>
    `;
  }

  return `
  <div style="
    background-color:#4c256c;
    padding:24px 0;
    font-family:${baseFontStack};
  ">
    <div style="
      max-width:600px;
      margin:0 auto;
      background-color:#4f365e;
      border-radius:16px;
      box-shadow:0 4px 16px rgba(0,0,0,0.25);
      overflow:hidden;
      border:2px solid #b42ea0;
    ">
      <!-- Header -->
      <div style="
        background: radial-gradient(circle at top, #3b2035 0, #000000 55%);
        padding:20px 16px;
        text-align:center;
      ">
        <img
          src="${logoUrl}"
          alt="Sugar Plum Creations"
          style="
            width:72px;
            height:72px;
            border-radius:50%;
            display:block;
            margin:0 auto 10px;
            border:3px solid #ffffff;
          "
        />
        <h1 style="
          margin:0;
          font-size:24px;
          color:#ffffff;
          font-family:'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,Arial,sans-serif;
          letter-spacing:0.03em;
          font-weight:600;
        ">
          ${safeTitle}
        </h1>
      </div>

      <!-- Body -->
      <div style="padding:20px 24px 24px 24px;">
        <p style="
          margin:0 0 12px;
          font-size:15px;
          color:#fff5ff;
          font-family:${baseFontStack};
        ">
          ${safeIntro}
        </p>
        ${linesHtml}
        ${trackingHtml}
        ${ctaHtml}
      </div>

      <!-- Footer -->
      <div style="
        padding:12px 24px;
        border-top:1px solid rgba(255,255,255,0.15);
        background-color:#5a3f6c;
        font-size:12px;
        color:#f4ddff;
        text-align:center;
      ">
        <p style="
          margin:0 0 4px;
          font-family:${baseFontStack};
        ">
          ${footer}
        </p>
        <p style="
          margin:0;
          color:#e4c8ff;
          font-size:11px;
          font-family:${baseFontStack};
        ">
          Sugar Plum Creations • shopsugarplum.co
        </p>
      </div>
    </div>
  </div>
  `;
}

// Pretty-print order lines for internal emails
function formatOrderForEmail(order) {
  let itemsBlock = "";

  try {
    const raw = order.items_json || order.cart_json || order.itemsJson;
    if (raw) {
      const items = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(items)) {
        itemsBlock =
          "\n\nItems:\n" +
          items
            .map((it) => {
              const bits = [];
              if (it.name) bits.push(it.name);
              if (it.type) bits.push(it.type);
              if (it.color) bits.push(it.color);
              if (it.size) bits.push(it.size);
              if (it.printSide) bits.push(it.printSide);
              const lineHead = bits.join(" • ") || "Item";
              const qty = it.quantity || it.qty || 1;
              const price = it.price ? (it.price / 100).toFixed(2) : "";
              return `- ${lineHead}  x${qty}${
                price ? ` @ $${price}` : ""
              }`;
            })
            .join("\n");
      }
    }
  } catch (e) {
    console.warn("Could not parse order items JSON for email:", e);
  }

  if (!itemsBlock) {
    itemsBlock =
      "\n\nRaw order JSON:\n" + JSON.stringify(order, null, 2);
  }

  return itemsBlock;
}

// Send internal "new order" email (when status becomes PAID)
async function sendNewOrderAlert(order) {
  if (!EMAIL_OWNER) return;

  const subject = `New order #${order.id || ""} – ${order.status || "Paid"}`;
  const text =
    `You have a new order.\n\n` +
    `Customer: ${order.customer_name || ""}\n` +
    `Email: ${order.customer_email || ""}\n` +
    `Status: ${order.status || ""}\n` +
    (order.total_amount
      ? `Total: $${(order.total_amount / 100).toFixed(2)}\n`
      : "") +
    formatOrderForEmail(order);

  await sendEmail({
    to: EMAIL_OWNER,
    subject,
    text,
  });
}

// Customer emails for status changes (HTML, branded)
async function sendCustomerStatusEmail(order, newStatus) {
  const to = order.customer_email;
  if (!to) return;

  const status = newStatus.toUpperCase();
  let subject = "";
  let html = "";
  let bcc = undefined;

  const trackingNumber = order.tracking_number || "";
  const trackingUrl = buildTrackingUrl(trackingNumber);

  const total = order.total_amount
    ? `$${(order.total_amount / 100).toFixed(2)}`
    : null;

  let items = [];
  try {
    const parsed = JSON.parse(order.items_json || "[]");
    items = parsed.map(
      (i) => `${i.quantity} × ${i.name} — $${(i.price / 100).toFixed(2)}`
    );
  } catch (e) {
    console.error("Failed to parse items_json:", e);
  }

  if (status === "PAID") {
    subject = "Sugar Plum Creations – Order Confirmation";

    html = buildBrandedEmail({
      title: "Order Confirmation",
      intro: `Thank you for your order, ${
        order.customer_name || "friend"
      }! 🎉`,
      lines: [
        ...(total ? [`Order Total: ${total}`] : []),
        `Order ID: ${order.id}`,
        "",
        ...items,
        "",
        "We’ll notify you again when your order ships.",
      ],
      footerNote: "Thank you for supporting our small business!",
    });

    // BCC you on confirmation
    bcc = EMAIL_OWNER;
  } else if (status === "SHIPPED") {
    subject = "Your Sugar Plum Creations Order Has Shipped";

    html = buildBrandedEmail({
      title: "Order Shipped",
      intro: `Good news! Your Sugar Plum Creations order is on the way. 📦`,
      lines: [
        ...(total ? [`Order Total: ${total}`] : []),
        `Order ID: ${order.id}`,
      ],
      trackingNumber: trackingNumber || null,
      trackingUrl: trackingUrl || null,
      footerNote: "We appreciate your support!",
    });
  } else {
    return;
  }

  await sendEmail({
    to,
    subject,
    html,
    bcc,
  });
}

// Central helper to fire emails on status change
async function handleOrderStatusEmails(order, oldStatus, newStatus) {
  const previous = (oldStatus || "").toUpperCase();
  const next = (newStatus || "").toUpperCase();

  if (previous === next) return;

  if (next === "PAID") {
    await sendCustomerStatusEmail(order, "PAID");
    await sendNewOrderAlert(order);
  }

  if (next === "SHIPPED") {
    await sendCustomerStatusEmail(order, "SHIPPED");
  }
}

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

// Load configs once when server starts
loadAdminConfig();
loadProductConfig();

// Use the LEGACY Square SDK
const { Client, Environment } = require("square/legacy");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static admin assets (HTML/CSS/JS) from ./public
app.use(express.static(path.join(__dirname, "public")));

// ===== Render / proxy awareness (HTTPS cookies, etc.) =====
if (process.env.NODE_ENV === "production") {
  // Required so Express trusts Render's proxy and sees HTTPS correctly
  app.set("trust proxy", 1);
}

// ===== Middleware =====

// CORS: allow localhost for dev + shopsugarplum.co for production.
// Safari + cross-site cookies REQUIRE these headers to be exact.
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests without Origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowed = [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://shopsugarplum.co",
      "https://www.shopsugarplum.co",
      "https://sugarplum-backend.onrender.com", // ✅ allow backend-hosted admin pages
    ];

    if (allowed.includes(origin)) {
      return callback(null, true);
    }

    // In development: allow everything
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },

  // REQUIRED FOR SAFARI + cross-site sessions
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
  ],
};

// Apply CORS with credentials support
app.use(cors(corsOptions));

// Extra headers to satisfy Safari & iOS WebKit
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

// *** BODY PARSERS (for JSON form posts like /admin/login, /checkout, etc.) ***
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== SESSION CONFIG (CROSS-SITE SAFE, WORKS WITH shopsugarplum.co FRONTEND) =====
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Needed for cross-site cookies (frontend on shopsugarplum.co,
      // backend on sugarplum-backend.onrender.com)
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      // IMPORTANT: do NOT set "domain" here; let it default
      // to sugarplum-backend.onrender.com so the cookie is accepted.
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
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

// ---------- Parse variation name into size + color (IMPROVED) ----------
function parseVariationName(vName) {
  if (!vName) return { size: null, color: null };

  const original = vName;
  const parts = vName
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Normalized list of size "tokens" we care about
  const SIZE_TOKENS = [
    "nb",
    "0-3m",
    "3-6m",
    "6-9m",
    "6-12m",
    "12m",
    "18m",
    "24m",
    "2t",
    "3t",
    "4t",
    "5t",
    "ys",
    "ym",
    "yl",
    "yxl",
    "xs",
    "s",
    "m",
    "l",
    "xl",
    "xxl",
    "xxxl",
    "xxxxl",
    "2x",
    "2xl",
    "3x",
    "3xl",
    "4x",
    "4xl",
    "5x",
    "5xl",
  ];

  function looksLikeSize(partLower) {
    const normalized = partLower.replace(/\s+/g, "");

    // S / M / L / XL / 2X style
    if (SIZE_TOKENS.includes(normalized)) return true;

    // Words like "small", "medium", "large"
    if (
      normalized === "small" ||
      normalized === "medium" ||
      normalized === "large"
    ) {
      return true;
    }

    // Youth / toddler / 2T etc.
    if (
      normalized.includes("youth") ||
      normalized.includes("toddler") ||
      /^\d+t$/.test(normalized)
    ) {
      return true;
    }

    return false;
  }

  let size = null;
  let color = null;

  parts.forEach((part) => {
    const lower = part.toLowerCase();

    const isGarmentWord =
      lower.includes("shirt") ||
      lower.includes("t-shirt") ||
      lower.includes("tee") ||
      lower.includes("tank") ||
      lower.includes("hoodie") ||
      lower.includes("sweatshirt");

    if (looksLikeSize(lower)) {
      if (!size) size = part;
    } else if (!isGarmentWord && !color) {
      color = part;
    }
  });

  // Special handling for names like "Hot Pink Youth X-Small"
  if (!size) {
    const lowerFull = original.toLowerCase();

    if (
      lowerFull.includes("youth x-small") ||
      lowerFull.includes("youth x small")
    ) {
      size = "Youth X-Small";

      const youthIndex = lowerFull.indexOf("youth");
      if (youthIndex > 0 && !color) {
        const colorRaw = original.slice(0, youthIndex).trim();
        if (colorRaw) {
          color = colorRaw;
        }
      }
    }
  }

  // Normalize "Small/Medium/Large" to S/M/L so they line up
  if (size) {
    const sLower = size.toLowerCase().trim();
    if (sLower === "small") size = "S";
    else if (sLower === "medium") size = "M";
    else if (sLower === "large") size = "L";
  }

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

//
// ===== CATALOG & INVENTORY CACHING (MASTER LIST) =====
//
// Catalog is slow-changing (names, images, etc.)
// Inventory is fast-changing (quantities)
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INVENTORY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// cachedCatalog: apparel items with variations (size/color/price) but NO quantities
let cachedCatalog = null;
let lastCatalogFetch = 0;

// cachedBaseProducts: same as catalog but with quantity on each variation
let cachedBaseProducts = null;
let lastInventoryFetch = 0;

// ===== Custom Attribute keys (for variations) =====
// Change this string if your Square custom attribute key is different.
const PRINT_LOCATION_CA_KEY = "print_location";

// ----- Refresh catalog from Square (slow but rare) -----
async function refreshCatalogFromSquare() {
  console.log("Refreshing catalog from Square (full catalog fetch)...");
  const catalogApi = squareClient.catalogApi;

  let cursor = undefined;
  const allObjects = [];

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

    // Skip generic "T-Shirt" template items
    if (
      rawName === "T-Shirt" &&
      !data.imageUrl &&
      allSizesNull &&
      allColorsRegular
    ) {
      continue;
    }

    apparelItems.push(item);
  }

  console.log("Total apparel ITEMs:", apparelItems.length);

  const normalizedCatalog = [];

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

    const variations = (data.variations || []).map((v) => {
      const vData = v.itemVariationData || {};
      const { size, color } = parseVariationName(vData.name || "");

      let price = 0;
      if (vData.priceMoney && vData.priceMoney.amount != null) {
        price = Number(vData.priceMoney.amount) / 100;
      }

      // NEW: read custom attribute for print location (if defined)
      const ca = v.customAttributeValues || {};
      let printLocation = null;
      if (
        ca[PRINT_LOCATION_CA_KEY] &&
        typeof ca[PRINT_LOCATION_CA_KEY].stringValue === "string"
      ) {
        printLocation = ca[PRINT_LOCATION_CA_KEY].stringValue.trim();
      }

      return {
        id: v.id,
        name: vData.name,
        price,
        size,
        color,
        printLocation, // <-- new field (may be null for now)
        // quantity will be filled in by inventory refresh
      };
    });

    normalizedCatalog.push({
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

  cachedCatalog = normalizedCatalog;
  cachedBaseProducts = null; // force inventory rebuild
  lastCatalogFetch = Date.now();
  lastInventoryFetch = 0;

  console.log(
    `Catalog refresh complete. Apparel items in catalog: ${cachedCatalog.length}`
  );
}

// ----- Refresh inventory only (fast; uses cached catalog) -----
async function refreshInventoryForCatalog() {
  const inventoryApi = squareClient.inventoryApi;

  if (!cachedCatalog || cachedCatalog.length === 0) {
    console.log(
      "Inventory refresh requested but catalog is empty; refreshing catalog first..."
    );
    await refreshCatalogFromSquare();
  }

  const allVariationIds = [];
  cachedCatalog.forEach((item) => {
    (item.variations || []).forEach((v) => {
      if (v.id) allVariationIds.push(v.id);
    });
  });

  console.log(
    "Refreshing inventory for variation IDs count:",
    allVariationIds.length
  );

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

  const newBaseProducts = cachedCatalog.map((item) => {
    const variationsWithQty = (item.variations || []).map((v) => {
      const quantity = quantityByVariationId[v.id] ?? 0;
      return {
        ...v,
        quantity,
      };
    });

    return {
      ...item,
      variations: variationsWithQty,
    };
  });

  cachedBaseProducts = newBaseProducts;
  lastInventoryFetch = Date.now();

  console.log(
    `Inventory refresh complete at ${new Date(
      lastInventoryFetch
    ).toISOString()}`
  );
}

// ----- Ensure catalog is reasonably fresh -----
async function ensureCatalogFresh() {
  const now = Date.now();

  if (!cachedCatalog || cachedCatalog.length === 0) {
    await refreshCatalogFromSquare();
    return;
  }

  if (now - lastCatalogFetch > CATALOG_TTL_MS) {
    console.log("Catalog TTL expired; refreshing catalog from Square...");
    await refreshCatalogFromSquare();
  }
}

// ----- Ensure we have at least one inventory snapshot -----
async function ensureInventoryInitialized() {
  if (!cachedBaseProducts) {
    console.log("No cached inventory; doing initial inventory fetch...");
    await refreshInventoryForCatalog();
  }
}

//
// ============== PRODUCTS ENDPOINT ==============
// Uses cached master list (catalog + inventory) + product flags + sorting
//
app.get("/products", async (req, res) => {
  console.log("HIT /products");
  try {
    // 1) Make sure catalog exists / is fresh-ish (rare)
    await ensureCatalogFresh();

    // 2) Make sure we have *some* inventory snapshot
    await ensureInventoryInitialized();

    // 3) If inventory snapshot is older than INVENTORY_TTL_MS,
    //    kick off a background refresh (but still respond immediately)
    const now = Date.now();
    if (now - lastInventoryFetch > INVENTORY_TTL_MS) {
      console.log(
        "Inventory TTL expired; kicking off background inventory refresh..."
      );
      refreshInventoryForCatalog().catch((err) =>
        console.error("Background inventory refresh failed:", err)
      );
    }

    const baseProducts = cachedBaseProducts || [];

    // Attach flags from productConfig
    let decorated = baseProducts.map((p) => {
      const flagsRaw = productConfig[p.id] || {};
      const flags = normalizeFlags(flagsRaw);
      return { ...p, flags };
    });

    // Hide from online shop if flagged
    decorated = decorated.filter((p) => !p.flags.hideOnline);

    // NEW: normalize variations for frontend
    // - Ensure each variation has:
    //   - priceCents (integer, in cents)
    //   - catalogObjectId (Square variation id)
    decorated = decorated.map((p) => {
      const normalizedVariations = (p.variations || []).map((v) => {
        const priceNumber =
          typeof v.price === "number" && !Number.isNaN(v.price)
            ? v.price
            : 0;

        return {
          ...v,
          // Square variation id is already v.id in our catalog
          catalogObjectId: v.id,
          // Convert dollars -> cents so frontend can use it directly
          priceCents: Math.round(priceNumber * 100),
        };
      });

      return {
        ...p,
        variations: normalizedVariations,
      };
    });

    // NEW: hide items that are completely out of stock (all variations qty <= 0)
    decorated = decorated.filter((p) =>
      (p.variations || []).some((v) => (v.quantity || 0) > 0)
    );

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
    console.error("Square / caching error in /products:", error);
    res.status(500).json({ error: "Error loading products from Square" });
  }
});

//
// ============== DEBUG CATALOG ENDPOINT ==============
// (Still talks directly to Square; dev / debug use only)
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
// ===== HELPER FOR CHECKOUT NOTES (DESIGN LOCATION / PRINT SIDE) =====
//
function buildLineItemNote(item) {
  const bits = [];

  if (item.type && item.type !== "Other") bits.push(item.type);
  if (item.color) bits.push(item.color);
  if (item.size) bits.push(item.size);
  if (item.printSide) bits.push(`Print: ${item.printSide}`);

  return bits.join(" • ");
}
// ===== SERVER-SIDE INVENTORY HELPERS (for final checkout guard) =====

// Safely pull quantity from a backend variation object
function extractQtyFromServerVariation(v) {
  if (!v) return null;

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

// Given a cart item + baseProducts, return how many we believe are available
function getServerAvailableQtyForCartItem(cartItem, baseProducts) {
  if (!cartItem || !Array.isArray(baseProducts)) return 0;

  const productId = cartItem.id || cartItem.productId;
  if (!productId) return 0;

  const product =
    baseProducts.find(
      (p) => p.id === productId || p.squareItemId === productId
    ) || null;

  if (!product) return 0;

  // Prefer variation-level inventory if we can match a variation
  if (Array.isArray(product.variations) && product.variations.length > 0) {
    const varId = cartItem.squareVariationId || cartItem.catalogObjectId || null;

    let variation = null;

    // 1) Try matching by variation ID / catalogObjectId
    if (varId) {
      variation =
        product.variations.find(
          (v) =>
            v.id === varId ||
            v.catalogObjectId === varId ||
            v.squareCatalogObjectId === varId
        ) || null;
    }

    // 2) Fallback: match by color + size
    if (!variation) {
      const colorLower = (cartItem.color || "").toLowerCase();
      const sizeLower = (cartItem.size || "").toLowerCase();

      variation =
        product.variations.find((v) => {
          const vColor = (v.color || "").toLowerCase();
          const vSize = (v.size || "").toLowerCase();
          return vColor === colorLower && vSize === sizeLower;
        }) || null;
    }

    if (variation) {
      const q = extractQtyFromServerVariation(variation);
      if (typeof q === "number") {
        return q;
      }
    }
  }

  // Fall back to product-level inventory if present
  if (typeof product.inventory === "number") {
    return product.inventory;
  }

  // Unknown → treat as 0 for conservative guard
  return 0;
}

// ============== CHECKOUT ENDPOINT ==============
// Uses adminConfig.shippingFlatRate + adminConfig.freeShippingThreshold
// to add a "Shipping" line item to the Square Payment Link.
// Also performs a final inventory check to prevent overselling.
//
// Line items are tied to Square catalog variations via catalogObjectId
// so inventory is decremented correctly on Square's side. We are NOT
// manually adding a SHIPMENT fulfillment here; instead we rely on
// checkoutOptions.askForShippingAddress so Square creates the shipment.
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

    // ----- FINAL INVENTORY CHECK (server-side guard) -----
    try {
      console.log("Checkout: performing final inventory validation...");

      // Make sure catalog + inventory snapshot are fresh
      await ensureCatalogFresh();
      await ensureInventoryInitialized();
      await refreshInventoryForCatalog();

      const baseProducts = cachedBaseProducts || [];
      const conflicts = [];

      for (const item of cart) {
        const requestedQty =
          Number(item.quantity || item.qty || 1) > 0
            ? Number(item.quantity || item.qty || 1)
            : 1;

        const availableQty = getServerAvailableQtyForCartItem(
          item,
          baseProducts
        );

        if (availableQty <= 0 || requestedQty > availableQty) {
          conflicts.push({
            productId: item.id || null,
            name: item.name || "Item",
            color: item.color || null,
            size: item.size || null,
            requestedQty,
            availableQty: Math.max(availableQty, 0),
          });
        }
      }

      if (conflicts.length > 0) {
        console.warn(
          "Checkout blocked due to out-of-stock conflicts:",
          conflicts
        );
        return res.status(409).json({
          error:
            "Some items in your cart are no longer available in the requested quantity.",
          type: "OUT_OF_STOCK",
          conflicts,
        });
      }

      console.log("Checkout: inventory validation passed.");
    } catch (invErr) {
      console.error("Inventory validation during checkout failed:", invErr);
      return res.status(500).json({
        error:
          "We had trouble validating stock for your cart. Please refresh the page and try again.",
      });
    }

    // ----- Build Square line items (TIE TO CATALOG VARIATIONS) -----
    const productLineItems = cart.map((item) => {
      const qty = item.quantity || item.qty || 1;
      const priceCents = item.price || 0; // price already in cents from frontend

      // Keep current name style with color/size in parentheses
      const optionParts = [item.color, item.size].filter(Boolean);
      const baseName = item.name || "Item";
      const displayName =
        optionParts.length > 0
          ? `${baseName} (${optionParts.join(" / ")})`
          : baseName;

      // IMPORTANT: tie back to Square catalog so inventory is decremented.
      const catalogObjectId =
        item.catalogObjectId ||
        item.squareVariationId ||
        item.squareCatalogObjectId ||
        null;

      const lineItem = {
        quantity: String(qty),
        name: displayName,
        basePriceMoney: {
          amount: priceCents,
          currency: "USD",
        },
      };

      if (catalogObjectId) {
        lineItem.catalogObjectId = catalogObjectId;
      }

      // Include design location / print side + details in the line item note
      const note = buildLineItemNote(item);
      if (note) {
        lineItem.note = note;
      }

      return lineItem;
    });

    // Subtotal in cents for PRODUCTS ONLY (no shipping/fees/tax yet)
    const subtotalCents = productLineItems.reduce(
      (sum, li) =>
        sum +
        Number(li.basePriceMoney.amount) * Number(li.quantity || "1"),
      0
    );
    console.log("Computed subtotal (cents):", subtotalCents);

    if (subtotalCents <= 0) {
      return res.status(400).json({ error: "Invalid cart total" });
    }

    // Start with product line items, then append shipping/fee/tax
    const lineItems = [...productLineItems];

    // ----- Shipping calculation (flat rate + free shipping) -----
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

    // ----- 3% Convenience / Card Processing Fee -----
    const FEE_PERCENT = 0.03;
    const feeBaseCents = subtotalCents + shippingCents;
    const convenienceFeeCents = Math.round(feeBaseCents * FEE_PERCENT);

    if (convenienceFeeCents > 0) {
      lineItems.push({
        name: "Convenience Fee (3%)",
        quantity: "1",
        basePriceMoney: {
          amount: convenienceFeeCents,
          currency: "USD",
        },
      });
    }

    // ----- 7% Sales Tax (MS only, on items + shipping, NOT the 3% fee) -----
    let salesTaxCents = 0;

    const shippingState = (customer?.state || "")
      .toString()
      .trim()
      .toUpperCase();

    if (shippingState === "MS") {
      const SALES_TAX_RATE = 0.07;
      const taxBaseCents = subtotalCents + shippingCents;
      salesTaxCents = Math.round(taxBaseCents * SALES_TAX_RATE);
    }

    if (salesTaxCents > 0) {
      lineItems.push({
        name: "Sales Tax (7%)",
        quantity: "1",
        basePriceMoney: {
          amount: salesTaxCents,
          currency: "USD",
        },
      });
    }

    const totalCents =
      subtotalCents + shippingCents + convenienceFeeCents + salesTaxCents;

    console.log(
      "Grand total (cents) including shipping + fee + tax:",
      totalCents
    );

    const checkoutApi = squareClient.checkoutApi;
    const idempotencyKey = crypto.randomUUID();

    // No manual fulfillments; rely on askForShippingAddress so Square
    // creates a SHIPMENT fulfillment automatically.
    const checkoutBody = {
      idempotencyKey,
      order: {
        locationId,
        lineItems,
      },
      checkoutOptions: {
        redirectUrl:
          process.env.CHECKOUT_REDIRECT_URL ||
          "https://shopsugarplum.co/thank-you.html",

        // This causes Square to treat the order as a shipping order
        askForShippingAddress: true,

        // Pre-fill email & shipping address from the customer's form
        prePopulateBuyerEmail: customer?.email || undefined,
        shippingAddress: {
          addressLine1: customer?.address1 || undefined,
          addressLine2: customer?.address2 || undefined,
          locality: customer?.city || undefined,
          administrativeDistrictLevel1: customer?.state || undefined,
          postalCode: customer?.postalCode || undefined,
          country: "US",
        },
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

    const shippingInfo = {
      name: customer?.name || null,
      email: customer?.email || null,
      phone: customer?.phone || null,
      address1: customer?.address1 || null,
      address2: customer?.address2 || null,
      city: customer?.city || null,
      state: customer?.state || null,
      zip: customer?.postalCode || null,
      subtotalCents,
      shippingCents,
      convenienceFeeCents,
      salesTaxCents,
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
      JSON.stringify(cart),
      totalCents,
      "USD",
      now,
      now,
      JSON.stringify(shippingInfo)
    );

    // Order email (no payment button, payment is via Square)
    if (customer?.email) {
      try {
        const introLine = `Hi ${
          customer.name || "there"
        }, your order has been created. An order confirmation email will follow after the payment has been verified on Square. Thank you for your purchase!`;

        const emailHtml = buildBrandedEmail({
          title: "Order Created",
          intro: introLine,
          lines: [
            `Order total: $${(totalCents / 100).toFixed(2)}${
              shippingCents === 0 ? " (includes FREE shipping)" : ""
            }`,
          ],
          footerNote: "Thank you for supporting our small business!",
        });

        await sendEmail({
          to: customer.email,
          subject: "We received your order – Sugar Plum Creations",
          html: emailHtml,
          bcc: EMAIL_OWNER || undefined,
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



// ===== ADMIN: REFRESH INVENTORY (THANK-YOU PING) =====
// Called by thank-you.html after a successful Square checkout.
// Safely refreshes catalog + inventory snapshot so the shop reflects
// the latest stock as soon as possible.
app.post("/admin/refresh-inventory", async (req, res) => {
  try {
    console.log("[/admin/refresh-inventory] Thank-you page ping received.");

    // Make sure our catalog + inventory caches are fresh
    await ensureCatalogFresh();
    await ensureInventoryInitialized();
    await refreshInventoryForCatalog();

    const now = new Date().toISOString();
    console.log(
      "[/admin/refresh-inventory] Inventory refresh completed at",
      now
    );

    return res.json({ ok: true, refreshedAt: now });
  } catch (err) {
    console.error(
      "[/admin/refresh-inventory] Failed to refresh inventory:",
      err
    );
    return res.status(500).json({
      ok: false,
      error: "Failed to refresh inventory snapshot.",
    });
  }
});

// ===== DEBUG: test email endpoint =====
app.get("/debug/email-test", async (req, res) => {
  try {
    const to = process.env.EMAIL_OWNER || process.env.EMAIL_FROM;

    if (!to) {
      return res
        .status(500)
        .json({ error: "EMAIL_OWNER or EMAIL_FROM not set" });
    }

    const testHtml = `
      <p><strong>Brevo SMTP Test</strong></p>
      <p>This email confirms your Brevo SMTP is working for Sugar Plum Creations.</p>
    `;

    if (!mailTransporter) {
      return res
        .status(500)
        .json({ error: "Mail transporter not configured" });
    }

    await mailTransporter.sendMail({
      from: `"Sugar Plum Creations" <${FROM_EMAIL}>`,
      to,
      subject: "Sugar Plum – Brevo SMTP Test",
      html: testHtml,
    });

    res.json({ ok: true, to });
  } catch (err) {
    console.error("Email test error:", err);
    res.status(500).json({
      error: "Failed to send test email",
      details: err.message,
    });
  }
});

// ===== DEBUG: sample customer email (PAID / SHIPPED) =====
app.get("/debug/email-sample", async (req, res) => {
  try {
    if (!mailTransporter) {
      return res
        .status(500)
        .json({ error: "Mail transporter not configured" });
    }

    // ?type=paid or ?type=shipped (default = paid)
    const typeRaw = (req.query.type || "paid").toString().toUpperCase();
    const type = typeRaw === "SHIPPED" ? "SHIPPED" : "PAID";

    // you can override recipient with ?to=some@email
    const to = req.query.to || EMAIL_OWNER || EMAIL_FROM;

    if (!to) {
      return res.status(500).json({
        error:
          "No recipient email found. Set EMAIL_OWNER or EMAIL_FROM, or pass ?to= email.",
      });
    }

    // Fake order for preview
    const fakeOrder = {
      id: 1234,
      customer_name: "Sample Customer",
      customer_email: to,
      status: type,
      total_amount: 5600, // $56.00 in cents
      tracking_number:
        type === "SHIPPED" ? "9400 1000 0000 0000 0000 00" : "",
      items_json: JSON.stringify([
        {
          name: "Ducks Bucks & Trucks Tee",
          quantity: 1,
          price: 2600, // $26.00
        },
        {
          name: "Merry & Bright Hoodie",
          quantity: 1,
          price: 3000, // $30.00
        },
      ]),
    };

    await sendCustomerStatusEmail(fakeOrder, type);

    res.json({
      ok: true,
      to,
      sampleType: type,
      message: `Sample ${type} email sent to ${to}`,
    });
  } catch (err) {
    console.error("Email sample error:", err);
    res.status(500).json({
      error: "Failed to send sample email",
      details: err.message,
    });
  }
});

// ===== Simple Admin Auth =====
function requireAdmin(req, res, next) {
  if (process.env.NODE_ENV !== "production") {
    // Dev mode: skip auth locally
    return next();
  }

  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: "Not authorized" });
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
// ===== Admin: Products & Sync (uses cached master list) =====
//

// Admin: trigger full catalog + inventory sync now
app.post("/admin/sync/catalog", requireAdmin, async (req, res) => {
  try {
    await refreshCatalogFromSquare();
    await refreshInventoryForCatalog();

    const itemCount = cachedCatalog ? cachedCatalog.length : 0;
    let variationCount = 0;
    if (cachedCatalog) {
      cachedCatalog.forEach((p) => {
        variationCount += (p.variations || []).length;
      });
    }

    res.json({
      ok: true,
      message: "Catalog + inventory sync completed.",
      catalogItems: itemCount,
      variationCount,
      lastCatalogFetch,
      lastInventoryFetch,
    });
  } catch (err) {
    console.error("Error in /admin/sync/catalog:", err);
    res.status(500).json({ error: "Failed to sync catalog." });
  }
});

// Admin: trigger inventory-only sync now
app.post("/admin/sync/inventory", requireAdmin, async (req, res) => {
  try {
    await refreshInventoryForCatalog();

    let variationCount = 0;
    if (cachedBaseProducts) {
      cachedBaseProducts.forEach((p) => {
        variationCount += (p.variations || []).length;
      });
    }

    res.json({
      ok: true,
      message: "Inventory sync completed.",
      lastInventoryFetch,
      variationCount,
    });
  } catch (err) {
    console.error("Error in /admin/sync/inventory:", err);
    res.status(500).json({ error: "Failed to sync inventory." });
  }
});

// Admin: products list + flags (for inventory/feature UI)
app.get("/admin/products", requireAdmin, async (req, res) => {
  try {
    await ensureCatalogFresh();
    await ensureInventoryInitialized();

    const baseProducts = cachedBaseProducts || [];

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

    res.json({
      products,
      lastCatalogFetch,
      lastInventoryFetch,
    });
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

//
// ===== Admin: Orders from local DB (NOT from Square) =====
//

// Helper: accept either local numeric id, square_order_id, or square_payment_link_id
function resolveOrderId(rawId) {
  if (!rawId) return null;
  const trimmed = String(rawId).trim();
  if (!trimmed) return null;

  // If it's a positive integer, use it directly
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    return asNumber;
  }

  // Otherwise, try to resolve via Square IDs
  try {
    const lookup = db
      .prepare(
        `
        SELECT id
        FROM orders
        WHERE square_order_id = ?
           OR square_payment_link_id = ?
      `
      )
      .get(trimmed, trimmed);

    if (lookup && lookup.id) {
      return lookup.id;
    }
  } catch (err) {
    console.error("Error resolving order id from Square IDs:", err);
  }

  return null;
}

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
      WHERE status != 'ARCHIVED'
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

// =========================
// ARCHIVE DOWNLOAD ROUTE
// MUST be placed BEFORE /admin/orders/:id
// =========================
app.get("/admin/orders/archive-download", requireAdmin, async (req, res) => {
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
        items_json,
        shipping_json,
        total_money,
        currency,
        created_at,
        updated_at
      FROM orders
      WHERE status = 'ARCHIVED'
      ORDER BY created_at ASC
    `);

    const rows = stmt.all();

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No archived orders to download.",
      });
    }

    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    const now = new Date();
    const stamp = now.toISOString().split("T")[0];
    const zipName = `orders-archive-${stamp}.zip`;
    const zipPath = path.join(EXPORTS_DIR, zipName);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);
      archive.append(JSON.stringify(rows, null, 2), { name: "orders.json" });
      archive.finalize();
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipName}"`
    );

    const readStream = fs.createReadStream(zipPath);

    readStream.on("close", () => {
      try {
        fs.unlinkSync(zipPath);
      } catch (e) {
        console.error("Failed to delete temp zip:", e);
      }

      try {
        db.prepare(`DELETE FROM orders WHERE status = 'ARCHIVED'`).run();
      } catch (dbErr) {
        console.error("Failed to delete archived orders:", dbErr);
      }
    });

    readStream.pipe(res);
  } catch (err) {
    console.error("Error generating archived orders download:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to generate archived orders download.",
      });
    }
  }
});

// Get full details for a single order
app.get("/admin/orders/:id", requireAdmin, (req, res) => {
  try {
    const id = resolveOrderId(req.params.id);
    if (!id) {
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

// ===== PACKING LIST PDF (Admin-only) =====
app.get("/admin/orders/:id/packing-slip", requireAdmin, (req, res) => {
  try {
    if (!PDFDocument) {
      return res
        .status(500)
        .send("PDF generation is not available (pdfkit not installed).");
    }

    const id = resolveOrderId(req.params.id);
    if (!id) {
      return res.status(400).send("Invalid order id.");
    }

    const stmt = db.prepare(`
      SELECT
        id,
        customer_name,
        customer_email,
        status,
        tracking_number,
        items_json,
        shipping_json,
        total_money,
        currency,
        created_at
      FROM orders
      WHERE id = ?
    `);

    const row = stmt.get(id);
    if (!row) {
      return res.status(404).send("Order not found.");
    }

    let items = [];
    let shipping = null;

    try {
      if (row.items_json) items = JSON.parse(row.items_json);
    } catch (e) {
      console.error("Failed to parse items_json for packing list", id, e);
    }

    try {
      if (row.shipping_json) shipping = JSON.parse(row.shipping_json);
    } catch (e) {
      console.error("Failed to parse shipping_json for packing list", id, e);
    }

    // ---- Format date in Central Time ----
    let createdLocalStr = row.created_at || "";
    if (row.created_at) {
      try {
        const d = new Date(row.created_at);
        createdLocalStr = d.toLocaleString("en-US", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch (e) {
        console.error("Failed to format created_at for packing slip", e);
      }
    }

    // Prepare PDF response
    const safeOrderId = String(row.id).replace(/[^a-zA-Z0-9_-]/g, "");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=packing-list-${safeOrderId}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    // Header
    doc
      .fontSize(18)
      .text("Sugar Plum Creations", { align: "center" })
      .moveDown(0.3);

    doc
      .fontSize(14)
      .text("Packing List", { align: "center" })
      .moveDown(1);

    // Order summary
    const total =
      row.total_money != null ? (Number(row.total_money) / 100).toFixed(2) : "";
    const customerName = row.customer_name || "";
    const customerEmail = row.customer_email || "";

    doc.fontSize(10);
    doc.text(`Order #: ${row.id}`);
    doc.text(`Date (Central Time): ${createdLocalStr}`);
    if (total) {
      doc.text(`Order Total: $${total}`);
    }
    if (row.status) {
      doc.text(`Status: ${row.status}`);
    }
    doc.moveDown(0.5);

    // Shipping block
    const shipName =
      (shipping && (shipping.name || shipping.customerName)) || customerName;
    const shipEmail =
      (shipping && (shipping.email || shipping.customerEmail)) ||
      customerEmail;
    const addressLines = [];
    if (
      shipping &&
      (shipping.address1 ||
        shipping.address2 ||
        shipping.city ||
        shipping.state ||
        shipping.zip)
    ) {
      if (shipping.address1) addressLines.push(shipping.address1);
      if (shipping.address2) addressLines.push(shipping.address2);
      const cityStateZip = [
        shipping.city || "",
        shipping.state || "",
        shipping.zip || "",
      ]
        .filter(Boolean)
        .join(" ");
      if (cityStateZip) addressLines.push(cityStateZip);
    }

    doc.text("Ship To:", { underline: true });
    if (shipName) doc.text(shipName);
    if (shipEmail) doc.text(shipEmail);
    addressLines.forEach((line) => doc.text(line));
    doc.moveDown(0.5);

    // Items header
    doc
      .fontSize(11)
      .text("Items", { underline: true })
      .moveDown(0.3);

    const tableTop = doc.y;
    const col1X = 40; // Item
    const col2X = 260; // Color
    const col3X = 360; // Size
    const col4X = 430; // Qty

    doc.fontSize(10);
    doc.text("Item", col1X, tableTop);
    doc.text("Color", col2X, tableTop);
    doc.text("Size", col3X, tableTop);
    doc.text("Qty", col4X, tableTop);

    // Header divider
    doc
      .moveTo(col1X, tableTop + 12)
      .lineTo(550, tableTop + 12)
      .stroke();

    let y = tableTop + 18;

    // Items rows
    (items || []).forEach((item) => {
      const name = item.name || "Item";
      const color = item.color || "";
      const size = item.size || "";
      const qty = item.quantity || item.qty || 1;

      doc.text(name, col1X, y, { width: 200 });
      doc.text(color, col2X, y, { width: 80 });
      doc.text(size, col3X, y, { width: 60 });
      doc.text(String(qty), col4X, y, { width: 30 });

      y += 16;

      // Simple page break
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 40;
      }
    });

    // Centered footer notes so they don't run off the page
    doc.moveDown(2);
    const margin = 40;
    const footerStartY = doc.y;
    const availableWidth = doc.page.width - margin * 2;

    doc
      .fontSize(9)
      .text(
        "This packing list is for internal use only. Prices are intentionally omitted.",
        margin,
        footerStartY,
        { align: "center", width: availableWidth }
      )
      .moveDown(0.5);

    doc.text(
      "Thank you for supporting our small business!",
      margin,
      doc.y,
      { align: "center", width: availableWidth }
    );

    doc.end();
  } catch (err) {
    console.error("Error generating packing list PDF:", err);
    if (!res.headersSent) {
      res.status(500).send("Failed to generate packing list.");
    }
  }
});

// Update order status + tracking, and fire status-based emails
app.put("/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const id = resolveOrderId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid order id." });
    }

    const { status, trackingNumber } = req.body || {};

    const select = db.prepare(`
      SELECT
        id,
        customer_name,
        customer_email,
        status AS old_status,
        tracking_number AS old_tracking,
        total_money,
        currency,
        items_json,
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

    // Build an order object shaped for our email helpers
    const orderForEmail = {
      id: row.id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      status: newStatus,
      total_amount: row.total_money, // cents
      items_json: row.items_json,
      tracking_number: newTracking,
    };

    try {
      // This will:
      // - send customer confirmation + internal alert when status becomes PAID
      // - send customer shipping email when status becomes SHIPPED
      await handleOrderStatusEmails(orderForEmail, row.old_status, newStatus);
    } catch (e) {
      console.error("Error sending status emails:", e);
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

// Download and clear archived orders (protected)
// Returns a ZIP containing a single orders.json file.
// After a successful download, all ARCHIVED orders are removed from the DB.
app.get("/admin/orders/archive-download", requireAdmin, async (req, res) => {
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
        items_json,
        shipping_json,
        total_money,
        currency,
        created_at,
        updated_at
      FROM orders
      WHERE status = 'ARCHIVED'
      ORDER BY created_at ASC
    `);

    const rows = stmt.all();

    if (rows == null || rows.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No archived orders to download.",
      });
    }

    // Make sure exports dir exists
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const stamp = `${year}-${month}-${day}`;

    const zipName = `orders-archive-${stamp}.zip`;
    const zipPath = path.join(EXPORTS_DIR, zipName);

    // Create the zip file with a single JSON file inside
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
 

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);

      const jsonContent = JSON.stringify(rows, null, 2);
      archive.append(jsonContent, { name: "orders.json" });

      archive.finalize();
    });

    // Send the zip as a download, then clean up
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipName}"`
    );

    const readStream = fs.createReadStream(zipPath);

    readStream.on("close", () => {
      // Delete the temp zip file
      try {
        fs.unlinkSync(zipPath);
      } catch (e) {
        console.error("Failed to delete temp orders archive zip:", e);
      }

      // Remove archived orders from DB
      try {
        const deleteStmt = db.prepare(
          `DELETE FROM orders WHERE status = 'ARCHIVED'`
        );
        deleteStmt.run();
        console.log("Archived orders deleted from DB after download.");
      } catch (dbErr) {
        console.error("Failed to delete archived orders from DB:", dbErr);
      }
    });

    readStream.pipe(res);
  } catch (err) {
    console.error("Error generating archived orders download:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to generate archived orders download.",
      });
    }
  }
});

// ===== INVENTORY / CATALOG DEBUG STATUS =====
app.get("/debug/inventory-status", (req, res) => {
  const now = Date.now();

  const minutesSinceInventory =
    lastInventoryFetch > 0
      ? ((now - lastInventoryFetch) / 60000).toFixed(1)
      : null;

  const minutesSinceCatalog =
    lastCatalogFetch > 0
      ? ((now - lastCatalogFetch) / 60000).toFixed(1)
      : null;

  res.json({
    nodeEnv: process.env.NODE_ENV || null,
    squareEnvironment: process.env.SQUARE_ENVIRONMENT || null,
    lastInventoryFetch,
    lastCatalogFetch,
    minutesSinceInventory: minutesSinceInventory,
    minutesSinceCatalog: minutesSinceCatalog,
    inventoryTtlMs: INVENTORY_TTL_MS,
    catalogTtlMs: CATALOG_TTL_MS,
  });
});

// ===== BACKGROUND AUTO-REFRESH LOOPS =====

// Log that we are setting up background loops (helpful on Render)
console.log("Setting up background auto-refresh loops...", {
  NODE_ENV: process.env.NODE_ENV,
  INVENTORY_TTL_MS,
  CATALOG_TTL_MS,
});

// Run an initial soft warmup after server start (doesn't crash if Square fails)
(async () => {
  try {
    console.log("Initial warmup: ensuring catalog + inventory...");
    await ensureCatalogFresh();
    await ensureInventoryInitialized();
    console.log(
      "Initial warmup complete. lastCatalogFetch =",
      lastCatalogFetch,
      "lastInventoryFetch =",
      lastInventoryFetch
    );
  } catch (err) {
    console.error(
      "Initial warmup failed (will retry later via requests):",
      err
    );
  }
})();

// Every 5 minutes: refresh inventory snapshot so counts stay fresh
setInterval(async () => {
  try {
    console.log(
      `[${new Date().toISOString()}] Background inventory refresh (5 min interval)...`
    );
    await refreshInventoryForCatalog();
    console.log(
      "Background inventory refresh complete. lastInventoryFetch =",
      lastInventoryFetch
    );
  } catch (err) {
    console.error("Background inventory refresh failed:", err);
  }
}, INVENTORY_TTL_MS); // INVENTORY_TTL_MS is already 5 minutes

// Every 24 hours: refresh full catalog + inventory
setInterval(async () => {
  try {
    console.log(
      `[${new Date().toISOString()}] Background catalog refresh (24h interval)...`
    );
    await refreshCatalogFromSquare();
    await refreshInventoryForCatalog();
    console.log(
      "Background catalog refresh complete. lastCatalogFetch =",
      lastCatalogFetch,
      "lastInventoryFetch =",
      lastInventoryFetch
    );
  } catch (err) {
    console.error("Background catalog refresh failed:", err);
  }
}, CATALOG_TTL_MS); // CATALOG_TTL_MS is already 24 hours

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
