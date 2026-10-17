/* Shared navigation, cart badges and catalog feedback. No duplicate cart globals. */
document.addEventListener('DOMContentLoaded', () => {
  const menu = document.querySelector('.br-menu-toggle');
  const nav = document.getElementById('br-navigation');
  function closeMenu() {
    if (!menu || !nav) return;
    menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open');
  }
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const open = menu.getAttribute('aria-expanded') !== 'true';
      menu.setAttribute('aria-expanded', String(open)); nav.classList.toggle('is-open', open);
    });
    nav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    document.addEventListener('click', event => { if (!event.target.closest('.br-header')) closeMenu(); });
    window.matchMedia('(min-width: 801px)').addEventListener('change', event => { if (event.matches) closeMenu(); });
  }
  const syncCart = () => {
    let items = [];
    try { const raw = JSON.parse(localStorage.getItem('spc_cart_v1') || '[]'); if (Array.isArray(raw)) items = raw; } catch (_) {}
    const count = items.reduce((total, item) => total + Math.max(0, Number(item.qty) || 0), 0);
    document.querySelectorAll('[data-br-cart-count]').forEach(badge => {
      badge.textContent = String(count); badge.closest('a')?.setAttribute('aria-label', `View shopping cart, ${count} items`);
    });
  };
  syncCart(); window.addEventListener('storage', syncCart); window.addEventListener('br-cart-updated', syncCart);
  window.addEventListener('pageshow', syncCart);

  let failed = false;
  const status = document.getElementById('br-catalog-status');
  const retry = document.getElementById('br-catalog-retry');
  const grid = document.getElementById('product-grid') || document.getElementById('kiosk-grid');
  function catalogFeedback() {
    if (!status || !grid) return;
    if (!Array.isArray(window.spcProducts)) return;
    const hasCards = grid.children.length > 0;
    status.hidden = hasCards;
    status.textContent = failed ? 'We couldn’t load the shop. Please try again in a moment.' :
      typeof location!=='undefined'&&location.pathname.endsWith('/patches.html')&&!window.spcProducts.some(p=>(p.category||p.collection)==='Patches'&&!p.flags?.hideOnline) ? 'Standalone patches are not available yet. You can still choose patches in Build Your Hat.' : window.spcProducts.length ? 'No products match these filters. Try clearing your search or changing a filter.' : 'New products are on the way. Check back soon.';
    if (retry) retry.hidden = !failed;
  }
  window.addEventListener('spc-products-ready', event => { failed = !!event.detail?.error; catalogFeedback(); });
  if (grid && status) new MutationObserver(catalogFeedback).observe(grid, { childList: true });
  if (retry) retry.addEventListener('click', async () => {
    retry.disabled = true; retry.hidden = true; failed = false;
    status.hidden = false; status.textContent = 'Loading available products…';
    try { if (typeof loadProducts === 'function') await loadProducts(); } finally { retry.disabled = false; catalogFeedback(); }
  });
  catalogFeedback();
});
