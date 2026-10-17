// Load environment variables
require("dotenv").config();

// SAFE_LOGGING_BEGIN
// SDK ApiErrors contain request authorization headers. Never print their raw objects.
function safeLogValue(value) {
  const redact = input => {
    let text=String(input);
    for (const key of ['SQUARE_ACCESS_TOKEN','SMTP_PASS','ADMIN_PASSWORD','SESSION_SECRET','SQUARE_WEBHOOK_SIGNATURE_KEY']) {
      const secret=process.env[key];if(secret)text=text.split(secret).join('[redacted]');
    }
    return text.replace(/Bearer\s+[^\s'",}]+/gi,'Bearer [redacted]');
  };
  if(value&&typeof value==='object'){
    const issues=Array.isArray(value.errors)?value.errors:Array.isArray(value.result?.errors)?value.result.errors:[];
    return {name:redact(value.name||'Error'),message:redact(value.message||'Request failed'),...(value.code?{code:redact(value.code)}:{}),...(value.statusCode?{statusCode:value.statusCode}:{}),...(issues.length?{errors:issues.map(issue=>({category:redact(issue.category||''),code:redact(issue.code||''),detail:redact(issue.detail||'')}))}:{})};
  }
  return typeof value==='string'?redact(value):value;
}
function logError(...values){console.error(...values.map(safeLogValue));}
function logWarning(...values){console.warn(...values.map(safeLogValue));}
// SAFE_LOGGING_END


const express = require("express");
const cors = require("cors");
const session = require("express-session");
const db = require("./db");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const nodemailer = require("nodemailer");
const {renderEmail} = require("./lib/branded-email");
const sendToPrinter = require("./utils/thermalPrinter");
const multer = require("multer");

// Optional PDF support (packing list)
let PDFDocument = null;
try {
  PDFDocument = require("pdfkit");
} catch (err) {
  logWarning(
    'pdfkit not installed; packing slip PDF endpoint "/admin/orders/:id/packing-slip" will be disabled.'
  );
}

// Optional BARCODE support (bwip-js) for label generation
let bwipjs = null;
try {
  bwipjs = require("bwip-js");
} catch (err) {
  logWarning(
    'bwip-js not installed; barcode label endpoint "/admin/generate-barcodes" will be disabled.'
  );
}

// 2x1" label constants for SP410BT labels (PDF points: 72pt = 1")
const INCH = 72;
const LABEL_WIDTH_2x1 = 2 * INCH;
const LABEL_HEIGHT_2x1 = 1 * INCH;

// ====== DB TABLE ENSURE (adds pending_checkouts automatically) ======
function ensureTables() {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pending_checkouts (
        id TEXT PRIMARY KEY,
        square_payment_link_id TEXT,
        square_order_id TEXT,
        customer_name TEXT,
        customer_email TEXT,
        cart_json TEXT,
        totals_json TEXT,
        status TEXT DEFAULT 'CREATED',   -- CREATED | CONFIRMED | EXPIRED
        created_at TEXT,
        confirmed_at TEXT
      )
    `).run();
    console.log("✅ ensured table: pending_checkouts");
  } catch (e) {
    logError("❌ ensureTables failed:", e);
  }
}
ensureTables();

// Small helper: break a string into chunks of up to maxChars (word-friendly)
function wrapLabelText(text, maxChars) {
  const words = (text || "").split(/\s+/);
  const lines = [];
  let current = "";

  for (const w of words) {
    if (!w) continue;
    if ((current + " " + w).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = w;
    } else {
      current = current ? current + " " + w : w;
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

// Helper: build TSPL for a single 2x1 label item (aligned for GAP 3mm labels)
function buildTsplForItem(sku, labelText, quantity) {
  const safeSku = (sku || "").replace(/"/g, "'");
  const safeLabel = (labelText || "").replace(/"/g, "'");

  // Use more characters per line to utilize the extra width,
  // and allow up to 3 lines of wrapped text.
  const wrapped = wrapLabelText(safeLabel, 24).slice(0, 3);

  // We moved everything UP ≈6mm earlier.
  // TSPL uses 8 dots per mm → 6mm * 8 = 48 dots.
  // "Up" = *smaller* Y.
  const SHIFT_UP = -48;

  const BARCODE_Y = 20 + SHIFT_UP;
  const SKU_TEXT_Y = 120 + SHIFT_UP;

  // Shift text slightly left to gain a bit more horizontal room
  const DESC_X = 30;
  const DESC1_Y = 150 + SHIFT_UP;
  const DESC2_Y = 175 + SHIFT_UP;
  const DESC3_Y = 200 + SHIFT_UP;

  const tsplLines = [
    "SIZE 50 mm,25 mm",
    "GAP 3 mm,0 mm",
    "DIRECTION 1",
    "CLS",
    `BARCODE 40,${BARCODE_Y},"128",90,0,0,3,6,"${safeSku}"`,
    `TEXT 80,${SKU_TEXT_Y},"3",0,1,1,"${safeSku}"`,
  ];

  if (wrapped[0]) tsplLines.push(`TEXT ${DESC_X},${DESC1_Y},"3",0,1,1,"${wrapped[0]}"`);
  if (wrapped[1]) tsplLines.push(`TEXT ${DESC_X},${DESC2_Y},"3",0,1,1,"${wrapped[1]}"`);
  if (wrapped[2]) tsplLines.push(`TEXT ${DESC_X},${DESC3_Y},"3",0,1,1,"${wrapped[2]}"`);

  tsplLines.push(`PRINT 1,${Number(quantity) || 1}`);
  return tsplLines.join("\r\n") + "\r\n";
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
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  logWarning("Email not fully configured – missing SMTP_* or EMAIL_FROM in .env");
}

async function sendEmail({ to, subject, text, html, bcc }) {
  if(process.env.MAIL_DISABLED==="true")return;
  if (!mailTransporter) {
    logWarning("sendEmail called but transporter is not configured");
    return;
  }

  const message = {
    from: FROM_EMAIL.includes("<") ? FROM_EMAIL : { name: "Brackish Roots", address: FROM_EMAIL },
    to,
    subject,
    text: text || "",
    html: html || renderEmail({subject,text,contactEmail:SMTP_USER||"brackishroots@gmail.com"}).html,
    attachments: renderEmail({subject,text}).attachments,
    replyTo: SMTP_USER || "brackishroots@gmail.com",
  };

  if (bcc) message.bcc = bcc;

  try {
    await mailTransporter.sendMail(message);
  } catch (err) {
    logError("Error sending email:", err);
  }
}

function buildTrackingUrl(trackingNumber) {
  if (!trackingNumber) return null;
  const trimmed = trackingNumber.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://www.17track.net/en/track?nums=${encodeURIComponent(trimmed)}`;
}

function buildBrandedEmail({title,intro,lines=[],trackingNumber,trackingUrl,footerNote,ctaLabel,ctaUrl}) {
  return renderEmail({title,subject:title,text:[intro,...lines,trackingNumber?'Tracking: '+trackingNumber:'',trackingUrl||'',footerNote||''].filter(Boolean).join('\n\n'),ctaLabel:ctaLabel||(trackingUrl?'Track your order':undefined),ctaUrl:ctaUrl||trackingUrl,contactEmail:SMTP_USER||'brackishroots@gmail.com'}).html;
}
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
              return `- ${lineHead}  x${qty}${price ? ` @ $${price}` : ""}`;
            })
            .join("\n");
      }
    }
  } catch (e) {
    logWarning("Could not parse order items JSON for email:", e);
  }

  if (!itemsBlock) {
    itemsBlock = "\n\nRaw order JSON:\n" + JSON.stringify(order, null, 2);
  }

  return itemsBlock;
}

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

  await sendEmail({ to: EMAIL_OWNER, subject, text });
}

async function sendCustomerStatusEmail(order, newStatus) {
  const to = order.customer_email;
  if (!to) return;

  const status = String(newStatus || "").toUpperCase();
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
    logError("Failed to parse items_json:", e);
  }

  if (status === "PAID") {
    subject = "Brackish Roots – Order Confirmation";

    html = buildBrandedEmail({
      title: "Order Confirmation",
      intro: `Thank you for your order, ${order.customer_name || "friend"}! 🎉`,
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

    bcc = EMAIL_OWNER;
  } else if (status === "SHIPPED") {
    subject = "Your Brackish Roots Order Has Shipped";

    html = buildBrandedEmail({
      title: "Order Shipped",
      intro: `Good news! Your Brackish Roots order is on the way. 📦`,
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

  await sendEmail({ to, subject, html, bcc });
}

// ===== Admin Config Storage =====
for (const name of ['adminConfig.json','productConfig.json','patchesConfig.json']) {
 const dest = path.join(db.dataDir, name), source = path.join(__dirname, name);
 if (process.env.NODE_ENV !== 'test' && !fs.existsSync(dest) && fs.existsSync(source)) fs.copyFileSync(source, dest);
}
const seedUploads = path.join(__dirname,'public','uploads');
const durableUploads = path.join(db.dataDir,'uploads');
if (process.env.NODE_ENV !== 'test' && !fs.existsSync(durableUploads) && fs.existsSync(seedUploads)) fs.cpSync(seedUploads,durableUploads,{recursive:true});
function atomicJSON(file,value) { const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2));fs.renameSync(temporary,file); }

const ADMIN_CONFIG_PATH = path.join(db.dataDir, "adminConfig.json");
const EXPORTS_DIR = path.join(db.dataDir, "exports");

// ===== Product Flags Storage =====
const PRODUCT_CONFIG_PATH = path.join(db.dataDir, "productConfig.json");

let adminConfig = {
  bannerText: "",
  bannerVisible: false,
  popupEnabled: false,
  popupMode: "none",
  popupCustomText: "",
  shippingFlatRate: 7.99,
  freeShippingThreshold: 75,
};

let productConfig = {};

function loadAdminConfig() {
  try {
    if (fs.existsSync(ADMIN_CONFIG_PATH)) {
      const raw = fs.readFileSync(ADMIN_CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw);
      adminConfig = { ...adminConfig, ...parsed };
    }
  } catch (err) {
    logError("Error loading admin config:", err);
  }
}

function saveAdminConfig() {
  try {
    atomicJSON(ADMIN_CONFIG_PATH, adminConfig);
  } catch (err) {
    logError("Error saving admin config:", err);
  }
}

function loadProductConfig() {
  try {
    if (fs.existsSync(PRODUCT_CONFIG_PATH)) {
      const raw = fs.readFileSync(PRODUCT_CONFIG_PATH, "utf8");
      productConfig = JSON.parse(raw);
    }
  } catch (err) {
    logError("Error loading product config:", err);
    productConfig = {};
  }
}

function saveProductConfig() {
  try {
    atomicJSON(PRODUCT_CONFIG_PATH, productConfig);
  } catch (err) {
    logError("Error saving product config:", err);
  }
}

loadAdminConfig();
loadProductConfig();

// ===== Patch Library Storage =====
const PATCHES_CONFIG_PATH = path.join(db.dataDir, "patchesConfig.json");

// We'll store uploaded patch images here:
// /public/uploads/patches/<filename>
const PATCHES_UPLOAD_DIR = path.join(db.dataDir, "uploads", "patches");

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    logError("Failed to ensure dir:", dir, e);
  }
}
ensureDir(PATCHES_UPLOAD_DIR);

