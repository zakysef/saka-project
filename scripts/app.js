// Clean packaging app: load packaging (cache-busted), render, cart (localStorage), modal, WA checkout
console.log('SAKA: app.js boot');

(async function(){
  // remove any leftover login-related nodes (defensive — helps when older index.html is cached)
  document.querySelectorAll('#login-toggle-desktop, #login-toggle-mobile, #logout-desktop, #logout-mobile, #mobile-menu-login, #mobile-menu-logout').forEach(n => n?.remove());

  const DATA_URL = 'assets/data/cards.json';

  // small helper to escape text in templates
  function escapeHtml(s){ return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

  // DOM refs (may be null on reduced pages)
  const gallery = document.getElementById('gallery-grid');
  const cartDrawer = document.getElementById('cart-drawer');
  // desktop/mobile toggles (some pages use either)
  const cartToggleDesktop = document.getElementById('cart-toggle-desktop');
  const cartToggleMobile = document.getElementById('cart-toggle-mobile');
  const cartClose = document.getElementById('cart-close');
  const cartItemsEl = document.getElementById('cart-items');
  const cartCountEl = document.getElementById('cart-count');
  const cartCountMobileEl = document.getElementById('cart-count-mobile');
  const cartTotalEl = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-wa');
  const modal = document.getElementById('char-modal');
  const modalTitle = document.getElementById('char-modal-title');
  const modalDesc = document.getElementById('char-modal-desc');
  const modalImage = document.getElementById('char-modal-image');
  const modalPackInfo = document.getElementById('char-modal-packinfo');
  const addToCartBtn = document.getElementById('add-to-cart');
  const buyNowBtn = document.getElementById('buy-now');
  const modalClose = document.getElementById('char-modal-close');
  const toastOuter = document.getElementById('saka-toast');
  const toastInner = document.getElementById('saka-toast-inner');

  let data = { packaging: [] };
  let activePack = null;

  function showToast(msg, type = 'default') {
    if(!toastOuter || !toastInner) return;
    const colors = {
      default: 'bg-black/80',
      success: 'bg-green-600',
      error: 'bg-red-600'
    };
    toastInner.className = `px-4 py-2 rounded-lg shadow-lg text-white ${colors[type] || colors.default}`;
    toastInner.textContent = msg;
    toastOuter.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=> toastOuter.classList.add('hidden'), 2000);
  }

  // Add loading spinner element
  const loadingSpinner = document.createElement('div');
  loadingSpinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  loadingSpinner.innerHTML = `
    <div class="bg-white rounded-lg p-4 flex flex-col items-center">
      <div class="w-8 h-8 border-4 border-[#8C1007] border-t-transparent rounded-full animate-spin"></div>
      <div class="mt-2 text-sm">Memuat data...</div>
    </div>
  `;

  async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // exponential backoff
      }
    }
  }

  // Show loading state
  function showLoading(show = true) {
    const spinner = document.getElementById('loading-spinner');
    if (!spinner) return;
    spinner.classList.toggle('hidden', !show);
  }

  async function loadData(){
    showLoading(true);
    try {
      console.log('SAKA: fetching data...');
      const res = await fetchWithRetry(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      data = await res.json();
      if (!data?.packaging?.length) throw new Error('Invalid data');
      console.log('SAKA: loaded data OK', data.packaging.length, 'packages');
      return true;
    } catch (err) {
      console.error('SAKA: failed to load data', err);
      return false;
    } finally {
      showLoading(false);
    }
  }

  function renderGallery(packs){
    if(!gallery) return;
    gallery.innerHTML = '';
    (packs||[]).forEach(p => {
      const tile = document.createElement('div');
      tile.className = 'bg-white text-black rounded-lg overflow-hidden shadow hover:scale-105 transition flex flex-col';
      tile.innerHTML = `
        <button class="w-full text-left tile-btn p-0 border-0 bg-transparent">
          <div class="h-40 w-full bg-gray-100 flex items-center justify-center">
            <img loading="lazy" src="${p.image}" alt="${p.name}" class="max-h-full max-w-full object-contain">
          </div>
          <div class="p-3 text-left">
            <div class="font-semibold">${p.name}</div>
            <div class="text-sm text-gray-600">${p.quantity} kartu • Rp ${Number(p.price).toLocaleString()}</div>
            ${p.promo && p.promo.promo_text ? `<div class="text-xs text-yellow-600 mt-1">${p.promo.promo_text}</div>` : ''}

          </div>
        </button>
        <div class="p-3">
          <button class="add-pack-btn w-full px-3 py-2 bg-[#8C1007] text-[#FEF9E1] rounded" data-pack-id="${p.id}">Tambah ke Keranjang</button>
        </div>
      `;
      // open modal when clicking tile area (but not the add button)
      const btnArea = tile.querySelector('.tile-btn');
      if(btnArea) btnArea.addEventListener('click', ()=> openPackModal(p));
      gallery.appendChild(tile);
    });
    console.log('SAKA: rendered gallery, tiles:', (packs||[]).length);
  }

  // Fix price population to show discounted price (applies promo from data)
  function populatePrices(){
    try {
      const packs = data.packaging || [];
      packs.forEach(p => {
        document.querySelectorAll(`.pack-price[data-pack-id="${p.id}"]`).forEach(el => {
          const basePrice = Number(p.price || 0);
          const isStarterPack = p.id === 'starter';
          const discount = isStarterPack && !firstPurchaseUsed() ? 
            Number(p.promo?.first_time_discount || 0) : 0;
          const finalPrice = discount ? Math.round(basePrice * (1 - discount)) : basePrice;

          let html = '';
          if (discount > 0) {
            html = `
              <span class="line-through text-gray-400">Rp ${basePrice.toLocaleString()}</span>
              <span class="font-semibold ml-2 text-green-500">Rp ${finalPrice.toLocaleString()}</span>
            `;
          } else {
            html = `Rp ${basePrice.toLocaleString()}`;
          }

          if (p.promo?.promo_text) {
            html += ` <span class="pack-promo text-sm ml-2 text-yellow-300">${p.promo.promo_text}</span>`;
          }
          
          el.innerHTML = html;
        });
      });
      return true;
    } catch (err) {
      console.error('SAKA: price population failed', err);
      return false;
    }
  }

  function openPackModal(p){
    activePack = p;
    if(modalTitle) modalTitle.textContent = p.name;
    if(modalDesc) modalDesc.textContent = p.description || `Paket acak berisi ${p.quantity} kartu.`;
    if(modalImage) modalImage.innerHTML = `<img src="${p.image}" alt="${p.name}" class="max-w-full max-h-72 object-contain">`;
    if(modalPackInfo) modalPackInfo.innerHTML = `<div>Jumlah kartu: <strong>${p.quantity}</strong></div><div>Harga: <strong>Rp ${Number(p.price).toLocaleString()}</strong></div>`;
    if(modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
  }
  modalClose && modalClose.addEventListener('click', ()=>{ if(modal){ modal.classList.add('hidden'); modal.classList.remove('flex'); } });

  // CART core functions
const STORAGE_KEY = 'saka_cart_v1';
function readCart() { 
  try { 
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); 
  } catch { 
    return []; 
  } 
}

function writeCart(items) {
  try { 
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items || [])); 
  } catch(e) { 
    console.warn('SAKA: writeCart failed', e); 
  }
  updateCart();
}

