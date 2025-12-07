// =======================================
// config-admin.js – Backend Admin Config
// =======================================

// Admin ALWAYS lives on the backend domain.
// So API_BASE must ALWAYS be the same origin.
const API_BASE = "";

// Debug helper
console.log("[ADMIN] API_BASE (same-origin):", window.location.origin);