const {patchPricing}=require('./lib/patch-pricing');
const {patchOptions,cleanPatchOptions}=require('./lib/patch-options');
const patchMaterials=require('./lib/patch-materials');
const DEFAULT_PATCH_CATEGORIES = ['Mississippi & Wildlife', 'Hunting', 'Fishing', 'Coastal', 'Faith', 'Funny', 'Golf', 'Dive', 'School & Team'];
function cleanPatchCategories(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(v => typeof v === 'string').map(v => v.trim().slice(0,60)).filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase())).slice(0,50);
}
function patchCategoryList() {
  return cleanPatchCategories([...(Array.isArray(patchesConfig.categories) ? patchesConfig.categories : DEFAULT_PATCH_CATEGORIES), ...patchesConfig.patches.flatMap(p => cleanPatchCategories(p.categories))]);
}
let patchesConfig = {
  // patches: [{ id, name, imageUrl, active, createdAt, updatedAt }]
  patches: [],
};

function loadPatchesConfig() {
  try {
    if (fs.existsSync(PATCHES_CONFIG_PATH)) {
      const raw = fs.readFileSync(PATCHES_CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw);
      patchesConfig = { ...patchesConfig, ...parsed };
      if (!Array.isArray(patchesConfig.patches)) patchesConfig.patches = [];
    }
  } catch (err) {
    logError("Error loading patches config:", err);
    patchesConfig = { patches: [] };
  }
}

function savePatchesConfig() {
  try {
    atomicJSON(PATCHES_CONFIG_PATH, patchesConfig);
  } catch (err) {
    logError("Error saving patches config:", err);
  }
}

loadPatchesConfig();
const migratedMaterials=patchMaterials.migrateMaterials(patchesConfig);
if(JSON.stringify(migratedMaterials)!==JSON.stringify(patchesConfig)){atomicJSON(PATCHES_CONFIG_PATH,migratedMaterials);patchesConfig=migratedMaterials;}

// Multer config for patch image uploads
const patchStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, PATCHES_UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext : ".png";
    const name = `patch-${Date.now()}-${crypto
      .randomBytes(6)
      .toString("hex")}${safeExt}`;
    cb(null, name);
  },
});

function isAllowedImageMime(mime) {
  const ok = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  return ok.includes((mime || "").toLowerCase());
}
const uploadPatchImage = multer({
  storage: patchStorage,

  // Allow high-quality transparent patch artwork
  // up to 15 MB per image.
  limits: {
    fileSize: 15 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (!isAllowedImageMime(file.mimetype)) {
      return cb(
        new Error(
          "Only image uploads are allowed (png, jpg, webp, gif)."
        )
      );
    }

    cb(null, true);
  },
});

// Use the LEGACY Square SDK
const { Client, Environment } = require("square/legacy");

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// STATIC FILE SERVING
// ===============================

// ✅ Patch uploads live in /public/uploads/... so serve that explicitly
// (This makes /uploads/patches/<file> resolve correctly and avoids confusion.)
const photoWatermarks=require('./lib/photo-watermarks')(app,{publicDir:path.join(__dirname,'public'),patchDir:PATCHES_UPLOAD_DIR,designDir:()=>path.join(db.dataDir,'apparel-artwork'),sources:()=>[...(cachedBaseProducts||[]).flatMap(p=>[p.image,...(p.variations||[]).flatMap(v=>[v.image,...(v.images||[])])]),...patchesConfig.patches.flatMap(p=>[p.imageUrl,...(p.variants||[]).map(v=>v.imageUrl)]),...(business.apparel?.state().designs||[]).map(d=>d.imageUrl)].filter(Boolean)});
app.get('/assets/:file',async(req,res,next)=>{if(!/\.(png|jpe?g|webp)$/i.test(req.params.file)||photoWatermarks.siteArtwork('/assets/'+req.params.file))return next();try{await photoWatermarks.photo(res,path.join(__dirname,'public','storefront','assets',path.basename(req.params.file)));}catch{next();}});
app.get('/uploads/patches/:file',async(req,res)=>{try{if(!/^[a-zA-Z0-9_.-]+$/.test(req.params.file))return res.status(404).end();await photoWatermarks.photo(res,path.join(PATCHES_UPLOAD_DIR,req.params.file));}catch{res.status(404).end();}});
app.use("/uploads", express.static(path.join(db.dataDir, "uploads"), { dotfiles: "deny", setHeaders: res => { res.setHeader("X-Content-Type-Options","nosniff"); res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox"); } }));

// Serve static admin assets (HTML/CSS/JS) from ./public
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('X-Frame-Options','DENY');res.set('Referrer-Policy','no-referrer');if(req.path.startsWith('/admin')||req.path.startsWith('/projects')||req.path.startsWith('/private-shop'))res.set('Cache-Control','private, no-store');next();});
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "public", "storefront")));

// ===============================
// EXPLICIT ADMIN PAGE ROUTES
// ===============================
app.get("/admin-login.html", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-login.html"))
);
app.get("/admin-login", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-login.html"))
);
app.get("/admin.html", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html"))
);
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html"))
);


// ===============================
// RENDER / PROXY AWARENESS
// ===============================
const IS_RENDER = !!process.env.RENDER;

// Treat Render as production-like even if NODE_ENV is undefined
const IS_PROD_LIKE = process.env.NODE_ENV === "production" || IS_RENDER;

if (IS_PROD_LIKE) app.set("trust proxy", 1);

// ===============================
// MIDDLEWARE
// ===============================
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowed = [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://brackishroots.com",
      "https://www.brackishroots.com",
      "https://sugarplum-backend.onrender.com",
    ];

    if (allowed.includes(origin)) return callback(null, true);
    if ((process.env.ALLOWED_ORIGINS || "").split(",").map(s=>s.trim()).includes(origin)) return callback(null,true);

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-CSRF-Token", "X-Project-Token", "X-Shop-Token", "X-Shop-Passcode"],
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

app.use(express.json({limit:"2mb",verify:(req,res,buf)=>{if(req.originalUrl==="/webhooks/square")req.rawBody=buf.toString("utf8");}}));
app.use(express.urlencoded({ extended: true }));

// ===============================
// SESSION CONFIG
// ===============================
app.use(
  session({
    secret: process.env.SESSION_SECRET || (()=>{if(IS_PROD_LIKE)throw new Error("SESSION_SECRET is required in production");return crypto.randomBytes(32).toString("hex");})(),
    store: new (require("./lib/session-store"))(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD_LIKE,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);


// ===== Simple Admin Auth =====
// ✅ FIX: do NOT use process.env.NODE_ENV directly here.
// On Render, NODE_ENV is often undefined, which would bypass auth.
function requireAdmin(req, res, next) {
  // Admin authentication is enforced in local development as well.
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Not authorized" });
}

// Rate limits and CSRF are applied before all admin mutation routes.
const limits = new Map();
app.use((req,res,next)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
 const scope=req.path==='/admin/login'?'login':req.path==='/custom-requests'?'request':req.path==='/analytics/events'?'event':req.path==='/checkout'?'checkout':req.path.startsWith('/private-shop')?'private':req.path.startsWith('/projects/current/')?'project':null;
 if(scope){const key=scope+':'+req.ip;let bucket=limits.get(key);if(!bucket||bucket.until<Date.now()){bucket={n:0,until:Date.now()+(scope==='request'?3600000:60000)};limits.set(key,bucket);}if(++bucket.n>({login:10,request:10,event:120,checkout:30,private:60,project:60}[scope]))return res.status(429).json({error:'Too many requests. Please try again later.'});if(limits.size>10000)for(const [k,v]of limits)if(v.until<Date.now())limits.delete(k);}
 if(req.path.startsWith('/admin/')&&!['GET','HEAD','OPTIONS'].includes(req.method)&&req.path!=='/admin/login'){
  if(!req.session?.isAdmin)return res.status(401).json({error:'Not authorized'});
  if(!req.session.csrf || req.get('X-CSRF-Token')!==req.session.csrf)return res.status(403).json({error:'Session verification failed. Reload the admin page.'});
 }
 next();
});
app.post('/admin/login',(req,res)=>{
 const {username,password}=req.body||{};
 const equal=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a||'')).digest(),crypto.createHash('sha256').update(String(b||'')).digest());
 if(process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD&&equal(username,process.env.ADMIN_USERNAME)&&equal(password,process.env.ADMIN_PASSWORD)){
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Login unavailable'});req.session.isAdmin=true;req.session.csrf=crypto.randomBytes(32).toString('hex');req.session.save(()=>res.json({ok:true,csrfToken:req.session.csrf}));});
 }else res.status(401).json({error:'Invalid username or password.'});
});

