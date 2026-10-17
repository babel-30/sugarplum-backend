// Local Live Server talks to the local backend. The deployed backend serves the storefront too.
const isLocalHost = ['localhost','127.0.0.1'].includes(window.location.hostname);
const API_BASE = window.BR_API_BASE || (isLocalHost && window.location.port!=='3000' ? window.location.protocol+'//'+window.location.hostname+':3000' : window.location.origin);
