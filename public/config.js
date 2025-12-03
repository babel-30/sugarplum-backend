// =======================================
// config.js – GLOBAL backend configuration
// =======================================

// Detect if this browser is running on localhost
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

// ===============================
// LIVE BACKEND BASE URL (Render)
// IMPORTANT: MUST be HTTPS for mobile login & cookies
// ===============================
const RENDER_BACKEND_BASE = "https://sugarplum-backend.onrender.com";

// ===============================
// API_BASE logic
// - Local development → local backend
// - Production (Render / public site) → Render backend
// ===============================
const API_BASE = isLocalHost
  ? "http://127.0.0.1:3000"     // Local
  : RENDER_BACKEND_BASE;        // Live backend (HTTPS)

// ===============================
// Debug helper
// ===============================
console.log("[SPC] API_BASE resolved to:", API_BASE);