app.post("/admin/logout", (req, res) => {
  if (req.session) req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get("/admin/me", (req, res) => {
  if (req.session && req.session.isAdmin) return res.json({ isAdmin: true, csrfToken: req.session.csrf || (req.session.csrf=crypto.randomBytes(32).toString("hex")) });
  return res.status(401).json({ error: "Not authorized" });
});

// ============== PATCHES (Build-Your-Own Hats) ==============
//
// Patch records support:
//
// - name
// - imageUrl
// - active
// - physical width / height in inches
//
// Independent preview adjustment for:
//
//   CENTER
//   - previewCenterScale
//   - previewCenterOffsetX
//   - previewCenterOffsetY
//
//   LEFT
//   - previewLeftScale
//   - previewLeftOffsetX
//   - previewLeftOffsetY
//
//   RIGHT
//   - previewRightScale
//   - previewRightOffsetX
//   - previewRightOffsetY
//
// Physical dimensions always remain the actual
// finished patch dimensions.
//
// Preview settings ONLY affect how the artwork
// appears in the Hat Builder.
//
// Scale:
//   1.00 = 100%
//   1.10 = 110%
//   0.90 = 90%
//
// Offset:
//   0 = default position
//
// IMPORTANT:
//
// Older patch records may still contain:
//
//   previewScale
//   previewOffsetX
//   previewOffsetY
//
// Those old values are automatically used as
// the CENTER fallback so existing patch tuning
// is not lost.
//
// ============================================================


// ------------------------------------------------------------
// Helper: safely convert patch numeric settings
// ------------------------------------------------------------

function cleanPatchNumber(
  value,
  fallback,
  min,
  max
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(min, number)
  );
}


// ------------------------------------------------------------
// Helper: normalize one patch's preview settings
// ------------------------------------------------------------

function normalizePatchPreviewSettings(p) {
  /*
    Legacy values are used as the CENTER fallback.

    This preserves any tuning already done before
    Center / Left / Right became independent.
  */

  const legacyScale =
    cleanPatchNumber(
      p?.previewScale,
      1,
      0.25,
      3
    );

  const legacyOffsetX =
    cleanPatchNumber(
      p?.previewOffsetX,
      0,
      -100,
      100
    );

  const legacyOffsetY =
    cleanPatchNumber(
      p?.previewOffsetY,
      0,
      -100,
      100
    );


  // CENTER

  const previewCenterScale =
    cleanPatchNumber(
      p?.previewCenterScale,
      legacyScale,
      0.25,
      3
    );

  const previewCenterOffsetX =
    cleanPatchNumber(
      p?.previewCenterOffsetX,
      legacyOffsetX,
      -100,
      100
    );

  const previewCenterOffsetY =
    cleanPatchNumber(
      p?.previewCenterOffsetY,
      legacyOffsetY,
      -100,
      100
    );


  // LEFT
  //
  // Left and Right start neutral.
  // The Hat Builder itself supplies the
  // automatic base placement.
  //
  // These values are ONLY fine adjustment.

  const previewLeftScale =
    cleanPatchNumber(
      p?.previewLeftScale,
      1,
      0.25,
      3
    );

  const previewLeftOffsetX =
    cleanPatchNumber(
      p?.previewLeftOffsetX,
      0,
      -100,
      100
    );

  const previewLeftOffsetY =
    cleanPatchNumber(
      p?.previewLeftOffsetY,
      0,
      -100,
      100
    );


  // RIGHT

  const previewRightScale =
    cleanPatchNumber(
      p?.previewRightScale,
      1,
      0.25,
      3
    );

  const previewRightOffsetX =
    cleanPatchNumber(
      p?.previewRightOffsetX,
      0,
      -100,
      100
    );

  const previewRightOffsetY =
    cleanPatchNumber(
      p?.previewRightOffsetY,
      0,
      -100,
      100
    );


  return {
    previewCenterScale,
    previewCenterOffsetX,
    previewCenterOffsetY,

    previewLeftScale,
    previewLeftOffsetX,
    previewLeftOffsetY,

    previewRightScale,
    previewRightOffsetX,
    previewRightOffsetY,
  };
}


// ------------------------------------------------------------
// Public: get active patches for the website
// ------------------------------------------------------------

patchMaterials.install(app,{auth:requireAdmin,get:()=>patchesConfig,commit:next=>{atomicJSON(PATCHES_CONFIG_PATH,next);patchesConfig=next;},restock:()=>business.checkRestocks()});

app.get("/patches", (req, res) => {
  try {
    const patches =
      Array.isArray(
        patchesConfig.patches
      )
        ? patchesConfig.patches
        : [];

    const active =
      patches
        .filter(
          (p) =>
            p &&
            p.active !== false
        )
        .map((p) => {
          const preview =
            normalizePatchPreviewSettings(
              p
            );

          return {
            ...p,
            ...patchPricing(p,business.settings()),
            variants:patchOptions({...p,variants:patchMaterials.resolveOptions(p,patchesConfig.materials)}),

            /*
              Older patches may not have
              physical dimensions yet.
            */

            widthInches:
              cleanPatchNumber(
                p.widthInches,
                3,
                0.25,
                10
              ),

            heightInches:
              cleanPatchNumber(
                p.heightInches,
                2,
                0.25,
                10
              ),

            /*
              Independent placement tuning.
            */

            ...preview,
          };
        });

    res.json({
      patches: photoWatermarks.publicImages(active),
      categories: patchCategoryList(),
    });
  } catch (e) {
    logError(
      "Failed to load public patches:",
      e
    );

    res.status(500).json({
      error:
        "Failed to load patches.",
    });
  }
});


// Category changes update metadata only; patch records and uploaded images are preserved.
app.post('/admin/patch-categories', requireAdmin, (req, res) => {
  const name = cleanPatchCategories([req.body?.name])[0];
  if (!name) return res.status(400).json({error:'Enter a category name.'});
  const categories = patchCategoryList();
  if (categories.some(c => c.toLowerCase() === name.toLowerCase())) return res.status(409).json({error:'That category already exists.'});
  if (categories.length >= 50) return res.status(400).json({error:'You can have up to 50 patch categories.'});
  const next = {...patchesConfig, categories:[...categories,name]};
  try { atomicJSON(PATCHES_CONFIG_PATH, next); patchesConfig=next; res.json({ok:true,categories:next.categories}); }
  catch(e) { logError('Category save failed:',e);res.status(500).json({error:'Category could not be saved. Please retry.'}); }
});
app.delete('/admin/patch-categories', requireAdmin, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const categories=patchCategoryList();
  if (!categories.includes(name)) return res.status(404).json({error:'Category no longer exists. Refresh the patch library.'});
  let affected=0;
  const next={...patchesConfig,categories:categories.filter(c=>c!==name),patches:patchesConfig.patches.map(p=>{
    const previous=cleanPatchCategories(p.categories),remaining=previous.filter(c=>c!==name);
    if (remaining.length===previous.length) return p;
    affected++;return {...p,categories:remaining,updatedAt:new Date().toISOString()};
  })};
  try { atomicJSON(PATCHES_CONFIG_PATH,next);patchesConfig=next;res.json({ok:true,categories:next.categories,affected}); }
  catch(e) { logError('Category deletion failed:',e);res.status(500).json({error:'Category could not be deleted. Nothing was changed.'}); }
});

// ------------------------------------------------------------
// Admin: list ALL patches, including inactive
// ------------------------------------------------------------

app.get(
  "/admin/patches",
  requireAdmin,
  (req, res) => {
    try {
      const patches =
        Array.isArray(
          patchesConfig.patches
        )
          ? patchesConfig.patches
          : [];

      const normalized =
        patches.map((p) => {
          const preview =
            normalizePatchPreviewSettings(
              p
            );

          return {
            ...p,
            ...patchPricing(p,business.settings()),
            variants:patchOptions({...p,variants:patchMaterials.resolveOptions(p,patchesConfig.materials)}),

            widthInches:
              cleanPatchNumber(
                p.widthInches,
                3,
                0.25,
                10
              ),

            heightInches:
              cleanPatchNumber(
                p.heightInches,
                2,
                0.25,
                10
              ),

            ...preview,
          };
        });

      res.json({
        patches: normalized,
        categories: patchCategoryList(),
      });
    } catch (e) {
      logError(
        "Failed to load admin patches:",
        e
      );

      res.status(500).json({
        error:
          "Failed to load patches.",
      });
    }
  }
);


// ------------------------------------------------------------
// Admin: save patch list
// Used for add / edit / enable / disable / delete
// ------------------------------------------------------------

app.put(
  "/admin/patches",
  requireAdmin,
  (req, res) => {
    try {
      const incoming =
        req.body || {};

      const nextPatches =
        Array.isArray(
          incoming.patches
        )
          ? incoming.patches
          : null;

      if (!nextPatches) {
        return res
          .status(400)
          .json({
            error:
              "Body must include patches array.",
          });
      }

      const now =
        new Date().toISOString();


      // --------------------------------------------------------
      // Build cleaned / sanitized patch list
      // --------------------------------------------------------

      const cleaned =
        nextPatches
          .map((p) => {
            if (!p) {
              return null;
            }


            const id =
              (
                p.id || ""
              )
                .toString()
                .trim() ||
              crypto.randomUUID();


            const name =
              (
                p.name || ""
              )
                .toString()
                .trim();


            const imageUrl =
              (
                p.imageUrl || ""
              )
                .toString()
                .trim();


            if (
              !name ||
              !imageUrl
            ) {
              return null;
            }


            // --------------------------------
            // Actual finished patch dimensions
            // --------------------------------

            const widthInches =
              cleanPatchNumber(
                p.widthInches,
                3,
                0.25,
                10
              );

            const heightInches =
              cleanPatchNumber(
                p.heightInches,
                2,
                0.25,
                10
              );


            // --------------------------------
            // Independent preview tuning
            // --------------------------------

            const preview =
              normalizePatchPreviewSettings(
                p
              );


            return {
              id,
              name,
              imageUrl,
              categories: cleanPatchCategories(p.categories),
              ...patchPricing({...patchesConfig.patches.find(old=>old.id===id),...p},business.settings()),
              variants:cleanPatchOptions(p.variants===undefined?patchesConfig.patches.find(old=>old.id===id)?.variants:p.variants,{imageUrl}),

              widthInches,
              heightInches,

              /*
                CENTER
              */

              previewCenterScale:
                preview.previewCenterScale,

              previewCenterOffsetX:
                preview.previewCenterOffsetX,

              previewCenterOffsetY:
                preview.previewCenterOffsetY,


              /*
                LEFT
              */

              previewLeftScale:
                preview.previewLeftScale,

              previewLeftOffsetX:
                preview.previewLeftOffsetX,

              previewLeftOffsetY:
                preview.previewLeftOffsetY,


              /*
                RIGHT
              */

              previewRightScale:
                preview.previewRightScale,

              previewRightOffsetX:
                preview.previewRightOffsetX,

              previewRightOffsetY:
                preview.previewRightOffsetY,


              active:
                p.active !== false,

              createdAt:
                p.createdAt ||
                now,

              updatedAt:
                now,
            };
          })
          .filter(Boolean);


      const nextConfig=patchMaterials.migrateMaterials({...patchesConfig,patches:cleaned,categories:cleanPatchCategories([...(Array.isArray(incoming.categories)?incoming.categories:patchCategoryList()),...cleaned.flatMap(p=>p.categories)])});
      // Commit before cleaning files or notifying subscribers.
      atomicJSON(PATCHES_CONFIG_PATH,nextConfig);

      // ========================================================
      // DELETE ORPHANED IMAGE FILES
      //
      // Files that belonged to deleted patches and are no longer
      // referenced by any patch.
      // ========================================================

      try {
        const prev =
          Array.isArray(
            patchesConfig.patches
          )
            ? patchesConfig.patches
            : [];


        const imageURLs=p=>[p.imageUrl,...(p.variants||[]).map(v=>v.imageUrl)].filter(Boolean);
        const prevUrls=new Set(prev.flatMap(imageURLs));
        const nextUrls=new Set(cleaned.flatMap(imageURLs));

        // Anything that existed before
        // but does not exist now belongs
        // to a deleted / replaced patch.

        const deletedUrls =
          [...prevUrls].filter(
            (url) =>
              !nextUrls.has(url)
          );


        for (
          const url of deletedUrls
        ) {
          /*
            Only delete files from our
            patch upload directory.

            Never delete remote URLs or
            anything outside it.
          */

          if (
            !url.startsWith(
              "/uploads/patches/"
            )
          ) {
            continue;
          }


          const filename =
            url
              .replace(
                "/uploads/patches/",
                ""
              )
              .trim();


          if (!filename) {
            continue;
          }


          // Extra path traversal protection

          if (
            filename.includes("..") ||
            filename.includes("/") ||
            filename.includes("\\")
          ) {
            logWarning(
              "Refusing to delete suspicious patch filename:",
              filename
            );

            continue;
          }


          const filePath =
            path.join(
              PATCHES_UPLOAD_DIR,
              filename
            );


          if (
            fs.existsSync(
              filePath
            )
          ) {
            try {
              fs.unlinkSync(
                filePath
              );

              console.log(
                "✅ Deleted patch image:",
                filePath
              );
            } catch (e) {
              logWarning(
                "⚠️ Failed to delete patch image:",
                filePath,
                e.message || e
              );
            }
          } else {
            console.log(
              "ℹ️ Patch image not found (already gone):",
              filePath
            );
          }
        }
      } catch (
        cleanupErr
      ) {
        /*
          Cleanup should never prevent
          us from saving the actual
          patch configuration.
        */

        logWarning(
          "⚠️ Patch cleanup failed (continuing):",
          cleanupErr.message ||
            cleanupErr
        );
      }


      // --------------------------------------------------------
      // Save new patch configuration
      // --------------------------------------------------------

      patchesConfig=nextConfig;
      business.checkRestocks();


      res.json({
        ok: true,
        patches:
          patchesConfig.patches,
      });
    } catch (e) {
      logError(
        "Failed to save patches:",
        e
      );

      res.status(e.status||500).json({error:e.status?e.message:"Failed to save patches."});
    }
  }
);