function updateCart() {
  renderCart();
  updateCartUI();
}

function addToCart(item) {
  try {
    if (!item?.id || !item?.name || !item?.price) {
      console.error('SAKA: Invalid item data', item);
      showToast('Gagal menambahkan ke keranjang', 'error');
      return false;
    }

    const cart = readCart();
    const existing = cart.find(i => i.id === item.id);
    
    // Normalize item data
    const normalizedItem = {
      id: item.id,
      name: item.name,
      price: Number(item.price),
      quantity_per_pack: Number(item.quantity || 0),
      promo: item.promo || null,
      qty: 1
    };

    if (existing) {
      existing.qty = (Number(existing.qty) || 0) + 1;
    } else {
      cart.push(normalizedItem);
    }
    
    writeCart(cart);
    showToast('Ditambahkan ke keranjang', 'success');
    return true;
  } catch (err) {
    console.error('SAKA: addToCart failed', err);
    showToast('Gagal menambahkan ke keranjang', 'error');
    return false;
  }
}

// Cart rendering
function renderCart() {
  const cart = readCart();
  const cartItemsEl = document.getElementById('cart-items');
  const cartTotalEl = document.getElementById('cart-total');
  const promoNote = document.getElementById('cart-promo-note');
  
  if(!cartItemsEl) return;

  // Empty state
  if(!cart.length) {
    cartItemsEl.innerHTML = '<div class="text-center py-8 text-gray-500">Keranjang kosong</div>';
    cartTotalEl.innerHTML = '';
    promoNote.innerHTML = '';
    return;
  }

  // Render items
  cartItemsEl.innerHTML = '';
  let subtotal = 0, totalCards = 0;

  cart.forEach(item => {
    const basePrice = Number(item.price);
    const qty = Number(item.qty);
    const isStarterPack = item.packId === 'starter';
    const hasDiscount = isStarterPack && !firstPurchaseUsed();
    const finalPrice = hasDiscount ? Math.round(basePrice * 0.9) : basePrice;
    
    subtotal += basePrice * qty;
    totalCards += (Number(item.quantity_per_pack) || 0) * qty;

    const el = document.createElement('div');
    el.className = 'cart-item flex items-center justify-between p-3 border-b hover:bg-gray-50 transition-colors';
    el.dataset.id = item.id;
    
    el.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">${escapeHtml(item.name)}</div>
        ${hasDiscount ? 
          `<div class="text-sm">
            <span class="line-through text-gray-400">Rp ${basePrice.toLocaleString()}</span>
            <span class="text-green-600 font-semibold ml-2">Rp ${finalPrice.toLocaleString()}</span>
           </div>` :
          `<div class="text-sm text-gray-600">Rp ${basePrice.toLocaleString()}</div>`
        }
        <div class="text-xs text-gray-500">${item.quantity_per_pack} kartu × ${qty}</div>
      </div>
      <div class="flex items-center gap-1">
        <button class="p-2 hover:bg-gray-200 active:bg-gray-300 rounded-full transition-colors touch-manipulation" data-op="dec" data-id="${item.id}">
          <i class="bi bi-dash"></i>
        </button>
        <span class="w-8 text-center font-medium">${qty}</span>
        <button class="p-2 hover:bg-gray-200 active:bg-gray-300 rounded-full transition-colors touch-manipulation" data-op="inc" data-id="${item.id}">
          <i class="bi bi-plus"></i>
        </button>
        <button class="p-2 text-red-600 hover:bg-red-100 active:bg-red-200 rounded-full transition-colors touch-manipulation ml-1" data-op="remove" data-id="${item.id}">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;
    
    cartItemsEl.appendChild(el);
  });

  // Update totals
  const discount = !firstPurchaseUsed() ? calculateDiscount(cart) : 0;
  const total = Math.max(0, subtotal - discount);

  cartTotalEl.innerHTML = `
    <div class="flex flex-col space-y-1">
      ${discount > 0 ? `
        <div class="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span>
          <span>Rp ${subtotal.toLocaleString()}</span>
        </div>
        <div class="flex justify-between text-sm text-green-600">
          <span>Diskon</span>
          <span>-Rp ${discount.toLocaleString()}</span>
        </div>
        <div class="h-px bg-gray-200 my-1"></div>
      ` : ''}
      <div class="flex justify-between font-bold">
        <span>Total</span>
        <span>Rp ${total.toLocaleString()}</span>
      </div>
      <div class="text-xs text-gray-500 text-right">${totalCards} kartu</div>
    </div>
  `;

  if(promoNote) {
    promoNote.innerHTML = discount > 0 ? `
      <div class="bg-green-50 border border-green-200 rounded-xl p-3 mb-3">
        <div class="text-green-700 font-medium flex items-center gap-2">
          <i class="bi bi-ticket-perforated"></i>
          <span>Diskon Pembeli Pertama</span>
        </div>
        <div class="text-sm mt-1">Starter Pack (−10%)</div>
        <div class="text-lg font-bold text-green-600 mt-1">−Rp ${discount.toLocaleString()}</div>
      </div>
    ` : '';
  }
}

