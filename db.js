'use strict';
// Node 24 LTS supplies SQLite directly; no platform-specific database binary is needed.
const {DatabaseSync}=require('node:sqlite');
const fs=require('fs'),path=require('path');
const dataDir=path.resolve(process.env.DATA_DIR || path.join(__dirname,'data'));
fs.mkdirSync(dataDir,{recursive:true});
const dbPath=path.join(dataDir,'data.sqlite');
const old=path.join(__dirname,'data.sqlite');
// Test fixtures must not import the owner's legacy orders. Only the dedicated
// migration test opts in, using its own synthetic legacy database.
const importLegacy = process.env.NODE_ENV !== 'test' || process.env.BR_TEST_LEGACY_IMPORT === 'true';
if(importLegacy&&!fs.existsSync(dbPath)&&fs.existsSync(old)) {
  if(fs.existsSync(old+'-wal'))throw new Error('Stop the old backend and checkpoint its database before migration.');
  fs.copyFileSync(old,dbPath);
}
const raw=new DatabaseSync(dbPath);
raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const db={exec:s=>raw.exec(s),prepare:s=>raw.prepare(s),close:()=>raw.close(),transaction(fn){return (...args)=>{raw.exec('BEGIN IMMEDIATE');try{const result=fn(...args);raw.exec('COMMIT');return result;}catch(e){raw.exec('ROLLBACK');throw e;}}},dataDir,dbPath};
// A checkpointed snapshot is created before any additive schema migration.
if(process.env.NODE_ENV!=='test') {
 const backupDir=path.join(dataDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
 const dest=path.join(backupDir,'before-migration-'+Date.now()+'.sqlite');
 raw.exec("VACUUM INTO '"+dest.replace(/'/g,"''")+"'");
}
db.exec(`
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,square_order_id TEXT,square_payment_link_id TEXT,customer_name TEXT,customer_email TEXT,status TEXT,tracking_number TEXT,items_json TEXT,total_money INTEGER,currency TEXT,created_at TEXT,updated_at TEXT,shipping_json TEXT);
CREATE TABLE IF NOT EXISTS pending_checkouts(id TEXT PRIMARY KEY,square_payment_link_id TEXT,square_order_id TEXT,customer_name TEXT,customer_email TEXT,cart_json TEXT,totals_json TEXT,status TEXT DEFAULT 'CREATED',created_at TEXT,confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS business_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions(sid TEXT PRIMARY KEY,session_json TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,customer_json TEXT NOT NULL,request_json TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,quote_json TEXT,approved_revision INTEGER,approved_at TEXT,square_invoice_id TEXT,payment_url TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_files(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,filename TEXT NOT NULL,original_name TEXT NOT NULL,mime TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_comments(id INTEGER PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),author TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_approvals(id INTEGER PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,quote_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,revision));
CREATE TABLE IF NOT EXISTS private_shops(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,name TEXT NOT NULL,items_json TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,closes_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processed_payments(square_order_id TEXT PRIMARY KEY,square_payment_id TEXT UNIQUE,local_order_id INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,processed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_queue(id INTEGER PRIMARY KEY,dedupe_key TEXT UNIQUE NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,sent_at TEXT);
CREATE TABLE IF NOT EXISTS analytics_events(id INTEGER PRIMARY KEY,visitor_id TEXT,name TEXT NOT NULL,product_id TEXT,source TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_metadata(product_id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channel_catalog_links(channel TEXT NOT NULL,external_listing_id TEXT NOT NULL,square_product_id TEXT,square_variation_id TEXT,metadata_json TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(channel,external_listing_id));
CREATE TABLE IF NOT EXISTS channel_order_receipts(channel TEXT NOT NULL,external_order_id TEXT NOT NULL,local_order_id INTEGER,received_at TEXT NOT NULL,PRIMARY KEY(channel,external_order_id));
CREATE TABLE IF NOT EXISTS integration_outbox(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,channel TEXT NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'HELD',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,action TEXT NOT NULL,entity_id TEXT,details_json TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_events_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS ix_projects_status ON projects(status,created_at);
CREATE INDEX IF NOT EXISTS ix_pending_status ON pending_checkouts(status,created_at);
`);
function addColumn(table,name,definition){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);}
addColumn('orders','shipping_json','TEXT');addColumn('orders','channel',"TEXT DEFAULT 'website'");addColumn('orders','project_id','TEXT');addColumn('orders','payment_status',"TEXT DEFAULT 'PAID'");
addColumn('orders','refunded_cents','INTEGER NOT NULL DEFAULT 0');
// Older duplicate order IDs are preserved. A separate payment ledger enforces uniqueness for new processing.
for(const row of db.prepare('SELECT id,square_order_id,created_at FROM orders WHERE square_order_id IS NOT NULL ORDER BY id').all())db.prepare('INSERT OR IGNORE INTO processed_payments(square_order_id,local_order_id,created_at) VALUES(?,?,?)').run(row.square_order_id,row.id,row.created_at || new Date().toISOString());
module.exports=db;