// ------------------------------------------------------------
// Admin: upload patch artwork
// ------------------------------------------------------------

app.post(
  "/admin/patches/upload",
  requireAdmin,
  uploadPatchImage.single(
    "file"
  ),
  (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            error:
              "No file uploaded.",
          });
      }

      // Public URL served from /public

      const publicUrl =
        `/uploads/patches/${req.file.filename}`;

      res.json({
        ok: true,
        url: publicUrl,
      });
    } catch (e) {
      logError(
        "Patch upload failed:",
        e
      );

      res.status(500).json({
        error:
          "Patch upload failed.",
      });
    }
  }
);

// ---- Square client ----
if (!process.env.SQUARE_ACCESS_TOKEN) {
  logWarning("⚠️  SQUARE_ACCESS_TOKEN is not set in .env");
}

const squareClient = process.env.NODE_ENV==='test'&&global.__BR_SQUARE_TEST__ ? global.__BR_SQUARE_TEST__ : new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment:
    process.env.SQUARE_ENVIRONMENT === "production"
      ? Environment.Production
      : Environment.Sandbox,
});

console.log("Square client created");
console.log("Square env:", process.env.SQUARE_ENVIRONMENT || "sandbox");

const business = require('./lib/business-system')(app, {
 db, square: process.env.NODE_ENV==='test' && global.__BR_SQUARE_TEST__ ? global.__BR_SQUARE_TEST__ : squareClient,
 requireAdmin, getCatalog:()=>cachedBaseProducts || cachedCatalog || [], publicImages:photoWatermarks.publicImages,photo:photoWatermarks.photo,watermark:photoWatermarks.stamp, getPatches:()=>(patchesConfig.patches || []).map(p=>({...p,variants:patchMaterials.resolveOptions(p,patchesConfig.materials)})),
 getAdminConfig:()=>adminConfig, getProductFlags:id=>normalizeFlags(productConfig[id] || {}),
 refresh:async(forceCatalog=false)=>{if(process.env.NODE_ENV==='test' && global.__BR_CATALOG_TEST__){cachedCatalog=global.__BR_CATALOG_TEST__;cachedBaseProducts=global.__BR_CATALOG_TEST__;return;}if(forceCatalog)await refreshCatalogFromSquare();else await ensureCatalogFresh();await refreshInventoryForCatalog();}
});

// Simple test route
app.get("/", (req, res) => {
  res.json({ message: "Brackish Roots backend is running!" });
});

//
// ================== HELPERS ==================
//

// ---------- Helper: decide if an ITEM looks like clothing ----------
function looksLikeApparel(item) {
  const data = item.itemData || {};
  const name = (data.name || "").toLowerCase();

  const variationNames = (data.variations || []).map((v) =>
    (v.itemVariationData?.name || "").toLowerCase()
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

  const hasSizeFromVariations = sizeKeywords.some((kw) => sizeText.includes(kw));
  const hasApparelWordInName = apparelKeywords.some((kw) => name.includes(kw));

  return hasApparelWordInName || hasSizeFromVariations;
}

// ---------- CATEGORY HELPERS (Square Category as source-of-truth) ----------
const {normalizeCategoryName,resolveItemCategory}=require('./lib/catalog-categories');

function buildCategoryIdToNameMap(allObjects) {
  const map = {};
  for (const obj of allObjects || []) {
    if (obj?.type === "CATEGORY") {
      const id = obj.id;
      const name = obj.categoryData?.name || "";
      if (id && name) map[id] = name;
    }
  }
  return map;
}

function inferType(rawName) {
  const n = (rawName || "").toLowerCase();
  if (n.includes("hoodie")) return "Hoodies";
  if (n.includes("sweatshirt") || n.includes("crew")) return "Sweatshirts";
  if (n.includes("long sleeve")) return "Long Sleeve";
  if (n.includes("tank")) return "Tanks";
  return "T-Shirts";
}

// ---------- Parse variation name into size + color ----------
function parseVariationName(vName) {
  if (!vName) return { size: null, color: null };

  const original = vName;
  const parts = vName
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter(Boolean);

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
    "2xl",
    "3xl",
    "4xl",
    "5xl",
    "2x",
    "3x",
    "4x",
    "5x",
    "xxl",
    "xxxl",
    "xxxxl",
    "xlarge",
    "2xlarge",
    "3xlarge",
  ];

  function looksLikeSize(partLower) {
    const compact = partLower.replace(/[\s.-]/g, "");
    if (SIZE_TOKENS.includes(compact)) return true;
    if (compact === "small" || compact === "medium" || compact === "large")
      return true;
    if (compact.includes("youth") || compact.includes("toddler") || /^\d+t$/.test(compact))
      return true;
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

  if (!size) {
    const lowerFull = original.toLowerCase();
    if (lowerFull.includes("youth x-small") || lowerFull.includes("youth x small")) {
      size = "Youth X-Small";
      const youthIndex = lowerFull.indexOf("youth");
      if (youthIndex > 0 && !color) {
        const colorRaw = original.slice(0, youthIndex).trim();
        if (colorRaw) color = colorRaw;
      }
    }
  }

  if (size) {
    const raw = size.toLowerCase().trim();
    const compact = raw.replace(/[\s.-]/g, "");

    if (raw === "small") size = "S";
    else if (raw === "medium") size = "M";
    else if (raw === "large") size = "L";
    else if (
      ["xl", "x-large", "x large", "xlarge"].includes(raw) ||
      ["xl", "xlarge"].includes(compact)
    )
      size = "XL";
    else if (
      ["2xl", "xxl", "2x"].includes(raw) ||
      ["2xl", "xxl", "2x", "2xlarge"].includes(compact)
    )
      size = "2XL";
    else if (
      ["3xl", "xxxl", "3x"].includes(raw) ||
      ["3xl", "xxxl", "3x", "3xlarge"].includes(compact)
    )
      size = "3XL";
  }

  return { size, color };
}

function hasWordOrTag(descLower, base) {
  const d = ` ${descLower} `;
  const w = base.toLowerCase();
  if (d.includes(` ${w} `)) return true;
  if (d.includes(`[${w}]`)) return true;
  return false;
}

function inferAudience(name, variations, description) {
  const audiences = new Set();
  const n = (name || "").toLowerCase();
  const d = (description || "").toLowerCase();

  if (hasWordOrTag(d, "women") || hasWordOrTag(d, "womens")) audiences.add("Women");
  if (
    hasWordOrTag(d, "men/unisex") ||
    hasWordOrTag(d, "men") ||
    hasWordOrTag(d, "unisex")
  )
    audiences.add("Men/Unisex");
  if (hasWordOrTag(d, "kids") || hasWordOrTag(d, "youth")) audiences.add("Kids");
  if (audiences.size > 0) return Array.from(audiences);

  const sizeNames = (variations || []).map((v) =>
    (v.itemVariationData?.name || "").toLowerCase()
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
    )
      hasYouth = true;
    else if (s.trim()) hasAdult = true;
  });

  if (
    n.includes("youth") ||
    n.includes("toddler") ||
    n.includes("kid") ||
    n.includes("4t") ||
    n.includes("3t") ||
    n.includes("2t")
  )
    hasYouth = true;

  if (hasYouth) audiences.add("Kids");

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
  const looksFemaleColor = femaleColorWords.some((c) => variationText.includes(c));
  const looksExplicitWoman = n.includes("women") || n.includes("ladies") || n.includes("female");

  const isFemaleDesign = looksFemaleName || looksFemaleColor || looksExplicitWoman;
  if (hasAdult && isFemaleDesign) audiences.add("Women");

  return Array.from(audiences);
}

function inferSubcategory(name, description) {
  const text = ((name || "") + " " + (description || "")).toLowerCase();

  if (
    text.includes("grinch") ||
    text.includes("christmas") ||
    text.includes("xmas") ||
    text.includes("santa") ||
    text.includes("elf") ||
    text.includes("reindeer")
  )
    return "Christmas";
  if (
    text.includes("thanksgiving") ||
    text.includes("turkey") ||
    text.includes("gobble") ||
    text.includes("thankful") ||
    text.includes("fall") ||
    text.includes("autumn")
  )
    return "Thanksgiving";
  if (
    text.includes("halloween") ||
    text.includes("witch") ||
    text.includes("ghost") ||
    text.includes("pumpkin") ||
    text.includes("spooky") ||
    text.includes("boo") ||
    text.includes("skeleton")
  )
    return "Halloween";
  if (
    text.includes("valentine") ||
    text.includes("valentines") ||
    text.includes("love") ||
    text.includes("heart") ||
    text.includes("cupid")
  )
    return "Valentine";
  if (text.includes("easter") || text.includes("bunny") || text.includes("egg") || text.includes("resurrection"))
    return "Easter";
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
  )
    return "Patriotic";
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
  )
    return "Faith";
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
  )
    return "Animals";
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
  )
    return "Hunting & Fishing";
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
  )
    return "Sports";
  if (
    text.includes("sarcasm") ||
    text.includes("funny") ||
    text.includes("humor") ||
    text.includes("snark") ||
    text.includes("trendy") ||
    text.includes("meme") ||
    text.includes("coffee") ||
    text.includes("wine")
  )
    return "Humor / Trendy";

  return null;
}

