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
  const PENDING = 'Precio por confirmar';
  const priceOf = (p, qty = 1) => (p.precio == null ? PENDING : money(p.precio * qty));

  // ---------- datos ----------
  // URL del Worker de Cloudflare que entrega el catálogo desde el repositorio privado.
  // Vacío = se usa el products.json que viene con el sitio.
  const API_URL = 'https://emeyde-catalogo-datos.chinos-account.workers.dev/';

  async function fetchJson(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  // Primero el Worker; si falla o tarda, la copia de respaldo del sitio.
  async function getCatalog() {
    if (API_URL) {
      try {
        const data = await fetchJson(API_URL, 5000);
        if (data && Array.isArray(data.productos) && data.productos.length) return data;
      } catch (e) { /* se usa el respaldo */ }
    }
    return fetchJson('products.json', 10000);
  }

  async function load() {
    try {
      const data = await getCatalog();
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
      readCoupon();
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

  const catsOf = (p) => (p.categorias && p.categorias.length ? p.categorias : [p.categoria]);

  function visibleProducts() {
    const q = norm(filter.q.trim());
    return products.filter((p) => {
      if (filter.cat !== 'todo' && !catsOf(p).includes(filter.cat)) return false;
      if (!q) return true;
      const hay = norm([p.nombre, p.marca || '', p.descripcion, (categories.find((c) => c.id === p.categoria) || {}).nombre || '', ...(p.tonos || []).map((t) => t.nombre)].join(' '));
      return hay.includes(q);
    });
  }

  // ---------- categorías ----------
  function renderChips() {
    const sel = $('cat');
    sel.replaceChildren(...[{ id: 'todo', nombre: 'Todo' }, ...categories].map((c) => {
      const o = el('option', null, c.nombre);
      o.value = c.id;
      return o;
    }));
    sel.value = filter.cat;
  }

  // al cambiar de categoría, la lista vuelve arriba (sin animación: es una acción frecuente)
  function scrollToGrid() {
    const tools = document.querySelector('.tools');
    const top = $('grid').getBoundingClientRect().top + window.scrollY - tools.offsetHeight - 56;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
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

  // varias fotos: una tira que se desliza con el dedo
  function galleryFor(p) {
    const strip = el('div', 'gallery');
    strip.setAttribute('aria-label', 'Fotos de ' + p.nombre);
    p.imagenes.forEach((src, i) => {
      const item = mediaFor(Object.assign({}, p, { imagen: src }), null, 'gallery__item');
      const img = item.querySelector('img');
      if (img) { img.alt = p.nombre + ', foto ' + (i + 1); if (i === 0) img.loading = 'eager'; }
      strip.append(item);
    });
    return strip;
  }

  // ---------- promociones ----------
  // "2x1", "3x2": lleva N y paga M del mismo producto. Con "promo_hasta": "2026-12-31" deja de aplicar después de esa fecha.
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function promoOf(p) {
    const m = /^(\d+)x(\d+)$/.exec(p.promo || '');
    if (!m) return null;
    const n = Number(m[1]), pay = Number(m[2]);
    if (!(n > pay && pay > 0)) return null;
    if (p.promo_hasta && String(p.promo_hasta) < today()) return null;
    return { n, pay, label: p.promo };
  }
  function promoDiscounts() {
    const qty = {};
    cart.forEach((l) => { qty[l.id] = (qty[l.id] || 0) + l.cantidad; });
    const parts = [];
    Object.keys(qty).forEach((id) => {
      const p = products.find((x) => x.id === id);
      const promo = p && promoOf(p);
      if (!promo || p.precio == null) return;
      const free = Math.floor(qty[id] / promo.n) * (promo.n - promo.pay);
      if (free > 0) parts.push({ label: 'Promo ' + promo.label + ' ' + p.nombre, amount: free * p.precio });
    });
    return parts;
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
    const makeCard = (p) => {
      const card = el('button', 'card' + (p.agotado ? ' is-out' : ''));
      card.type = 'button';
      card.append(mediaFor(p, null, 'card__media'));
      card.append(el('span', 'card__name', p.nombre));
      const meta = el('span', 'card__meta');
      meta.append(el('span', 'card__price', priceOf(p)));
      const n = (p.tonos || []).length;
      if (n > 1) meta.append(el('span', 'card__tones', n + ' tonos'));
      card.append(meta);
      if (p.agotado) card.append(el('span', 'badge', 'Agotado'));
      else if (promoOf(p)) card.append(el('span', 'badge badge--promo', promoOf(p).label));
      card.addEventListener('click', () => openProduct(p));
      return card;
    };
    let nodes = [];
    if (filter.cat === 'todo' && !filter.q.trim()) {
      // todo el catálogo: agrupado por categoría, con su título
      categories.forEach((c) => {
        const items = list.filter((p) => p.categoria === c.id);
        if (items.length) nodes.push(el('h2', 'group-title', c.nombre), ...items.map(makeCard));
      });
      nodes.push(...list.filter((p) => !categories.some((c) => c.id === p.categoria)).map(makeCard));
    } else {
      nodes = list.map(makeCard);
    }
    grid.replaceChildren(...nodes);
  }

  // ---------- hojas: el botón atrás del teléfono las cierra ----------
  let pendingBack = false, queued = null;
  function showSheet(dlg, hash, fromUrl) {
    if (pendingBack) { queued = () => showSheet(dlg, hash, fromUrl); return; }
    if (!fromUrl && location.hash !== hash) history.pushState({ sheet: true }, '', location.pathname + location.search + hash);
    clearTimeout(dlg.closeTimer);
    dlg.classList.remove('is-closing', 'is-settling');
    dlg.style.transform = '';
    if (!dlg.open) dlg.showModal();
    const sc = dlg.querySelector('.sheet__scroll');
    if (sc) sc.scrollTop = 0;
  }
  function hideSheet(dlg) {
    // si la hoja entró al historial, cerrarla es "atrás"; popstate hace la animación
    if (history.state && history.state.sheet && location.hash) { pendingBack = true; history.back(); return; }
    animateClose(dlg);
  }
  function animateClose(dlg) {
    if (!dlg.open || dlg.classList.contains('is-closing')) return;
    const done = () => { dlg.classList.remove('is-closing', 'is-settling'); dlg.style.transform = ''; if (dlg.open) dlg.close(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    dlg.classList.add('is-closing');
    dlg.closeTimer = setTimeout(done, 170);
  }

  // ---------- hoja de producto ----------
  function openProduct(p, fromUrl) {
    current = p;
    currentTone = (p.tonos && p.tonos[0]) || null;
    currentQty = 1;
    $('ps-name').textContent = p.nombre;
    $('ps-price').textContent = priceOf(p);
    $('ps-desc').textContent = p.descripcion || '';
    renderProductSheet();
    showSheet($('product-sheet'), '#p=' + encodeURIComponent(p.id), fromUrl);
  }

  function renderProductSheet() {
    const p = current;
    const many = p.imagenes && p.imagenes.length > 1 && !(currentTone && currentTone.imagen);
    $('ps-media').replaceWith(Object.assign(many ? galleryFor(p) : mediaFor(p, currentTone, 'sheet__media'), { id: 'ps-media' }));
    const promo = promoOf(p);
    $('ps-promo').hidden = !promo || !!p.agotado;
    if (promo) $('ps-promo').textContent = 'Promoción ' + promo.label + ': lleva ' + promo.n + ' y paga ' + promo.pay + '.';
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
    if (location.hash === '#pedido') { openCart(true); return; }
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return;
    const p = products.find((x) => x.id === decodeURIComponent(m[1]));
    if (p) openProduct(p, true);
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
  const cartTotal = () => cart.reduce((s, l) => s + (productOf(l).precio || 0) * l.cantidad, 0);
  const round2 = (n) => Math.round(n * 100) / 100;

  // subtotal -> promociones -> cupón -> total
  function totals() {
    const sub = cartTotal();
    const promos = promoDiscounts();
    const afterPromos = sub - promos.reduce((s, x) => s + x.amount, 0);
    let couponAmount = 0, couponNote = '';
    if (coupon) {
      if (afterPromos < (coupon.minimo || 0)) couponNote = 'El cupón ' + coupon.codigo + ' pide una compra mínima de ' + money(coupon.minimo) + '.';
      else couponAmount = coupon.tipo === 'monto' ? Math.min(coupon.valor, afterPromos) : round2(afterPromos * coupon.valor / 100);
    }
    return { sub, promos, couponAmount, couponNote, total: round2(afterPromos - couponAmount) };
  }
  const totalText = () => {
    const pending = cart.some((l) => productOf(l).precio == null);
    const total = totals().total;
    if (pending && total === 0) return 'Por confirmar';
    return money(total) + (pending ? ' + por confirmar' : '');
  };

  // ---------- cupón ----------
  const COUPON_KEY = 'emeyde.cupon.v1';
  let coupon = null;        // { codigo, tipo: 'porcentaje' | 'monto', valor, minimo }
  function readCoupon() {
    try {
      const c = JSON.parse(localStorage.getItem(COUPON_KEY) || 'null');
      if (c && c.codigo && Number(c.valor) > 0) coupon = c;
    } catch (e) { coupon = null; }
  }
  function saveCoupon() {
    try { if (coupon) localStorage.setItem(COUPON_KEY, JSON.stringify(coupon)); else localStorage.removeItem(COUPON_KEY); } catch (e) { /* sin almacenamiento */ }
  }
  const couponLabel = (c) => 'Cupón ' + c.codigo + (c.tipo === 'monto' ? '' : ' (' + c.valor + '%)');

  // El código se valida en el Worker; la lista de cupones nunca llega al navegador.
  async function applyCoupon() {
    const input = $('cs-coupon'), msg = $('cs-coupon-msg'), btn = $('cs-coupon-apply');
    if (coupon) { coupon = null; saveCoupon(); input.value = ''; msg.textContent = ''; renderCartBadge(); renderCart(); return; }
    const code = input.value.trim().toUpperCase();
    if (!code) { msg.textContent = 'Escribe tu código.'; return; }
    btn.disabled = true; msg.textContent = 'Revisando…';
    try {
      if (!API_URL) throw new Error('sin servicio');
      const res = await fetchJson(API_URL + 'cupon?codigo=' + encodeURIComponent(code), 6000);
      if (res && res.ok === true && Number(res.valor) > 0) {
        coupon = { codigo: String(res.codigo), tipo: res.tipo === 'monto' ? 'monto' : 'porcentaje', valor: Number(res.valor), minimo: Number(res.minimo) || 0 };
        saveCoupon(); msg.textContent = '';
      } else if (res && res.ok === false) {
        msg.textContent = res.motivo === 'vencido' ? 'Ese cupón ya venció.' : 'Ese cupón no es válido.';
      } else throw new Error('respuesta inesperada');
    } catch (e) {
      msg.textContent = 'No se pudo revisar el cupón. Inténtalo de nuevo.';
    }
    btn.disabled = false;
    renderCartBadge(); renderCart();
  }
  const cartUnits = () => cart.reduce((s, l) => s + l.cantidad, 0);

  function addToCart(p, tone, qty) {
    const tono = tone ? tone.nombre : '';
    const line = cart.find((l) => l.id === p.id && l.tono === tono);
    if (line) line.cantidad += qty; else cart.push({ id: p.id, tono, cantidad: qty });
    saveCart(); renderCartBadge();
    if (navigator.vibrate) navigator.vibrate(8);
    const badge = $('cart-count');
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  }

  function renderCartBadge() {
    const units = cartUnits();
    const count = $('cart-count');
    count.hidden = units === 0;
    count.textContent = units;
    $('cartbar').hidden = units === 0;
    $('cartbar-label').textContent = 'Ver pedido (' + units + ')';
    $('cartbar-total').textContent = totalText();
  }

  function renderCart() {
    const empty = cart.length === 0;
    $('cs-empty').hidden = !empty;
    $('cs-foot').hidden = empty;
    $('cs-note-wrap').hidden = empty;
    $('cs-clear').hidden = empty;
    $('cs-lines').replaceChildren(...cart.map((line) => {
      const p = productOf(line), tone = toneOf(line);
      const li = el('li', 'line');
      const chip = el('div', 'line__chip');
      const color = (tone && tone.color) || p.color;
      if (color) chip.style.setProperty('--swatch', color);
      if (p.imagen) {
        const thumb = new Image();
        thumb.alt = ''; thumb.loading = 'lazy'; thumb.src = p.imagen;
        thumb.addEventListener('error', () => thumb.remove());
        chip.append(thumb);
      }
      const text = el('div');
      text.append(el('div', 'line__name', p.nombre));
      if (line.tono) text.append(el('div', 'line__tone', 'Tono ' + line.tono));
      const price = el('div', 'line__price fig', priceOf(p, line.cantidad));

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
    $('cs-coupon-wrap').hidden = empty;
    const t = totals();
    const rows = [];
    const row = (label, value) => { const d = el('div', 'sum__row'); d.append(el('span', null, label), el('span', 'fig', value)); return d; };
    if (t.promos.length || t.couponAmount) rows.push(row('Subtotal', money(t.sub)));
    t.promos.forEach((x) => rows.push(row(x.label, '−' + money(x.amount))));
    if (t.couponAmount) rows.push(row(couponLabel(coupon), '−' + money(t.couponAmount)));
    $('cs-sum').replaceChildren(...rows);
    $('cs-coupon').value = coupon ? coupon.codigo : $('cs-coupon').value;
    $('cs-coupon').readOnly = !!coupon;
    $('cs-coupon-apply').textContent = coupon ? 'Quitar' : 'Aplicar';
    if (coupon) $('cs-coupon-msg').textContent = t.couponNote || 'Cupón aplicado.';
    $('cs-total').textContent = totalText();
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
      return '- ' + l.cantidad + ' x ' + p.nombre + (l.tono ? ' (' + l.tono + ')' : '') + ': ' + priceOf(p, l.cantidad).toLowerCase();
    });
    const note = $('cs-note').value.trim();
    const t = totals();
    const extra = [];
    if (t.promos.length || t.couponAmount) extra.push('Subtotal: ' + money(t.sub));
    t.promos.forEach((x) => extra.push(x.label + ': -' + money(x.amount)));
    if (t.couponAmount) extra.push(couponLabel(coupon) + ': -' + money(t.couponAmount));
    return ['Hola! Quiero hacer este pedido:', '', ...lines, '', ...extra, 'Total: ' + totalText(), ...(note ? ['', 'Nota: ' + note] : [])].join('\n');
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
  $('cat').addEventListener('change', (e) => {
    filter.cat = e.target.value;
    writeUrl(); renderGrid(); scrollToGrid();
  });

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
    hideSheet($('product-sheet'));
    toast('Agregado al pedido');
  });

  function openCart(fromUrl) { renderCart(); showSheet($('cart-sheet'), '#pedido', fromUrl === true); }
  $('open-cart').addEventListener('click', openCart);
  $('cartbar-btn').addEventListener('click', openCart);
  $('cs-coupon-apply').addEventListener('click', applyCoupon);
  $('cs-coupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });
  $('cs-note').addEventListener('input', () => { $('cs-send').href = waLink(orderMessage()); });
  $('cs-clear').addEventListener('click', () => {
    if (!confirm('¿Vaciar todo el pedido?')) return;
    cart = []; saveCart(); renderCartBadge(); renderCart();
  });

  $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $('ps-share').addEventListener('click', async () => {
    if (!current) return;
    const url = location.origin + location.pathname + '#p=' + encodeURIComponent(current.id);
    try {
      if (navigator.share) await navigator.share({ title: current.nombre, text: current.nombre, url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch (e) { /* la persona canceló */ }
  });

  document.querySelectorAll('dialog.sheet').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) hideSheet(dlg);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); hideSheet(dlg); });
    dlg.addEventListener('close', () => {
      if (location.hash && !(history.state && history.state.sheet)) history.replaceState(null, '', location.pathname + location.search);
    });

    // arrastrar hacia abajo desde el asa para cerrar
    const grab = dlg.querySelector('.sheet__grab');
    let startY = 0, dy = 0, t0 = 0, dragging = false;
    grab.addEventListener('pointerdown', (e) => {
      dragging = true; startY = e.clientY; dy = 0; t0 = e.timeStamp;
      grab.setPointerCapture(e.pointerId);
      dlg.classList.remove('is-settling');
    });
    grab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      dlg.style.transform = 'translateY(' + dy + 'px)';
    });
    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      const speed = dy / Math.max(1, e.timeStamp - t0);
      if (dy > 110 || (speed > 0.5 && dy > 30)) { hideSheet(dlg); return; }
      dlg.classList.add('is-settling');
      dlg.style.transform = '';
    };
    grab.addEventListener('pointerup', release);
    grab.addEventListener('pointercancel', release);
  });

  window.addEventListener('popstate', () => {
    pendingBack = false;
    if (!location.hash) document.querySelectorAll('dialog.sheet[open]').forEach(animateClose);
    else openFromHash();
    if (queued) { const run = queued; queued = null; run(); }
  });

  load();
})();
