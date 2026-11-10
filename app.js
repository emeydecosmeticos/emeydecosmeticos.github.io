// Catálogo eme y de. Sin dependencias: lee products.json y arma el pedido para WhatsApp.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const CART_KEY = 'emeyde.pedido.v1';
  let store = {}, categories = [], products = [];
  let cart = [];            // [{ id, tono, cantidad }]
  let filter = { cat: 'todo', q: '' };
  let current = null;       // producto abierto en la hoja
  let currentTone = null, currentQty = 1;
  let money = (n) => '$' + n;

  // ---------- datos ----------
  async function load() {
    try {
      const res = await fetch('products.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      store = data.tienda || {};
      categories = data.categorias || [];
      products = data.productos || [];
      const fmt = new Intl.NumberFormat(store.locale || 'es-MX', {
        style: 'currency', currency: store.moneda || 'MXN', maximumFractionDigits: 2, minimumFractionDigits: 0,
      });
      money = (n) => fmt.format(n);
      if (store.instagram) $('ig-link').href = store.instagram;
      if (store.nombre) document.querySelector('.brand').textContent = store.nombre;
      $('notice').hidden = !store.ejemplo;
      readCart();
      readUrl();
      renderChips();
      renderGrid();
      renderCartBadge();
      openFromHash();
    } catch (err) {
      const grid = $('grid');
      grid.setAttribute('aria-busy', 'false');
      grid.replaceChildren(stateBlock('No se pudo cargar el catálogo.', 'Revisa tu conexión e inténtalo otra vez.', 'Reintentar', () => location.reload()));
    }
  }

  function stateBlock(title, body, actionLabel, action) {
    const box = el('div', 'state');
    box.append(el('strong', null, title), document.createTextNode(body));
    if (actionLabel) {
      const b = el('button', 'textbtn', actionLabel);
      b.type = 'button';
      b.style.display = 'block';
      b.addEventListener('click', action);
      box.append(b);
    }
    return box;
  }

  // ---------- filtro en la URL ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const cat = p.get('cat');
    filter.cat = categories.some((c) => c.id === cat) ? cat : 'todo';
    filter.q = p.get('q') || '';
    $('search').value = filter.q;
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (filter.cat !== 'todo') p.set('cat', filter.cat);
    if (filter.q) p.set('q', filter.q);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function visibleProducts() {
    const q = norm(filter.q.trim());
    return products.filter((p) => {
      if (filter.cat !== 'todo' && p.categoria !== filter.cat) return false;
      if (!q) return true;
      const hay = norm([p.nombre, p.descripcion, ...(p.tonos || []).map((t) => t.nombre)].join(' '));
      return hay.includes(q);
    });
  }

  // ---------- categorías ----------
  function renderChips() {
    const row = $('chips');
    const all = [{ id: 'todo', nombre: 'Todo' }, ...categories];
    row.replaceChildren(...all.map((c) => {
      const b = el('button', 'chip', c.nombre);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filter.cat === c.id));
      b.addEventListener('click', () => {
        filter.cat = c.id;
        writeUrl(); renderChips(); renderGrid();
      });
      return b;
    }));
  }

  // ---------- la ficha de tono / foto ----------
  function mediaFor(p, tone, cls) {
    const box = el('div', cls + ' slot');
    box.setAttribute('data-slot', 'foto de ' + p.nombre);
    const color = (tone && tone.color) || (p.tonos && p.tonos[0] && p.tonos[0].color) || p.color;
    if (color) box.style.setProperty('--swatch', color);
    box.append(el('div', 'slot__tone'), el('div', 'slot__label', tone ? tone.nombre : (p.tonos && p.tonos[0] ? p.tonos[0].nombre : 'Foto pendiente')));
    const src = (tone && tone.imagen) || p.imagen;
    if (src) {
      const img = new Image();
      img.alt = p.nombre + (tone ? ', tono ' + tone.nombre : '');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => img.remove());
      img.src = src;
      box.append(img);
    }
    return box;
  }

  // ---------- cuadrícula ----------
  function renderGrid() {
    const grid = $('grid');
    const list = visibleProducts();
    grid.setAttribute('aria-busy', 'false');
    $('result-count').textContent = list.length === 1 ? '1 producto' : list.length + ' productos';
    if (!list.length) {
      grid.replaceChildren(stateBlock('No encontramos nada con esa búsqueda.', 'Prueba con otra palabra o mira todo el catálogo.', 'Ver todo', () => {
        filter = { cat: 'todo', q: '' };
        $('search').value = '';
        writeUrl(); renderChips(); renderGrid();
      }));
      return;
    }
    grid.replaceChildren(...list.map((p) => {
      const card = el('button', 'card' + (p.agotado ? ' is-out' : ''));
      card.type = 'button';
      card.append(mediaFor(p, null, 'card__media'));
      card.append(el('span', 'card__name', p.nombre));
      const meta = el('span', 'card__meta');
      meta.append(el('span', 'card__price', money(p.precio)));
      const n = (p.tonos || []).length;
      if (n > 1) meta.append(el('span', 'card__tones', n + ' tonos'));
      card.append(meta);
      if (p.agotado) card.append(el('span', 'badge', 'Agotado'));
      card.addEventListener('click', () => openProduct(p));
      return card;
    }));
  }

  // ---------- hoja de producto ----------
  function openProduct(p) {
    current = p;
    currentTone = (p.tonos && p.tonos[0]) || null;
    currentQty = 1;
    $('ps-name').textContent = p.nombre;
    $('ps-price').textContent = money(p.precio);
    $('ps-desc').textContent = p.descripcion || '';
    renderProductSheet();
    history.replaceState(null, '', location.pathname + location.search + '#p=' + encodeURIComponent(p.id));
    const dlg = $('product-sheet');
    if (!dlg.open) dlg.showModal();
  }

  function renderProductSheet() {
    const p = current;
    $('ps-media').replaceWith(Object.assign(mediaFor(p, currentTone, 'sheet__media'), { id: 'ps-media' }));
    const tones = p.tonos || [];
    $('ps-tones-wrap').hidden = tones.length < 2;
    $('ps-tone-name').textContent = currentTone ? currentTone.nombre : '';
    $('ps-tones').replaceChildren(...tones.map((t) => {
      const b = el('button', 'tone');
      b.type = 'button';
      b.title = t.nombre;
      b.setAttribute('aria-label', t.nombre);
      b.setAttribute('aria-pressed', String(t === currentTone));
      b.style.setProperty('--swatch', t.color);
      b.addEventListener('click', () => { currentTone = t; renderProductSheet(); });
      return b;
    }));
    $('ps-qty').textContent = currentQty;
    const add = $('ps-add');
    add.disabled = !!p.agotado;
    add.textContent = p.agotado ? 'Agotado por ahora' : 'Agregar al pedido';
    $('ps-stepper').hidden = !!p.agotado;
    const ask = 'Hola! Tengo una duda sobre ' + p.nombre + (currentTone ? ' (tono ' + currentTone.nombre + ')' : '') + (p.agotado ? '. ¿Cuándo vuelve a haber?' : '.');
    $('ps-ask').href = waLink(ask);
  }

  function openFromHash() {
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return;
    const p = products.find((x) => x.id === decodeURIComponent(m[1]));
    if (p) openProduct(p);
  }

  // ---------- pedido ----------
  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      cart = raw.filter((l) => products.some((p) => p.id === l.id && !p.agotado) && l.cantidad > 0);
    } catch (e) { cart = []; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* sin almacenamiento: el pedido vive mientras la página esté abierta */ }
  }
  const productOf = (line) => products.find((p) => p.id === line.id);
  const toneOf = (line) => (productOf(line).tonos || []).find((t) => t.nombre === line.tono) || null;
  const cartTotal = () => cart.reduce((s, l) => s + productOf(l).precio * l.cantidad, 0);
  const cartUnits = () => cart.reduce((s, l) => s + l.cantidad, 0);

  function addToCart(p, tone, qty) {
    const tono = tone ? tone.nombre : '';
    const line = cart.find((l) => l.id === p.id && l.tono === tono);
    if (line) line.cantidad += qty; else cart.push({ id: p.id, tono, cantidad: qty });
    saveCart(); renderCartBadge();
  }

  function renderCartBadge() {
    const units = cartUnits();
    const count = $('cart-count');
    count.hidden = units === 0;
    count.textContent = units;
    $('cartbar').hidden = units === 0;
    $('cartbar-label').textContent = 'Ver pedido (' + units + ')';
    $('cartbar-total').textContent = money(cartTotal());
  }

  function renderCart() {
    const empty = cart.length === 0;
    $('cs-empty').hidden = !empty;
    $('cs-foot').hidden = empty;
    $('cs-lines').replaceChildren(...cart.map((line) => {
      const p = productOf(line), tone = toneOf(line);
      const li = el('li', 'line');
      const chip = el('div', 'line__chip');
      const color = (tone && tone.color) || p.color;
      if (color) chip.style.setProperty('--swatch', color);
      const text = el('div');
      text.append(el('div', 'line__name', p.nombre));
      if (line.tono) text.append(el('div', 'line__tone', 'Tono ' + line.tono));
      const price = el('div', 'line__price fig', money(p.precio * line.cantidad));

      const stepper = el('div', 'stepper');
      const minus = el('button'); minus.type = 'button'; minus.setAttribute('aria-label', 'Quitar uno'); minus.textContent = '−';
      const out = el('output', 'fig', line.cantidad);
      const plus = el('button'); plus.type = 'button'; plus.setAttribute('aria-label', 'Agregar uno'); plus.textContent = '+';
      minus.addEventListener('click', () => changeQty(line, -1));
      plus.addEventListener('click', () => changeQty(line, 1));
      stepper.append(minus, out, plus);

      const remove = el('button', 'textbtn line__remove', 'Quitar');
      remove.type = 'button';
      remove.addEventListener('click', () => changeQty(line, -line.cantidad));

      li.append(chip, text, price, stepper, remove);
      return li;
    }));
    $('cs-total').textContent = money(cartTotal());
    $('cs-send').href = waLink(orderMessage());
  }

  function changeQty(line, delta) {
    line.cantidad += delta;
    if (line.cantidad <= 0) cart = cart.filter((l) => l !== line);
    saveCart(); renderCartBadge(); renderCart();
  }

  // ---------- WhatsApp ----------
  function waLink(text) {
    const num = String(store.whatsapp || '').replace(/\D/g, '');
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }

  function orderMessage() {
    const lines = cart.map((l) => {
      const p = productOf(l);
      return '- ' + l.cantidad + ' x ' + p.nombre + (l.tono ? ' (' + l.tono + ')' : '') + ': ' + money(p.precio * l.cantidad);
    });
    const note = $('cs-note').value.trim();
    return ['Hola! Quiero hacer este pedido:', '', ...lines, '', 'Total: ' + money(cartTotal()), ...(note ? ['', 'Nota: ' + note] : [])].join('\n');
  }

  // ---------- avisos ----------
  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  // ---------- eventos ----------
  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.q = e.target.value; writeUrl(); renderGrid(); }, 120);
  });

  $('ps-stepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    currentQty = Math.min(20, Math.max(1, currentQty + Number(b.dataset.step)));
    $('ps-qty').textContent = currentQty;
  });

  $('ps-add').addEventListener('click', () => {
    if (!current || current.agotado) return;
    addToCart(current, currentTone, currentQty);
    $('product-sheet').close();
    toast('Agregado al pedido');
  });

  const openCart = () => { renderCart(); $('cart-sheet').showModal(); };
  $('open-cart').addEventListener('click', openCart);
  $('cartbar-btn').addEventListener('click', openCart);
  $('cs-note').addEventListener('input', () => { $('cs-send').href = waLink(orderMessage()); });
  $('cs-clear').addEventListener('click', () => {
    if (!confirm('¿Vaciar todo el pedido?')) return;
    cart = []; saveCart(); renderCartBadge(); renderCart();
  });

  document.querySelectorAll('dialog.sheet').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  });
  $('product-sheet').addEventListener('close', () => {
    history.replaceState(null, '', location.pathname + location.search);
  });

  load();
})();