function normalizeFlags(rawFlags = {}) {
  return {
    isNew: !!rawFlags.isNew,
    isFeatured: !!rawFlags.isFeatured,
    pinToTop: !!rawFlags.pinToTop,
    hideOnline: !!rawFlags.hideOnline,
    hideKiosk: !!rawFlags.hideKiosk,
    ribbonType: typeof rawFlags.ribbonType === "string" ? rawFlags.ribbonType : "none",
    ribbonCustomText:
      typeof rawFlags.ribbonCustomText === "string" ? rawFlags.ribbonCustomText : "",
  };
}

//
// ===== CATALOG & INVENTORY CACHING =====
//
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const INVENTORY_TTL_MS = 5 * 60 * 1000;

let cachedCatalog = null;
let lastCatalogFetch = 0;

let cachedBaseProducts = null;
let lastInventoryFetch = 0;

// ===== Custom Attribute keys (for variations) =====
const PRINT_LOCATION_CA_KEY = "print_location";

// ----- Refresh catalog from Square -----
async function refreshCatalogFromSquare() {
  console.log("Refreshing catalog from Square (full catalog fetch)...");
  const catalogApi = squareClient.catalogApi;

  let cursor = undefined;
  const allObjects = [];

  do {
    // legacy SDK supports listCatalog(cursor) in your current setup
    const resp = await catalogApi.listCatalog(cursor);
    const objs = resp?.result?.objects || [];
    if (objs.length) allObjects.push(...objs);
    cursor = resp?.result?.cursor;
  } while (cursor);

  console.log("Total catalog objects:", allObjects.length);

  const {optionIndex,variationOptions}=require('./lib/square-options');
  // Resolve option definitions if Square did not include them in the initial listing.
  const optionIds=[...new Set(allObjects.filter(o=>o.type==='ITEM').flatMap(o=>(o.itemData?.variations||[]).flatMap(v=>(v.itemVariationData?.itemOptionValues||[]).map(r=>r.itemOptionId))).filter(Boolean))];
  const missingOptions=optionIds.filter(id=>!allObjects.some(o=>o.type==='ITEM_OPTION'&&o.id===id));
  for(let offset=0;offset<missingOptions.length;offset+=1000){const response=await catalogApi.batchRetrieveCatalogObjects({objectIds:missingOptions.slice(offset,offset+1000),includeRelatedObjects:true});allObjects.push(...(response.result?.objects||[]),...(response.result?.relatedObjects||[]));}
  const squareOptionIndex=optionIndex(allObjects);
  // ===== CATEGORY MAP (id -> name) =====
  const categoryIdToName = {};
  for (const obj of allObjects) {
    if (obj?.type === "CATEGORY") {
      const id = obj.id;
      const name = obj.categoryData?.name || "";
      if (id && name) categoryIdToName[id] = String(name).trim();
    }
  }

  function resolveItemCategoryInner(item) {
    return resolveItemCategory(item,categoryIdToName);
  }
// Map Square IMAGE catalog object IDs to their image URLs.
// Hat variations can reference these IDs so each color can
// carry its own Front / Angled / Back image set.
const imageIdToUrl = {};

// First use any IMAGE objects Square already returned
for (const obj of allObjects) {
  if (
    obj?.type === "IMAGE" &&
    obj.id &&
    obj.imageData?.url
  ) {
    imageIdToUrl[obj.id] = obj.imageData.url;
  }
}

// Collect every image ID referenced by item variations
const referencedVariationImageIds = [];

for (const obj of allObjects) {
  if (obj?.type !== "ITEM") continue;

  const variations = obj.itemData?.variations || [];

  for (const variation of variations) {
    const ids =
      variation?.itemVariationData?.imageIds || [];

    for (const id of ids) {
      if (
        id &&
        !referencedVariationImageIds.includes(id)
      ) {
        referencedVariationImageIds.push(id);
      }
    }
  }
}

// Retrieve any referenced images that were not included
// as IMAGE objects in the original catalog response.
const missingVariationImageIds =
  referencedVariationImageIds.filter(
    (id) => !imageIdToUrl[id]
  );

if (missingVariationImageIds.length > 0) {
  try {
    const imageResult =
      await squareClient.catalogApi.batchRetrieveCatalogObjects({
        objectIds: missingVariationImageIds,
        includeRelatedObjects: false,
      });

    const imageObjects =
      imageResult?.result?.objects || [];

    for (const obj of imageObjects) {
      if (
        obj?.type === "IMAGE" &&
        obj.id &&
        obj.imageData?.url
      ) {
        imageIdToUrl[obj.id] = obj.imageData.url;
      }
    }

    console.log(
      "Variation images resolved:",
      Object.keys(imageIdToUrl).length
    );
  } catch (err) {
    logError(
      "Failed to resolve variation images:",
      err?.response?.body || err
    );
  }
}

  const items = [...new Map(allObjects.filter((obj) => obj?.type === "ITEM").map(obj=>[obj.id,obj])).values()];
  console.log("Total ITEM objects:", items.length);

  const normalizedCatalog = [];

  let countApparel = 0;
  let countHats = 0;
  let countHatBlanks = 0;
  let count3d = 0;
  let countOther = 0;

  for (const item of items) {
    const data = item.itemData || {};
    const rawName = data.name || "";

    // Must have variations to sell
    if (!Array.isArray(data.variations) || data.variations.length === 0) continue;

    // Category preferred, fallback logic if missing
    const catInfo = resolveItemCategoryInner(item);

    let bucket = catInfo.category;
    if (!bucket) {
      bucket = looksLikeApparel(item) ? "Apparel" : "Other";
    }

    if (["Apparel","Blank Apparel"].includes(bucket)) countApparel++;
    else if (bucket === "Hats") countHats++;
    else if (bucket === "Hat Blanks") countHatBlanks++;
    else if (bucket === "3D") count3d++;
    else countOther++;

    // Keep your old "skip blank T-Shirt placeholder" logic ONLY for Apparel
    if (["Apparel","Blank Apparel"].includes(bucket)) {
      const variationNames = data.variations.map((v) => v.itemVariationData?.name || "");
      const parsedVariations = variationNames.map((n) => parseVariationName(n));

      const allSizesNull = parsedVariations.every((p) => p.size === null);
      const allColorsRegular = parsedVariations.every(
        (p) => (p.color || "").toLowerCase() === "regular"
      );

      if (rawName === "T-Shirt" && !data.imageUrl && allSizesNull && allColorsRegular) continue;
    }

    // Resolve image
    let imageUrl = data.imageUrl || null;

    if (!imageUrl && Array.isArray(data.imageIds) && data.imageIds.length > 0) {
      const imgId = data.imageIds[0];
      try {
        const imgResp = await catalogApi.retrieveCatalogObject(imgId);
        const imgObj = imgResp?.result?.object;
        if (imgObj?.imageData?.url) imageUrl = imgObj.imageData.url;
      } catch (err) {
        logError(
          "Error retrieving image object for",
          rawName,
          "id:",
          imgId,
          err.message || err
        );
      }
    }

    // Apparel-only enrichment
    const type = ["Apparel","Blank Apparel"].includes(bucket) ? inferType(rawName) : bucket;
    const audience =
      ["Apparel","Blank Apparel"].includes(bucket) ? inferAudience(rawName, data.variations, data.description) : [];
    const subcategory =
      ["Apparel","Blank Apparel"].includes(bucket) ? inferSubcategory(rawName, data.description) : null;

    const variations = (data.variations || []).map((v) => {
      const vData = v.itemVariationData || {};
      const namedOptions=variationOptions(vData,squareOptionIndex);

      const parsed =
  ["Apparel","Blank Apparel"].includes(bucket)
    ? parseVariationName(vData.name || "")
    : ["Hats","Hat Blanks"].includes(bucket)
    ? {
        size: null,
        color: (vData.name || "").trim() || null,
      }
    : { size: null, color: (vData.name || "").trim() || "Default" };

      let price = 0;
      if (vData.priceMoney && vData.priceMoney.amount != null) {
        price = Number(vData.priceMoney.amount) / 100;
      }

      const ca = v.customAttributeValues || {};
      let printLocation = null;
      if (
        ca[PRINT_LOCATION_CA_KEY] &&
        typeof ca[PRINT_LOCATION_CA_KEY].stringValue === "string"
      ) {
        printLocation = ca[PRINT_LOCATION_CA_KEY].stringValue.trim();
      }

      const sku = vData.sku || null;

      const variationImageIds = Array.isArray(vData.imageIds)
  ? vData.imageIds.filter(Boolean)
  : [];

const variationImages = variationImageIds
  .map((id) => imageIdToUrl[id])
  .filter(Boolean);

      return {
        id: v.id,
        name: vData.name,
        price,
        ...namedOptions,
        size: namedOptions.size||parsed.size,
        color: namedOptions.color||parsed.color,
        sku,
printLocation: namedOptions.printLocation||printLocation,
image: variationImages[0] || imageUrl || null,
images:
  variationImages.length > 0
    ? variationImages
    : imageUrl
    ? [imageUrl]
    : [],
imageIds: variationImageIds,
      };
    });

    normalizedCatalog.push({
      id: item.id,
      name: rawName,
      description: data.description || "",
      category: bucket, // "Apparel" | "Hats" | "3D" | "Other" | custom
      categoryRaw: catInfo.categoryRaw, // raw Square category name (first match)
      categoryIds: catInfo.categoryIds, // helpful for debugging later
      type,
      audience,
      subcategory,
      image: imageUrl,
      variations,
    });
  }

  console.log("Catalog by category:", {
    Apparel: countApparel,
    Hats: countHats,
    HatBlanks: countHatBlanks,
    "3D": count3d,
    Other: countOther,
    TotalNormalized: normalizedCatalog.length,
  });

  cachedCatalog = normalizedCatalog;
  cachedBaseProducts = null;
  lastCatalogFetch = Date.now();
  lastInventoryFetch = 0;

  console.log(`Catalog refresh complete. Items in catalog: ${cachedCatalog.length}`);
}

// ----- Refresh inventory only -----
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

  console.log("Refreshing inventory for variation IDs count:", allVariationIds.length);

  const quantityByVariationId = {};
  const latestTsByVariationId = {};

  if (allVariationIds.length > 0) {
    try {
      for(let offset=0;offset<allVariationIds.length;offset+=1000){let cursor;do{const invResp = await inventoryApi.batchRetrieveInventoryCounts({
        catalogObjectIds: allVariationIds.slice(offset,offset+1000),
        cursor,
        locationIds: [process.env.SQUARE_LOCATION_ID],
      });

      cursor=invResp.result.cursor;const counts = invResp.result.counts || [];
      console.log("Inventory counts returned:", counts.length);

      for (const c of counts) {
        const varId = c.catalogObjectId;
        if (!varId) continue;

        if (c.state && c.state !== "IN_STOCK") continue;

        const rawQty =
          c.quantity !== undefined && c.quantity !== null ? Number(c.quantity) : 0;
        if (Number.isNaN(rawQty)) continue;

        const tsStr = c.calculatedAt || c.updatedAt || c.occurredAt || null;
        const ts = tsStr ? new Date(tsStr).getTime() : 0;

        const prevTs = latestTsByVariationId[varId] || 0;
        if (ts >= prevTs) {
          latestTsByVariationId[varId] = ts;
          quantityByVariationId[varId] = rawQty < 0 ? 0 : rawQty;
        }
      }
      }while(cursor);}
    } catch (invErr) {
      throw invErr;
    }
  }

  const newBaseProducts = cachedCatalog.map((item) => {
    const variationsWithQty = (item.variations || []).map((v) => {
      const raw = quantityByVariationId[v.id];
      let safeQty = 0;
      if (raw !== undefined && raw !== null) {
        const n = Number(raw);
        safeQty = Number.isNaN(n) ? 0 : n;
      }
      if (safeQty < 0) safeQty = 0;

      return { ...v, quantity: safeQty };
    });

    return { ...item, variations: variationsWithQty };
  });

  cachedBaseProducts = newBaseProducts;
  business.checkRestocks();
  lastInventoryFetch = Date.now();

  console.log(`Inventory refresh complete at ${new Date(lastInventoryFetch).toISOString()}`);
}

