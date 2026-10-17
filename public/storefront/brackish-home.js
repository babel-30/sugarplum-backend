/* Homepage only. Existing shop, checkout, cart key and backend config are retained. */
document.addEventListener('DOMContentLoaded', () => {
  loadBrackishAnnouncement();
  loadBrackishFeatured();
});

async function loadBrackishAnnouncement() {
  try {
    const response = await fetch(`${API_BASE}/store/config`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const config = await response.json();
    const message = typeof config.bannerText === 'string' ? config.bannerText.trim() : '';
    if (config.bannerVisible && message) {
      document.getElementById('announcement-text').textContent = message;
      document.getElementById('announcement-bar').hidden = false;
    }
  } catch (_) { /* The brand header remains usable without a backend connection. */ }
}

function brackishProductRoute(item) {
  const category = [item.collection, item.categoryName, item.primaryCategory,
    typeof item.category === 'string' ? item.category : item.category?.name,
    ...(Array.isArray(item.categories) ? item.categories.map(c => typeof c === 'string' ? c : c?.name) : []),
    item.meta?.collection, item.meta?.categoryName, item.meta?.category, item.type]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();
  if (/\bblank[\s_-]*apparel\b|\bapparel[\s_-]*blanks?\b/.test(category)) return 'apparel.html?mode=build&garment='+encodeURIComponent(item.id);
  if (/\bhat[\s_-]*blanks?\b|\bblank[\s_-]*hats?\b/.test(category)) return 'hats.html?mode=build&hat='+encodeURIComponent(item.id);
  if (category.includes('patch')) return 'patches.html';
  if (category.includes('hat')) return 'hats.html?mode=shop';
  if (category.includes('3d') || category.includes('print') && !category.includes('apparel')) return 'prints.html';
  return 'apparel.html';
}

async function loadBrackishFeatured() {
  try {
    const response = await fetch(`${API_BASE}/products`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const items = await response.json();
    if (!Array.isArray(items)) return;
    const visible = items.filter(item => item && !item.flags?.hideOnline && !(['Hat Blanks','Blank Apparel'].includes(item.category)&&!item.builderEligible) && typeof item.name === 'string');
    const featured = visible.filter(item => item.flags?.isFeatured || item.isFeatured || item.meta?.isFeatured);
    const selected = (featured.length ? featured : visible).slice(0, 4);
    if (!selected.length) return;
    const grid = document.getElementById('br-featured-grid');
    const fragment = document.createDocumentFragment();
    selected.forEach(item => {
      const card = document.createElement('article');
      card.className = 'br-product';
      const route = brackishProductRoute(item);
      const link = document.createElement('a');
      link.className = 'br-product-image';
      link.href = route;
      link.setAttribute('aria-label', `Browse options for ${item.name}`);
      const src = item.image || item.variations?.find(v => v.image || v.images?.length)?.image || item.variations?.find(v => v.images?.length)?.images[0];
      if (typeof src === 'string' && /^(https?:\/\/|\.?\.?\/)/i.test(src)) {
        const img = document.createElement('img');
        img.src = src; img.alt = item.name; img.loading = 'lazy';
        img.addEventListener('error', () => { img.remove(); link.textContent = 'Explore this design'; }, { once: true });
        link.appendChild(img);
      } else link.textContent = 'Explore this design';
      const title = document.createElement('h3'); title.textContent = item.name;
      const prices = (item.variations || []).map(v => Number(v.price)).filter(p => Number.isFinite(p) && p > 0);
      const price = document.createElement('p'); price.className = 'br-price';
      price.textContent = prices.length ? `${route.includes('mode=build')?(route.includes('apparel.html')?'Garment starting at':'Hat starting at'):'From'} ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.min(...prices))}` : 'See available options';
      const button = document.createElement('a'); button.href = route; button.className = 'br-button br-button-small'; button.textContent = route.includes('mode=build') ? (route.includes('apparel.html')?'Build this apparel':'Build this hat') : 'View options';
      card.append(link, title, price, button); fragment.appendChild(card);
    });
    grid.replaceChildren(fragment);
    document.getElementById('br-featured-title').textContent = 'Featured Products';
    document.getElementById('br-featured-caption').textContent = 'Find your next favorite';
  } catch (_) { /* Clearly labeled collection previews remain when the catalog is unavailable. */ }
}
