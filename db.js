// db.js
const Database = require("better-sqlite3");
const path = require("path");

// Database file stored locally next to your server code
const dbPath = path.join(__dirname, "data.sqlite");
const db = new Database(dbPath);

// Base CREATE TABLE (includes shipping_json for new installs)
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    square_order_id TEXT,
    square_payment_link_id TEXT,
    customer_name TEXT,
    customer_email TEXT,
    status TEXT,
    tracking_number TEXT,
    items_json TEXT,
    total_money INTEGER,
    currency TEXT,
    created_at TEXT,
    updated_at TEXT,
    shipping_json TEXT
  );
`);

// --- Safe migration for existing DBs that don't have shipping_json yet ---
try {
  const columns = db.prepare("PRAGMA table_info(orders);").all();
  const hasShippingJson = columns.some((col) => col.name === "shipping_json");

  if (!hasShippingJson) {
    console.log("Adding shipping_json column to orders table...");
    db.exec(`ALTER TABLE orders ADD COLUMN shipping_json TEXT;`);
  }
} catch (err) {
  console.error("Error ensuring shipping_json column exists:", err);
}

module.exports = db;