async function ensureCatalogFresh() {
  if(process.env.NODE_ENV==='test'&&global.__BR_CATALOG_TEST__){cachedCatalog=global.__BR_CATALOG_TEST__;cachedBaseProducts=global.__BR_CATALOG_TEST__;lastCatalogFetch=Date.now();lastInventoryFetch=Date.now();return;}
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

async function ensureInventoryInitialized() {
  if (!cachedBaseProducts) {
    console.log("No cached inventory; doing initial inventory fetch...");
    await refreshInventoryForCatalog();
  }
}

// 
// ============== PRODUCTS ENDPOINT ==============
//
app.get("/products", async (req, res) => {
  console.log("HIT /products");
  try {
    await ensureCatalogFresh();
    await ensureInventoryInitialized();

    const now = Date.now();
    if (now - lastInventoryFetch > INVENTORY_TTL_MS) {
      console.log("Inventory TTL expired; kicking off background inventory refresh...");
      refreshInventoryForCatalog().catch((err) =>
        logError("Background inventory refresh failed:", err)
      );
    }

    const baseProducts = cachedBaseProducts || [];

    // Attach flags
    let decorated = baseProducts.map((p) => {
      const flagsRaw = productConfig[p.id] || {};
      const flags = normalizeFlags(flagsRaw);
      const metadata=business.metadata(p.id);
      return { ...p, flags, ...metadata, builderEligible:["Hat Blanks","Blank Apparel"].includes(p.category) && !!metadata.builderEligible };
    });

    // Hide online flag
    decorated = decorated.filter((p) => !p.flags.hideOnline && !p.privateOnly);

    // Normalize variations + add priceCents
    decorated = decorated.map((p) => {
      const normalizedVariations = (p.variations || []).map((v) => {
        const priceNumber =
          typeof v.price === "number" && !Number.isNaN(v.price) ? v.price : 0;

        return {
          ...v,
          catalogObjectId: v.id,
          priceCents: Math.round(priceNumber * 100),
        };
      });

      return { ...p, variations: normalizedVariations, builderEligible: !!p.builderEligible };
    });

    // ✅ IMPORTANT: Keep 3D items even if Square inventory count is 0/missing
    decorated = decorated.filter((p) => {
      const cat = String(p.category || "").trim().toUpperCase();

      // 3D prints are commonly made-to-order or not tracked via inventory counts
      if (p.fulfillmentMode === "made-to-order") return true;

      // Otherwise require at least one in-stock variation
      return (p.variations || []).some((v) => (v.quantity || 0) > 0);
    });

    // Sort pins/featured/new/name
    decorated.sort((a, b) => {
      if (a.flags.pinToTop !== b.flags.pinToTop) return a.flags.pinToTop ? -1 : 1;
      if (a.flags.isFeatured !== b.flags.isFeatured)
        return a.flags.isFeatured ? -1 : 1;
      if (a.flags.isNew !== b.flags.isNew) return a.flags.isNew ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return res.json(photoWatermarks.publicImages(decorated));
  } catch (error) {
    logError("Square / caching error in /products:", error);
    return res.status(500).json({ error: "Error loading products from Square" });
  }
});

//
// ===== HELPER FOR CHECKOUT NOTES =====
//
function buildLineItemNote(item) {
  const bits = [];

  if (item.type && item.type !== "Other") bits.push(item.type);
  if (item.color) bits.push(item.color);
  if (item.size) bits.push(item.size);

  // apparel print-side (front/back)
  if (item.printSide) bits.push(`Print: ${item.printSide}`);

  // hats: include patch selections
  if (item.patchName) bits.push(`Patch: ${item.patchName}`);
  if (item.patchAlign) bits.push(`Align: ${item.patchAlign}`);

  return bits.join(" • ");
}

// ===== SERVER-SIDE INVENTORY HELPERS (for final checkout guard) =====
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
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function getServerAvailableQtyForCartItem(cartItem, baseProducts) {
  if (!cartItem || !Array.isArray(baseProducts)) return 0;

  const productId = cartItem.id || cartItem.productId;
  if (!productId) return 0;

  const product =
    baseProducts.find((p) => p.id === productId || p.squareItemId === productId) ||
    null;
  if (!product) return 0;

  if (Array.isArray(product.variations) && product.variations.length > 0) {
    const varId = cartItem.squareVariationId || cartItem.catalogObjectId || null;
    let variation = null;

    if (varId) {
      variation =
        product.variations.find(
          (v) =>
            v.id === varId ||
            v.catalogObjectId === varId ||
            v.squareCatalogObjectId === varId ||
            v.squareCatalogObjectId === varId
        ) || null;
    }

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
      if (typeof q === "number") return q;
    }
  }

  if (typeof product.inventory === "number") return product.inventory;
  return 0;
}

function findVariationBySkuOrId(identifier, baseProducts) {
  if (!identifier) return null;
  const needle = String(identifier).trim().toLowerCase();

  for (const p of baseProducts || []) {
    for (const v of p.variations || []) {
      const sku = (v.sku || "").toLowerCase();
      const id = (v.id || "").toLowerCase();
      if (sku === needle || id === needle) {
        return {
          productId: p.id,
          productName: p.name,
          variationId: v.id,
          sku: v.sku || null,
          currentQty:
            typeof v.quantity === "number" && !Number.isNaN(v.quantity)
              ? v.quantity
              : null,
        };
      }
    }
  }
  return null;
}

//
// ============== CHECKOUT ENDPOINT ==============
// NOW: creates Square link + inserts ONLY pending_checkouts (NOT orders)
//
// Checkout and payment confirmation are handled by lib/business-system.js.

// ===== ADMIN: REFRESH INVENTORY (THANK-YOU PING) =====
//
app.post("/admin/refresh-inventory", requireAdmin, async (req, res) => {
  try {
    console.log("[/admin/refresh-inventory] Thank-you page ping received.");

    await ensureCatalogFresh();
    await ensureInventoryInitialized();
    await refreshInventoryForCatalog();

    const now = new Date().toISOString();
    console.log("[/admin/refresh-inventory] Inventory refresh completed at", now);

    return res.json({ ok: true, refreshedAt: now });
  } catch (err) {
    logError("[/admin/refresh-inventory] Failed to refresh inventory:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to refresh inventory snapshot." });
  }
});

// ===== Admin Config =====
// OPTIONAL HARDENING: requireAdmin on GET to avoid exposing admin settings publicly
app.get("/admin/config", requireAdmin, (req, res) => res.json(adminConfig));

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

  if (typeof popupEnabled === "boolean") adminConfig.popupEnabled = popupEnabled;
  if (typeof popupMode === "string") adminConfig.popupMode = popupMode;
  if (typeof popupCustomText === "string") adminConfig.popupCustomText = popupCustomText;

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

// ===== Admin: Products list + flags =====
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

    products.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ products, lastCatalogFetch, lastInventoryFetch });
  } catch (err) {
    logError("Error in /admin/products:", err);
    res.status(500).json({ error: "Failed to load admin products." });
  }
});

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
    productConfig[u.id] = normalizeFlags({ ...existing, ...incomingFlags });
  });

  saveProductConfig();
  res.json({ ok: true, productConfig });
});

// ===== Admin: barcode-products =====
app.get("/admin/barcode-products", requireAdmin, async (req, res) => {
  try {
    await ensureCatalogFresh();
    await ensureInventoryInitialized();

    const baseProducts = cachedBaseProducts || [];
    const products = baseProducts.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type || null,
      subcategory: p.subcategory || null,
      variations: (p.variations || []).map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku || null,
        size: v.size || null,
        color: v.color || null,
        quantity:
          typeof v.quantity === "number" && !Number.isNaN(v.quantity) ? v.quantity : 0,
      })),
    }));

    res.json({ products, lastCatalogFetch, lastInventoryFetch });
  } catch (err) {
    logError("Error in /admin/barcode-products:", err);
    res.status(500).json({ error: "Failed to load barcode products." });
  }
});

// ===== ADMIN: APPLY INVENTORY COUNTS (DELTA MODE) =====
async function handleInventoryDelta(req, res) {
  console.log(
    "[/admin/apply-inventory-count] DELTA HANDLER body:",
    JSON.stringify(req.body, null, 2)
  );

  try {
    const { updates } = req.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      return res
        .status(400)
        .json({ error: "Request body must include updates array." });
    }

    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) {
      return res
        .status(500)
        .json({ error: "SQUARE_LOCATION_ID is not configured on the server." });
    }

    await ensureCatalogFresh();
    await ensureInventoryInitialized();
    await refreshInventoryForCatalog();

    const baseProducts = cachedBaseProducts || [];
    const inventoryApi = squareClient.inventoryApi;

    const idempotencyKey = crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");

    const changes = [];
    const applied = [];
    const errors = [];

    for (const raw of updates) {
      if (!raw) continue;

      const deltaRaw =
        raw.newQty != null
          ? Number(raw.newQty)
          : raw.count != null
          ? Number(raw.count)
          : NaN;

      if (!Number.isFinite(deltaRaw) || deltaRaw === 0) {
        errors.push({
          input: raw,
          error: "Missing or invalid delta in newQty (must be a non-zero number).",
        });
        continue;
      }

      const identifier =
        raw.catalogObjectId || raw.variationId || raw.sku || raw.SKU;
      if (!identifier) {
        errors.push({
          input: raw,
          error: "Missing identifier (need sku or catalogObjectId).",
        });
        continue;
      }

      const match = findVariationBySkuOrId(identifier, baseProducts);
      if (!match) {
        errors.push({
          input: raw,
          identifier,
          error: "Could not find matching variation by SKU/id.",
        });
        continue;
      }

      const currentQtyNum =
        typeof match.currentQty === "number" && !Number.isNaN(match.currentQty)
          ? match.currentQty
          : 0;

      let newQty = currentQtyNum + deltaRaw;
      if (newQty < 0) newQty = 0;
      newQty = Math.floor(newQty);

      if (newQty === currentQtyNum) {
        applied.push({
          input: raw,
          productId: match.productId,
          productName: match.productName,
          variationId: match.variationId,
          sku: match.sku,
          previousQty: currentQtyNum,
          newQty,
          appliedDelta: 0,
          note: "No change (delta results in same quantity).",
        });
        continue;
      }

      const occurredAt = new Date().toISOString();

      changes.push({
        type: "PHYSICAL_COUNT",
        physicalCount: {
          catalogObjectId: match.variationId,
          locationId,
          state: "IN_STOCK",
          quantity: newQty.toString(),
          occurredAt,
        },
      });

      applied.push({
        input: raw,
        productId: match.productId,
        productName: match.productName,
        variationId: match.variationId,
        sku: match.sku,
        previousQty: currentQtyNum,
        newQty,
        appliedDelta: deltaRaw,
      });
    }

    if (changes.length === 0) {
      return res.status(400).json({
        error:
          "No valid inventory changes to apply. Enter non-zero deltas in the New Qty column.",
        details: errors,
        applied,
      });
    }

    const result = await inventoryApi.batchChangeInventory({ idempotencyKey, changes });

    try {
      await refreshInventoryForCatalog();
    } catch (refreshErr) {
      logError(
        "Inventory refresh after /admin/apply-inventory-count failed:",
        refreshErr
      );
    }

    return res.json({
      ok: true,
      mode: "delta",
      appliedCount: applied.length,
      applied,
      errors,
      squareResult: result.result || null,
    });
  } catch (err) {
    logError("Error in /admin/apply-inventory-count (delta):", err);
    return res.status(500).json({
      error: "Failed to apply inventory counts (delta mode).",
      details: err.message || String(err),
    });
  }
}