// Cart operations handler
function handleCartOp(op, id) {
  const cart = readCart();
  const idx = cart.findIndex(x => x.id === id);
  if(idx === -1) return;

  switch(op) {
    case 'inc':
      cart[idx].qty = (Number(cart[idx].qty) || 0) + 1;
      showToast('Jumlah ditambah');
      break;
    case 'dec':
      cart[idx].qty = Math.max(0, (Number(cart[idx].qty) || 0) - 1);
      if(cart[idx].qty === 0) {
        cart.splice(idx, 1);
        showToast('Item dihapus');
      }
      break;
    case 'remove':
      cart.splice(idx, 1);
      showToast('Item dihapus');
      break;
  }
  
  writeCart(cart);
}

// Cart UI
function updateCartUI() {
  const total = readCart().reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  
  ['cart-count', 'cart-count-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if(el) {
      el.textContent = total;
      el.style.display = total ? 'inline-flex' : 'none';
    }
  });
}

// Cart drawer toggle
function toggleCart(show) {
  const drawer = document.getElementById('cart-drawer');
  if(!drawer) return;
  
  drawer.style.transform = show ? 'translateX(0)' : 'translateX(100%)';
  document.body.classList.toggle('cart-drawer-open', show);
}

// Initialize cart system
document.addEventListener('DOMContentLoaded', () => {
  // Cart button clicks
  document.querySelectorAll('#cart-toggle-desktop, #cart-toggle-mobile')
    .forEach(btn => btn.addEventListener('click', () => toggleCart(true)));
  
  document.getElementById('cart-close')?.addEventListener('click', () => toggleCart(false));

  // Cart item operations
  document.getElementById('cart-items')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-op]');
    if(!btn) return;
    
    handleCartOp(btn.dataset.op, btn.dataset.id);
  });

  // Add click handler for gallery buttons
  document.addEventListener('click', e => {
    const addBtn = e.target.closest('.add-pack-btn');
    if (!addBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const packId = addBtn.dataset.packId;
    const pack = data.packaging.find(p => p.id === packId);
    
    if (pack) {
      // Disable button temporarily to prevent double clicks
      addBtn.disabled = true;
      addToCart({
        id: pack.id,
        name: pack.name,
        price: pack.price,
        quantity: pack.quantity,
        promo: pack.promo
      });
      setTimeout(() => addBtn.disabled = false, 500);
    }
  });

  // Optimize modal add to cart button
  addToCartBtn?.addEventListener('click', e => {
    e.preventDefault();
    if (!activePack) return;

    addToCartBtn.disabled = true;
    const success = addToCart({
      id: activePack.id,
      name: activePack.name,
      price: activePack.price,
      quantity: activePack.quantity,
      promo: activePack.promo
    });

    if (success && modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    
    setTimeout(() => addToCartBtn.disabled = false, 500);
  });

  // Add WhatsApp checkout handler
  checkoutBtn?.addEventListener('click', () => {
    const cart = readCart();
    if (!cart.length) {
      showToast('Keranjang kosong', 'error');
      return;
    }

    const text = `*Order SAKA Trading Card*\n\n` + 
      cart.map(item => 
        `${item.name}\n` +
        `${item.quantity_per_pack} kartu × ${item.qty}\n` +
        `Rp ${Number(item.price).toLocaleString()}\n`
      ).join('\n') +
      `\nTotal: Rp ${calculateTotal(cart).toLocaleString()}`;

    const url = `https://wa.me/6285179882669?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    
    // Mark first purchase used if starter pack is in cart
    if (cart.some(item => item.id === 'starter')) {
      markFirstPurchaseUsed();
    }
  });

  // Initial render
  updateCart();
});

  // INIT sequence
  async function init() {
    const dataOk = await loadData();
    if (!dataOk) return;

    // Populate prices then render gallery and cart
    populatePrices();
    if (gallery) renderGallery(data.packaging);
    renderCart();
  }

  await init();

  // Expose stable API
  window.SAKA = { data, addToCart, readCart, writeCart, showToast, renderCart };

})();

// Add utility functions for first purchase tracking
const FIRST_PURCHASE_KEY = 'saka_first_purchase';
function firstPurchaseUsed() {
  return localStorage.getItem(FIRST_PURCHASE_KEY) === 'true';
}

function markFirstPurchaseUsed() {
  localStorage.setItem(FIRST_PURCHASE_KEY, 'true');
}

function calculateDiscount(cart) {
  if (firstPurchaseUsed()) return 0;
  
  const starterPack = cart.find(item => item.id === 'starter');
  if (!starterPack) return 0;

  const pack = data.packaging.find(p => p.id === 'starter');
  if (!pack?.promo?.first_time_discount) return 0;

  const basePrice = Number(starterPack.price || 0);
  const discount = Number(pack.promo.first_time_discount);
  return Math.round(basePrice * discount * starterPack.qty);
}

// Helper to calculate cart total with discounts
function calculateTotal(cart) {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const discount = !firstPurchaseUsed() ? calculateDiscount(cart) : 0;
  return Math.max(0, subtotal - discount);
}