app.post("/admin/apply-inventory-count", requireAdmin, (req, res) =>
  handleInventoryDelta(req, res)
);
app.post("/admin/inventory/apply", requireAdmin, (req, res) =>
  handleInventoryDelta(req, res)
);

// ========== ADMIN: GENERATE BARCODES (PDF / PRINT / BOTH) ==========
app.post("/admin/generate-barcodes", requireAdmin, async (req, res) => {
  try {
    const { items = [], mode } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided." });
    }

    const modeNormalized = (mode || "pdf").toLowerCase();
    const doPrint = modeNormalized === "print" || modeNormalized === "both";
    const doPdf = modeNormalized === "pdf" || modeNormalized === "both";

    let fullBatchTspl = "";

    if (doPrint && process.env.PRINT_LOCAL_ENABLED !== "true") return res.status(409).json({error:"Direct printing is disabled. Download the label PDF, or enable PRINT_LOCAL_ENABLED on the local printer computer."});
    if (doPrint) {
      console.log(">>> /admin/generate-barcodes: PRINT mode (batch)");

      for (const item of items) {
        const sku = item.sku || "";
        const labelText = item.labelText || "";
        const qty = Number(item.quantity) || 1;
        if (!qty || qty <= 0) continue;

        const tspl = buildTsplForItem(sku, labelText, qty);
        fullBatchTspl += tspl;
      }

      if (!fullBatchTspl.trim()) {
        return res
          .status(400)
          .json({ error: "Nothing to print (no labels with qty > 0)." });
      }

      console.log("Opening printer once and sending full batch...");
      await sendToPrinter(fullBatchTspl);
      console.log("Batch print complete.");
    }

    if (doPdf) {
      console.log(">>> /admin/generate-barcodes: PDF mode");

      if (!PDFDocument) {
        return res
          .status(500)
          .json({ error: "PDF generation not available on this server." });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="labels.pdf"');

      const doc = new PDFDocument({ autoFirstPage: false, margin: 36 });
      doc.pipe(res);

      for (const item of items) {
        const sku = item.sku || "";
        const labelText = item.labelText || "";
        const qty = Number(item.quantity) || 1;

        for (let i = 0; i < qty; i++) {
          doc.addPage({ size: "LETTER", margin: 36 });

          const pageWidth = doc.page.width;
          const pageHeight = doc.page.height;

          const x = (pageWidth - LABEL_WIDTH_2x1) / 2;
          const y = (pageHeight - LABEL_HEIGHT_2x1) / 2;

          doc
            .lineWidth(0.5)
            .roundedRect(x, y, LABEL_WIDTH_2x1, LABEL_HEIGHT_2x1, 4)
            .stroke();

          let currentY = y + 6;

          if (bwipjs) {
            try {
              const barcodeBuffer = await bwipjs.toBuffer({
                bcid: "code128",
                text: sku,
                scale: 2.5,
                height: 10,
                includetext: false,
              });

              doc.image(barcodeBuffer, x + 8, currentY, {
                width: LABEL_WIDTH_2x1 - 16,
              });
              currentY += 40;
            } catch (err) {
              doc.fontSize(9).text(`|| ${sku} ||`, x + 8, currentY, {
                width: LABEL_WIDTH_2x1 - 16,
                align: "center",
              });
              currentY += 18;
            }
          }

          doc.fontSize(10).text(sku, x + 8, currentY, {
            width: LABEL_WIDTH_2x1 - 16,
            align: "center",
          });
          currentY += 14;

          doc.fontSize(8).text(labelText, x + 8, currentY, {
            width: LABEL_WIDTH_2x1 - 16,
            align: "center",
          });
        }
      }

      doc.end();
      return;
    }

    return res.json({
      ok: true,
      message: "Labels processed (print batch complete).",
      mode: modeNormalized,
    });
  } catch (err) {
    logError("Error in /admin/generate-barcodes:", err);
    res.status(500).json({ error: "Failed to generate barcodes." });
  }
});

//
// ===== Admin: Orders from local DB (NOT from Square) =====
//

// Helper: accept either local numeric id, square_order_id, or square_payment_link_id
function resolveOrderId(rawId) {
  if (!rawId) return null;
  const trimmed = String(rawId).trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && asNumber > 0) return asNumber;

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

    if (lookup && lookup.id) return lookup.id;
  } catch (err) {
    logError("Error resolving order id from Square IDs:", err);
  }

  return null;
}

// Payment evidence is separate from editable fulfillment. Legacy defaults are not proof of payment.
function orderPaymentState(row) {
  const verified=!!db.prepare('SELECT 1 FROM processed_payments WHERE local_order_id=? AND square_payment_id IS NOT NULL AND square_payment_id != ?').get(row.id,'');
  return {paymentStatus:verified ? (row.payment_status || 'UNKNOWN') : 'UNVERIFIED',refundedCents:Number(row.refunded_cents)||0};
}

// List recent orders
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
        payment_status,
        refunded_cents,
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
      if (row.total_money != null) total = Number(row.total_money) / 100;
      return {
        id: row.id,
        createdAt: row.created_at,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        total,
        status: row.status || "PENDING",
        ...orderPaymentState(row),
        trackingNumber: row.tracking_number || "",
        currency: row.currency || "USD",
        squareOrderId: row.square_order_id,
        paymentLinkId: row.square_payment_link_id,
      };
    });

    res.json({ orders });
  } catch (err) {
    logError("Error fetching local orders:", err);
    res.status(500).json({ error: "Failed to load orders." });
  }
});

// ARCHIVE DOWNLOAD ROUTE
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
        payment_status,
        refunded_cents,
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
      return res
        .status(200)
        .json({ ok: true, message: "No archived orders to download." });
    }

    if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;
    const zipName = `orders-archive-${stamp}.zip`;
    const zipPath = path.join(EXPORTS_DIR, zipName);

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

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const readStream = fs.createReadStream(zipPath);

    readStream.on("close", () => {
      try {
        fs.unlinkSync(zipPath);
      } catch (e) {
        logError("Failed to delete temp orders archive zip:", e);
      }

      // Export never deletes order history.

    });

    readStream.pipe(res);
  } catch (err) {
    logError("Error generating archived orders download:", err);
    if (!res.headersSent)
      res.status(500).json({ error: "Failed to generate archived orders download." });
  }
});

// Get full details for a single order
app.get("/admin/orders/:id", requireAdmin, (req, res) => {
  try {
    const id = resolveOrderId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id." });

    const stmt = db.prepare(`
      SELECT
        id,
        square_order_id,
        square_payment_link_id,
        customer_name,
        customer_email,
        status,
        payment_status,
        refunded_cents,
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
    if (!row) return res.status(404).json({ error: "Order not found." });

    let items = [];
    let shipping = null;

    try {
      if (row.items_json) items = JSON.parse(row.items_json);
    } catch (e) {}
    try {
      if (row.shipping_json) shipping = JSON.parse(row.shipping_json);
    } catch (e) {}

    const total = row.total_money != null ? Number(row.total_money) / 100 : null;

    res.json({
      id: row.id,
      squareOrderId: row.square_order_id,
      paymentLinkId: row.square_payment_link_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      status: row.status || "PENDING",
        ...orderPaymentState(row),
      trackingNumber: row.tracking_number || "",
      items,
      shipping,
      total,
      currency: row.currency || "USD",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    logError("Error fetching order details:", err);
    res.status(500).json({ error: "Failed to load order details." });
  }
});

// ===== PACKING SLIP HELPERS (PDF + BARCODE) =====
function generateBarcodePng(text) {
  const value = text || "NO-SKU";
  if (!bwipjs) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text: value,
        scale: 3,
        height: 10,
        includetext: false,
        textxalign: "center",
      },
      (err, png) => {
        if (err) return reject(err);
        resolve(png);
      }
    );
  });
}

const packingImages=require('./lib/packing-images');
async function generatePackingSlipPDF(row, items, shipping, res) {
  if (!PDFDocument)
    throw new Error("PDF generation is not available (PDFDocument is null).");

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
    } catch {}
  }

  const safeOrderId = String(row.id).replace(/[^a-zA-Z0-9_-]/g, "");
  res.setHeader("Content-Disposition", `inline; filename=packing-list-${safeOrderId}.pdf`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text("Brackish Roots", { align: "center" }).moveDown(0.3);
  doc.fontSize(14).text("Packing List", { align: "center" }).moveDown(1);

  const total = row.total_money != null ? (Number(row.total_money) / 100).toFixed(2) : "";
  const customerName = row.customer_name || "";
  const customerEmail = row.customer_email || "";

  doc.fontSize(10);
  doc.text(`Order #: ${row.id}`);
  doc.text(`Date (Central Time): ${createdLocalStr}`);
  if (total) doc.text(`Order Total: $${total}`);
  if (row.status) doc.text(`Status: ${row.status}`);
  doc.moveDown(0.5);

  const shipName = (shipping && (shipping.name || shipping.customerName)) || customerName;
  const shipEmail = (shipping && (shipping.email || shipping.customerEmail)) || customerEmail;

  const addressLines = [];
  if (
    shipping &&
    (shipping.address1 || shipping.address2 || shipping.city || shipping.state || shipping.zip)
  ) {
    if (shipping.address1) addressLines.push(shipping.address1);
    if (shipping.address2) addressLines.push(shipping.address2);
    const cityStateZip = [shipping.city || "", shipping.state || "", shipping.zip || ""]
      .filter(Boolean)
      .join(" ");
    if (cityStateZip) addressLines.push(cityStateZip);
  }

  doc.text("Ship To:", { underline: true });
  if (shipName) doc.text(shipName);
  if (shipEmail) doc.text(shipEmail);
  addressLines.forEach((line) => doc.text(line));
  doc.moveDown(0.5);

  doc.fontSize(11).text("Items", { underline: true }).moveDown(0.3);

  const startX=40;
  const imageLoader=packingImages.loader({publicDir:path.join(__dirname,'public'),patchDir:PATCHES_UPLOAD_DIR,designDir:path.join(db.dataDir,'apparel-artwork')});
  const header=()=>{const top=doc.y;doc.fontSize(9).fillColor('#23453d');doc.text('Photo',40,top,{width:78});doc.text('Qty',130,top,{width:28});doc.text('Item / selected options',165,top,{width:245});doc.text('SKU',430,top,{width:120});doc.moveTo(40,top+16).lineTo(572,top+16).strokeColor('#b8c7be').stroke();doc.fillColor('black');return top+24;};
  let y=header();
  for(const [itemIndex,item] of (items||[]).entries()){
    const qty=item.quantity||item.qty||1,sku=item.sku||item.SKU||'',custom=item.customHat;
    const approvedProof=item.customApparel?.requiresProof?db.prepare("SELECT files_json,status FROM paid_proofs WHERE order_id=? AND item_index=?").get(row.id,itemIndex):null;
    const apparelText=item.customApparel?.selections.map(s=>s.side+': '+s.designName+(s.personalization?' — '+s.personalization:'')).join('\n');
    const detail=[item.customApparel?.requiresProof&&approvedProof?.status!=='APPROVED'?'Personalized proof awaiting approval':null,apparelText,item.color,item.size,item.printSide,custom?`Patch: ${custom.patchName} / ${custom.patchVariantName||'Default'}${custom.patchMaterial?' / '+custom.patchMaterial:''}`:null,custom?`Placement: wearer's ${custom.placement}`:null,item.colors?.join(', '),item.sizes?.join(', ')].filter(Boolean).join('\n');
    const note=(custom||item.customApparel)&&item.customerNote?'Customer note: '+item.customerNote:'';
    doc.font('Helvetica-Bold').fontSize(10);const nameHeight=doc.heightOfString(item.name||'Item',{width:245});doc.font('Helvetica').fontSize(9);const detailHeight=detail?doc.heightOfString(detail,{width:245})+6:0,noteHeight=note?doc.heightOfString(note,{width:245})+10:0;
    const rowHeight=Math.max(item.customApparel?.location==='Front & Back'?182:item.customHat?112:92,nameHeight+detailHeight+noteHeight+18);
    if(y+rowHeight>doc.page.height-65){doc.addPage();doc.fontSize(10).text(`Order #${row.id} - continued`,40,40,{width:500});doc.moveDown(.7);y=header();}
    const product=(cachedBaseProducts||cachedCatalog||[]).find(p=>p.id===item.id),variation=(product?.variations||product?.squareVariations||[]).find(v=>v.id===(item.catalogObjectId||item.squareVariationId));
    const patch=custom&&patchesConfig.patches.find(p=>p.id===custom.patchId),p=packingImages.preview(item,patch,variation,product);
    let photo;try{photo=item.customApparel?await packingImages.apparelThumbnail(item,imageLoader,item.customApparel.selections[0].side):await packingImages.thumbnail(item,p,imageLoader);}catch{}
    if(approvedProof?.status==='APPROVED'){try{const file=JSON.parse(approvedProof.files_json)[0];if(file)photo=await require('sharp')(path.join(db.dataDir,'paid-proofs',file.filename)).rotate().png().toBuffer();}catch{}}
    if(photo)photo=await photoWatermarks.stamp(photo);
    if(photo)doc.image(photo,40,y,{fit:[78,78],align:'center',valign:'center'});
    else{doc.rect(40,y,78,78).strokeColor('#dce3df').stroke();doc.fillColor('#66746e').fontSize(8).text('Photo unavailable',45,y+32,{width:68,align:'center'}).fillColor('black');}
    if(item.customApparel?.location==='Front & Back'){try{const back=await packingImages.apparelThumbnail(item,imageLoader,'Back');if(back)doc.image(await photoWatermarks.stamp(back),40,y+88,{fit:[78,78]});doc.fontSize(7).text('Front / Back',40,y+170,{width:78,align:'center'});}catch{}}
    if(custom&&p.patchAvailable===false)doc.fillColor('#66746e').fontSize(7).text('Patch photo unavailable',40,y+80,{width:78,align:'center'}).fillColor('black');
    doc.font('Helvetica-Bold').fontSize(10).text(String(qty),130,y,{width:28}).text(item.name||'Item',165,y,{width:245});
    doc.font('Helvetica').fontSize(9);if(detail)doc.text(detail,165,y+nameHeight+6,{width:245});if(note)doc.text(note,165,y+nameHeight+detailHeight+10,{width:245});
    doc.fontSize(9).text(sku||'-',430,y,{width:120});
    if(sku&&bwipjs){try{const barcode=await generateBarcodePng(sku);if(barcode)doc.image(barcode,430,y+22,{fit:[120,35]});}catch{}}
    y+=rowHeight;doc.moveTo(startX,y).lineTo(572,y).strokeColor('#dce3df').stroke().strokeColor('black');y+=12;doc.x=40;doc.y=y;
  }

  const page = doc.page;
  const margins = page.margins || { top: 40, bottom: 40, left: 40, right: 40 };

  const footerGap = 30;
  const minFooterBlockHeight = 40;

  let footerStartY = Math.max(y, doc.y) + footerGap;
  const maxFooterTop = page.height - margins.bottom - minFooterBlockHeight;
  if (footerStartY > maxFooterTop) {
    doc.addPage();
    footerStartY = (doc.page.margins || margins).top;
  }

  const marginX = margins.left || 40;
  const availableWidth = page.width - (marginX + (margins.right || 40));

  doc.fontSize(9).text(
    "Internal packing sheet - check quantities and design details before dispatch.",
    marginX,
    footerStartY,
    { align: "center", width: availableWidth }
  );
  doc.moveDown(0.75);
  doc.text("Thank you for supporting our small business!", marginX, doc.y, {
    align: "center",
    width: availableWidth,
  });

  doc.end();
}

// Packing slip endpoint
app.get("/admin/orders/:id/packing-slip", requireAdmin, async (req, res) => {
  try {
    if (!PDFDocument)
      return res
        .status(500)
        .send("PDF generation is not available (pdfkit not installed).");

    const id = resolveOrderId(req.params.id);
    if (!id) return res.status(400).send("Invalid order id.");

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
    if (!row) return res.status(404).send("Order not found.");

    let items = [];
    let shipping = null;

    try {
      if (row.items_json) items = JSON.parse(row.items_json);
    } catch {}
    try {
      if (row.shipping_json) shipping = JSON.parse(row.shipping_json);
    } catch {}

    await generatePackingSlipPDF(row, items, shipping, res);
  } catch (err) {
    logError("Error generating packing list PDF:", err);
    if (!res.headersSent) res.status(500).send("Failed to generate packing list.");
  }
});

// Update order status + tracking (and send emails on PAID/SHIPPED transitions)
app.put("/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const id = resolveOrderId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id." });

    const { status, trackingNumber } = req.body || {};

    const select = db.prepare(`
      SELECT
        id,
        customer_name,
        customer_email,
        status AS old_status,
        payment_status,
        refunded_cents,
        tracking_number AS old_tracking,
        total_money,
        currency,
        items_json,
        shipping_json
      FROM orders
      WHERE id = ?
    `);

    const row = select.get(id);
    if (!row) return res.status(404).json({ error: "Order not found." });

    const now = new Date().toISOString();

    const newStatus = typeof status === "string" ? status.toUpperCase() : row.old_status;
    if(!["PENDING","PAID","AWAITING_PROOF","IN_PRODUCTION","READY","SHIPPED","ARCHIVED","CANCELLED","REFUNDED"].includes(newStatus))return res.status(400).json({error:"Choose a valid order status"});
    if(['PAID','REFUNDED'].includes(newStatus) && newStatus!==row.old_status)
      return res.status(409).json({error:'Payment and refunds are confirmed by Square. Choose a fulfillment status instead.'});
    const payment=orderPaymentState(row);
    if(['IN_PRODUCTION','READY','SHIPPED'].includes(newStatus) && !['PAID','PARTIALLY_REFUNDED'].includes(payment.paymentStatus))
      return res.status(409).json({error:'A verified, non-fully-refunded Square payment is required before production or shipping.'});
    if(["PAID","IN_PRODUCTION","READY","SHIPPED"].includes(newStatus)&&!business.paidProofs.canProduce(Number(id)))return res.status(409).json({error:"Approve every personalized item proof before production or shipping."});
    const newTracking =
      typeof trackingNumber === "string" ? trackingNumber.trim() : row.old_tracking || "";

    const update = db.prepare(`
      UPDATE orders
      SET status = ?, tracking_number = ?, updated_at = ?
      WHERE id = ?
    `);

    update.run(newStatus, newTracking, now, id);

    if(newStatus!==row.old_status||newTracking!==row.old_tracking)business.notifyStatus(row,newStatus,newTracking);

    return res.json({
      ok: true,
      id,
      status: newStatus,
      trackingNumber: newTracking,
      updatedAt: now,
    });
  } catch (err) {
    logError("Error updating order:", err);
    res.status(500).json({ error: "Failed to update order." });
  }
});

app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||400).json({error:err.code==='LIMIT_FILE_SIZE'?'Each uploaded file must be under 10 MB':err.code==='LIMIT_FILE_COUNT'?'Upload at most five files':err.status?err.message:'The request could not be processed'});});

// ===== BACKGROUND AUTO-REFRESH LOOPS =====
if (require.main === module) {
console.log("Setting up background auto-refresh loops...", {
  NODE_ENV: process.env.NODE_ENV,
  INVENTORY_TTL_MS,
  CATALOG_TTL_MS,
});

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
    logError("Initial warmup failed (will retry later via requests):", err);
  }
})();

setInterval(async () => {
  try {
    console.log(
      `[${new Date().toISOString()}] Background inventory refresh (5 min interval)...`
    );
    await refreshInventoryForCatalog();
    console.log("Background inventory refresh complete. lastInventoryFetch =", lastInventoryFetch);
  } catch (err) {
    logError("Background inventory refresh failed:", err);
  }
}, INVENTORY_TTL_MS);

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
    logError("Background catalog refresh failed:", err);
  }
}, CATALOG_TTL_MS);

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
}
module.exports = { app, db, business };
