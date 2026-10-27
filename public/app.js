// SmartVisual — aplicación de una sola página (sin frameworks).
// Habla con el backend (/api/...) donde viven los datos compartidos:
// negocios, promociones, opiniones con estrellas, catálogo y cupones.

'use strict';

const app = document.getElementById('app');

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...(opts || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Error ' + res.status));
  return data;
}

function starsHtml(avg, count) {
  const full = Math.round(avg || 0);
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="${i <= full ? '' : 'off'}">★</span>`;
  const label = count ? ` ${Number(avg).toFixed(1)} (${count} ${count === 1 ? 'opinión' : 'opiniones'})` : ' Sin opiniones todavía';
  return `<span class="stars" title="Promedio ${Number(avg || 0).toFixed(1)} de 5">${out}</span><span class="muted">${label}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toFixed(2);
}

function isOpenNow(open, close) {
  if (!open || !close) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const o = toM(open), c = toM(close);
  if (c > o) return mins >= o && mins < c;
  return mins >= o || mins < c; // horario nocturno
}

function openBadge(b) {
  const open = isOpenNow(b.hoursOpen, b.hoursClose);
  if (open === null) return '';
  return open
    ? '<span class="badge badge-activo">● Abierto ahora</span>'
    : '<span class="badge badge-vencido">● Cerrado ahora</span>';
}

function waLink(number, text) {
  const num = String(number || '').replace(/[^0-9]/g, '');
  if (!num) return null;
  return 'https://wa.me/' + num + (text ? '?text=' + encodeURIComponent(text) : '');
}

function tplClass(t) {
  return 'tpl-' + (t || 'calida');
}

function tplName(t) {
  return { calida: 'Cálida', atardecer: 'Atardecer', fresca: 'Fresca', cielo: 'Cielo', elegante: 'Elegante', fiesta: 'Fiesta' }[t] || 'Cálida';
}

function couponLabel(c) {
  return c.type === 'porcentaje' ? c.value + '% de descuento' : fmtMoney(c.value) + ' de descuento';
}

function showError(container, err) {
  container.insertAdjacentHTML('afterbegin', `<div class="error">${esc(err.message || err)}</div>`);
}

// ---------------------------------------------------------------------------
// Rutas (con #)
// ---------------------------------------------------------------------------
const routes = [
  { re: /^#\/$/, fn: renderHome },
  { re: /^#\/negocios$/, fn: renderBusinesses },
  { re: /^#\/negocio\/(\d+)$/, fn: (m) => renderBusiness(m[1]) },
  { re: /^#\/promo\/(\d+)$/, fn: (m) => renderPromotion(m[1]) },
  { re: /^#\/crear$/, fn: renderWizard },
  { re: /^#\/negocio-nuevo$/, fn: renderNewBusiness },
];

function router() {
  const hash = location.hash || '#/';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = (hash === '#/' && a.dataset.nav === 'vitrina') ||
      (hash.startsWith('#/negocios') && a.dataset.nav === 'negocios') ||
      (hash.startsWith('#/crear') && a.dataset.nav === 'crear');
    a.style.background = on && a.dataset.nav !== 'crear' ? 'rgba(255,255,255,0.25)' : '';
  });
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) { r.fn(m); return; }
  }
  renderHome();
}

window.addEventListener('hashchange', router);

// ---------------------------------------------------------------------------
// 1) Vitrina pública
// ---------------------------------------------------------------------------
let homeFilter = { category: '', search: '' };

async function renderHome() {
  app.innerHTML = `
    <h1>Vitrina de promociones</h1>
    <p class="sub">Promociones de negocios locales. Entra, mira y deja tu puntuación con estrellas: todos ven qué tan bueno y confiable es cada negocio.</p>
    <div class="filters">
      ${['', 'Servicios', 'Productos', 'Otras APK'].map((c) => `
        <button class="chip ${homeFilter.category === c ? 'active' : ''}" data-cat="${esc(c)}">${c === '' ? 'Todos' : esc(c)}</button>`).join('')}
      <input class="search" id="home-search" type="text" placeholder="Buscar una promoción o un negocio…" value="${esc(homeFilter.search)}">
    </div>
    <div id="promo-list"><p class="loading">Cargando promociones…</p></div>
    <div id="home-empty"></div>
  `;

  document.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => { homeFilter.category = btn.dataset.cat; renderHome(); });
  });
  const searchInput = document.getElementById('home-search');
  let t;
  searchInput.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { homeFilter.search = searchInput.value.trim(); loadPromos(); }, 300);
  });

  async function loadPromos() {
    const list = document.getElementById('promo-list');
    try {
      const params = new URLSearchParams();
      if (homeFilter.category) params.set('category', homeFilter.category);
      if (homeFilter.search) params.set('search', homeFilter.search);
      const promos = await api('/api/promotions?' + params.toString());
      if (!promos.length) {
        list.innerHTML = '';
        document.getElementById('home-empty').innerHTML = `
          <div class="empty">
            <div class="big">🌅</div>
            <h3>Todavía no hay promociones publicadas</h3>
            <p>SmartVisual empieza vacía. Crea el primer negocio y su primera promoción en 1 minuto.</p>
            <a class="btn btn-primary" href="#/negocio-nuevo">Crear el primer negocio</a>
            <a class="btn btn-secondary" href="#/crear">Crear promoción</a>
          </div>`;
        return;
      }
      document.getElementById('home-empty').innerHTML = '';
      list.innerHTML = `<div class="grid">${promos.map(promoCard).join('')}</div>`;
    } catch (e) {
      list.innerHTML = `<div class="error">No se pudieron cargar las promociones: ${esc(e.message)}</div>`;
    }
  }
  loadPromos();
}

function promoCard(p) {
  return `
  <article class="card">
    <div class="card-visual ${tplClass(p.template)}">
      ${p.format === 'video' ? '<span class="play">▶</span>' : ''}
      <span class="visual-title">${esc(p.title)}</span>
    </div>
    <div class="card-body">
      <span class="biz">${esc(p.business?.name || 'Negocio')}</span>
      <div>${starsHtml(p.businessAvgStars, p.businessReviewCount)}</div>
      <p class="text">${esc((p.text || '').slice(0, 120))}${(p.text || '').length > 120 ? '…' : ''}</p>
      <div>
        <span class="badge ${p.format === 'video' ? 'badge-video' : ''}">${p.format === 'video' ? '🎬 Video corto' : '🖼️ Imagen / flyer'}</span>
        ${p.coupon ? `<span class="badge">🎟️ ${esc(p.coupon.code)}</span>` : ''}
      </div>
      <div class="card-actions">
        <a class="btn btn-primary btn-small" href="#/promo/${p.id}">Ver y opinar</a>
        <a class="btn btn-secondary btn-small" href="#/negocio/${p.businessId}">Ver negocio</a>
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Negocios (lista)
// ---------------------------------------------------------------------------
async function renderBusinesses() {
  app.innerHTML = `
    <h1>Negocios</h1>
    <p class="sub">Todos los negocios que promocionan con SmartVisual. Entra a uno para ver su catálogo, sus cupones y lo que dicen sus clientes.</p>
    <div id="biz-list"><p class="loading">Cargando negocios…</p></div>
    <p style="margin-top:20px"><a class="btn btn-primary" href="#/negocio-nuevo">+ Agregar un negocio</a></p>
  `;
  try {
    const list = await api('/api/businesses');
    const el = document.getElementById('biz-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty"><div class="big">🏪</div><h3>Todavía no hay negocios</h3><p>Crea el primero y luego su promoción en 1 minuto.</p></div>`;
      return;
    }
    el.innerHTML = list.map((b) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title"><a href="#/negocio/${b.id}">${esc(b.name)}</a></div>
          <div class="li-sub">${esc(b.category)} · ${esc(b.location || 'Sin ubicación')} · ${b.promotionCount} ${b.promotionCount === 1 ? 'promoción' : 'promociones'}</div>
          <div>${starsHtml(b.avgStars, b.reviewCount)}</div>
        </div>
        <a class="btn btn-secondary btn-small" href="#/negocio/${b.id}">Ver perfil</a>
      </div>`).join('');
  } catch (e) {
    document.getElementById('biz-list').innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// 2) Perfil público del negocio
// ---------------------------------------------------------------------------
async function renderBusiness(id) {
  app.innerHTML = '<p class="loading">Cargando negocio…</p>';
  let b;
  try {
    b = await api('/api/businesses/' + id);
  } catch (e) {
    app.innerHTML = `<div class="error">${esc(e.message)}</div><p><a href="#/negocios">← Volver a negocios</a></p>`;
    return;
  }
  const wa = waLink(b.whatsapp, `Hola ${b.name}, vi tu promoción en SmartVisual.`);
  const hours = (b.hoursOpen && b.hoursClose) ? `${esc(b.hoursOpen)} – ${esc(b.hoursClose)}` : 'Horario no indicado';

  app.innerHTML = `
    <p><a href="#/negocios">← Negocios</a> · <a href="#/">Vitrina</a></p>
    <div class="hero">
      <div class="hero-visual ${tplClass(b.image || 'calida')}">
        <h1>${esc(b.name)}</h1>
        <p><span class="badge">${esc(b.category)}</span> ${openBadge(b)}</p>
      </div>
      <div class="hero-body">
        <p>${esc(b.description || 'Negocio local que promociona con SmartVisual.')}</p>
        <div class="kv">
          <span class="badge">📍 ${esc(b.location || 'Sin ubicación')}</span>
          <span class="badge">🕐 ${hours}</span>
        </div>
        <div>${starsHtml(b.avgStars, b.reviewCount)}</div>
        <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap">
          ${wa ? `<a class="btn btn-green" href="${wa}" target="_blank" rel="noopener" id="wa-btn">💬 Escríbeme por WhatsApp</a>` : ''}
          <a class="btn btn-primary" href="#/crear">+ Crear promoción para este negocio</a>
        </div>
      </div>
    </div>

    <section class="panel" id="resultados">
      <h2>📊 Resultados del negocio</h2>
      <p class="sub">En palabras sencillas: así le está yendo a ${esc(b.name)} en SmartVisual.</p>
      <div class="stat-grid">
        <div class="stat"><span class="num">${b.views}</span><span class="lbl">personas vieron sus promociones</span></div>
        <div class="stat"><span class="num">${b.clicks}</span><span class="lbl">clics en sus promociones</span></div>
        <div class="stat"><span class="num">${b.contacts}</span><span class="lbl">contactos por WhatsApp</span></div>
        <div class="stat"><span class="num">${b.reviewCount}</span><span class="lbl">opiniones con estrellas</span></div>
        <div class="stat"><span class="num">${b.avgStars ? Number(b.avgStars).toFixed(1) : '—'}</span><span class="lbl">promedio de estrellas</span></div>
      </div>
    </section>

    <section class="panel">
      <h2>🛍️ Catálogo de productos</h2>
      <div id="product-list">${b.products.length ? b.products.map(productRow).join('') : '<p class="muted">Este negocio todavía no tiene productos en su catálogo.</p>'}</div>
      <h3 style="margin-top:18px">Agregar un producto</h3>
      <form id="product-form">
        <div class="form-row">
          <div><label>Nombre del producto</label><input type="text" name="name" required maxlength="120" placeholder="Ej.: Café especial 250 g"></div>
          <div><label>Precio</label><input type="number" name="price" min="0" step="0.01" required placeholder="0.00"></div>
        </div>
        <label>Descripción</label><input type="text" name="description" maxlength="500" placeholder="Qué es, para quién, por qué gusta…">
        <label>Color de la foto (imagen de ejemplo)</label>
        <select name="image">
          <option value="calida">Cálida (naranja)</option>
          <option value="atardecer">Atardecer (terracota)</option>
          <option value="fresca">Fresca (verde)</option>
          <option value="cielo">Cielo (azul)</option>
          <option value="elegante">Elegante (verde oscuro)</option>
          <option value="fiesta">Fiesta (morado)</option>
        </select>
        <div style="margin-top:12px"><button class="btn btn-primary" type="submit">Agregar producto</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>🎟️ Cupones de descuento</h2>
      <div id="coupon-list">${b.coupons.length ? b.coupons.map(couponRow).join('') : '<p class="muted">Este negocio todavía no tiene cupones.</p>'}</div>
      <h3 style="margin-top:18px">Crear un cupón</h3>
      <form id="coupon-form">
        <div class="form-row">
          <div><label>Código del cupón</label><input type="text" name="code" required maxlength="40" placeholder="Ej.: BIENVENIDO10"></div>
          <div><label>Tipo de descuento</label>
            <select name="type"><option value="porcentaje">Porcentaje (%)</option><option value="cantidad">Cantidad fija ($)</option></select>
          </div>
        </div>
        <div class="form-row">
          <div><label>Valor del descuento</label><input type="number" name="value" min="0.01" step="0.01" required placeholder="Ej.: 10"></div>
          <div><label>Fecha de vencimiento</label><input type="date" name="expiresAt" required></div>
        </div>
        <div style="margin-top:12px"><button class="btn btn-primary" type="submit">Crear cupón</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>📣 Promociones de este negocio</h2>
      ${b.promotions.length ? b.promotions.map((p) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title"><a href="#/promo/${p.id}">${esc(p.title)}</a></div>
            <div class="li-sub">
              <span class="badge ${p.status === 'programada' ? 'badge-programada' : ''}">${p.status === 'programada' ? '🕐 Programada' : '✅ Publicada'}</span>
              ${p.scheduledAt ? ` · ${fmtDate(p.scheduledAt)}` : ''} · ${p.views} visitas
            </div>
          </div>
          <a class="btn btn-secondary btn-small" href="#/promo/${p.id}">Ver</a>
        </div>`).join('') : '<p class="muted">Todavía no tiene promociones.</p>'}
    </section>

    <section class="panel">
      <h2>⭐ Opiniones de los clientes</h2>
      <div id="review-list">${b.reviews.length ? b.reviews.map(reviewRow).join('') : '<p class="muted">Nadie ha opinado todavía. ¡Sé la primera persona en dejar tu puntuación!</p>'}</div>
      <h3 style="margin-top:18px">Deja tu opinión</h3>
      <form id="review-form">
        <label>Tu puntuación</label>
        <div class="star-picker" id="star-picker">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} estrellas">★</button>`).join('')}
        </div>
        <input type="hidden" id="review-stars" value="5">
        <label>Tu nombre (opcional)</label>
        <input type="text" id="review-author" maxlength="80" placeholder="Ej.: María">
        <label>Tu comentario</label>
        <textarea id="review-comment" maxlength="1000" placeholder="¿Qué te pareció el negocio o la promoción?"></textarea>
        <div style="margin-top:12px"><button class="btn btn-primary" type="submit">Publicar mi opinión</button></div>
      </form>
    </section>
  `;

  // WhatsApp: cuenta como un contacto del negocio.
  const waBtn = document.getElementById('wa-btn');
  if (waBtn) waBtn.addEventListener('click', () => { api('/api/businesses/' + b.id + '/contact', { method: 'POST' }).catch(() => {}); });

  // Opiniones: selector de estrellas.
  let picked = 5;
  const picker = document.getElementById('star-picker');
  const paintStars = () => picker.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('on', Number(btn.dataset.star) <= picked);
  });
  paintStars();
  picker.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      picked = Number(btn.dataset.star);
      document.getElementById('review-stars').value = picked;
      paintStars();
    });
  });
  document.getElementById('review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/businesses/' + b.id + '/reviews', {
        method: 'POST',
        body: JSON.stringify({
          stars: picked,
          author: document.getElementById('review-author').value.trim(),
          comment: document.getElementById('review-comment').value.trim(),
        }),
      });
      renderBusiness(b.id);
    } catch (err) { showError(app, err); }
  });

  // Productos: crear y eliminar.
  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/businesses/' + b.id + '/products', {
        method: 'POST',
        body: JSON.stringify({
          name: f.get('name'), price: f.get('price'),
          description: f.get('description'), image: f.get('image'),
        }),
      });
      renderBusiness(b.id);
    } catch (err) { showError(app, err); }
  });
  document.querySelectorAll('[data-del-product]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este producto del catálogo?')) return;
      await api('/api/products/' + btn.dataset.delProduct, { method: 'DELETE' }).catch((err) => showError(app, err));
      renderBusiness(b.id);
    });
  });

  // Cupones: crear y eliminar.
  document.getElementById('coupon-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/businesses/' + b.id + '/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: f.get('code'), type: f.get('type'),
          value: f.get('value'), expiresAt: f.get('expiresAt'),
        }),
      });
      renderBusiness(b.id);
    } catch (err) { showError(app, err); }
  });
  document.querySelectorAll('[data-del-coupon]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este cupón?')) return;
      await api('/api/coupons/' + btn.dataset.delCoupon, { method: 'DELETE' }).catch((err) => showError(app, err));
      renderBusiness(b.id);
    });
  });
}

function productRow(p) {
  return `
  <div class="list-item">
    <div class="li-main">
      <div class="li-title">${esc(p.name)} — ${fmtMoney(p.price)}</div>
      <div class="li-sub">${esc(p.description || 'Sin descripción')}</div>
    </div>
    <button class="btn btn-danger btn-small" data-del-product="${p.id}">Eliminar</button>
  </div>`;
}

function couponRow(c) {
  return `
  <div class="list-item">
    <div class="li-main">
      <span class="coupon-code">${esc(c.code)}</span>
      <span class="badge ${c.status === 'activo' ? 'badge-activo' : 'badge-vencido'}">${c.status === 'activo' ? '✅ Activo' : '⌛ Vencido'}</span>
      <div class="li-sub">${couponLabel(c)} · vence el ${fmtDate(c.expiresAt).split(',')[0] || c.expiresAt}</div>
    </div>
    <button class="btn btn-danger btn-small" data-del-coupon="${c.id}">Eliminar</button>
  </div>`;
}

function reviewRow(r) {
  return `
  <div class="review">
    <div>${starsHtml(r.stars, 0)} <span class="who">${esc(r.author || 'Visitante')}</span> <span class="when">· ${fmtDate(r.createdAt)}</span></div>
    ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 3) Detalle de una promoción (pública, con opiniones)
// ---------------------------------------------------------------------------
async function renderPromotion(id) {
  app.innerHTML = '<p class="loading">Cargando promoción…</p>';
  let p, music = [];
  try {
    [p, music] = await Promise.all([api('/api/promotions/' + id), api('/api/music')]);
  } catch (e) {
    app.innerHTML = `<div class="error">${esc(e.message)}</div><p><a href="#/">← Volver a la vitrina</a></p>`;
    return;
  }
  const track = music.find((m) => m.id === p.music);
  const wa = waLink(p.business?.whatsapp, `Hola ${p.business?.name || ''}, vi tu promoción "${p.title}" en SmartVisual.`);
  const biz = p.business || {};

  app.innerHTML = `
    <p><a href="#/">← Vitrina</a> · <a href="#/negocio/${p.businessId}">${esc(biz.name || 'Negocio')}</a></p>
    <div class="hero">
      <div class="hero-visual ${tplClass(p.template)}">
        ${p.format === 'video' ? '<span class="play">▶</span>' : ''}
        <h1>${esc(p.title)}</h1>
        <p>
          <span class="badge ${p.format === 'video' ? 'badge-video' : ''}">${p.format === 'video' ? '🎬 Video corto' : '🖼️ Imagen / flyer'}</span>
          <span class="badge ${p.status === 'programada' ? 'badge-programada' : ''}">${p.status === 'programada' ? '🕐 Programada' : '✅ Publicada'}</span>
        </p>
        ${p.status === 'programada' ? `<p>Se publicará el ${fmtDate(p.scheduledAt)}.</p>` : ''}
      </div>
      <div class="hero-body">
        <p style="font-size:18px">${esc(p.text || '')}</p>
        ${track ? `<p><strong>🎵 Música:</strong> ${esc(track.name)} <span class="muted">(${esc(track.mood)})</span><br><audio controls src="${track.file}" style="margin-top:6px; max-width:100%"></audio></p>` : ''}
        ${p.product ? `<p><strong>🛍️ Producto:</strong> ${esc(p.product.name)} — ${fmtMoney(p.product.price)}</p>` : ''}
        ${p.coupon ? `<p><strong>🎟️ Cupón:</strong> <span class="coupon-code">${esc(p.coupon.code)}</span> ${couponLabel(p.coupon)} <span class="badge ${p.coupon.status === 'activo' ? 'badge-activo' : 'badge-vencido'}">${p.coupon.status}</span></p>` : ''}
        <div>${starsHtml(p.businessAvgStars, p.businessReviewCount)}</div>
        <p class="muted">👁️ ${p.views} ${p.views === 1 ? 'visita' : 'visitas'} · 🖱️ ${p.clicks} clics · 💬 ${p.contacts} contactos</p>
        <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap">
          ${wa ? `<a class="btn btn-green" href="${wa}" target="_blank" rel="noopener" id="wa-btn">💬 Contactar por WhatsApp</a>` : ''}
          <a class="btn btn-secondary" href="#/negocio/${p.businessId}">Ver el negocio</a>
        </div>
      </div>
    </div>

    <section class="panel">
      <h2>⭐ ¿Qué te parece este negocio?</h2>
      <p class="sub">Tu puntuación la ven todos los visitantes. Así saben qué tan bueno y confiable es.</p>
      <div id="promo-reviews">${(p.reviews || []).length ? p.reviews.map(reviewRow).join('') : '<p class="muted">Todavía no hay opiniones sobre esta promoción.</p>'}</div>
      <h3 style="margin-top:18px">Deja tu puntuación</h3>
      <form id="promo-review-form">
        <label>Tu puntuación</label>
        <div class="star-picker" id="star-picker">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} estrellas">★</button>`).join('')}
        </div>
        <label>Tu nombre (opcional)</label>
        <input type="text" id="review-author" maxlength="80" placeholder="Ej.: María">
        <label>Tu comentario</label>
        <textarea id="review-comment" maxlength="1000" placeholder="¿Qué te pareció?"></textarea>
        <div style="margin-top:12px"><button class="btn btn-primary" type="submit">Publicar mi puntuación</button></div>
      </form>
    </section>
  `;

  const waBtn = document.getElementById('wa-btn');
  if (waBtn) waBtn.addEventListener('click', () => {
    api('/api/promotions/' + p.id + '/contact', { method: 'POST' }).catch(() => {});
  });

  let picked = 5;
  const picker = document.getElementById('star-picker');
  const paint = () => picker.querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', Number(btn.dataset.star) <= picked));
  paint();
  picker.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => { picked = Number(btn.dataset.star); paint(); }));
  document.getElementById('promo-review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/promotions/' + p.id + '/reviews', {
        method: 'POST',
        body: JSON.stringify({
          stars: picked,
          author: document.getElementById('review-author').value.trim(),
          comment: document.getElementById('review-comment').value.trim(),
        }),
      });
      renderPromotion(p.id);
    } catch (err) { showError(app, err); }
  });
}

// ---------------------------------------------------------------------------
// 4) Crear un negocio
// ---------------------------------------------------------------------------
function renderNewBusiness() {
  app.innerHTML = `
    <h1>Agregar un negocio</h1>
    <p class="sub">Primero el negocio, luego su promoción en 1 minuto. Empieza vacío: tú pones los datos.</p>
    <form id="biz-form" class="panel" style="margin-top:0">
      <label>Nombre del negocio *</label>
      <input type="text" name="name" required maxlength="120" placeholder="Ej.: Cafetería El Aroma">
      <div class="form-row">
        <div><label>Categoría *</label>
          <select name="category">
            <option>Servicios</option>
            <option>Productos</option>
            <option>Otras APK</option>
          </select>
        </div>
        <div><label>Color de portada</label>
          <select name="image">
            <option value="calida">Cálida (naranja)</option>
            <option value="atardecer">Atardecer (terracota)</option>
            <option value="fresca">Fresca (verde)</option>
            <option value="cielo">Cielo (azul)</option>
            <option value="elegante">Elegante (verde oscuro)</option>
            <option value="fiesta">Fiesta (morado)</option>
          </select>
        </div>
      </div>
      <label>Descripción</label>
      <textarea name="description" maxlength="1000" placeholder="¿Qué ofrece este negocio?"></textarea>
      <label>Ubicación</label>
      <input type="text" name="location" maxlength="200" placeholder="Ej.: Calle Principal 123, La Habana">
      <div class="form-row">
        <div><label>Abre a las</label><input type="text" name="hoursOpen" placeholder="08:00" maxlength="10"></div>
        <div><label>Cierra a las</label><input type="text" name="hoursClose" placeholder="18:00" maxlength="10"></div>
      </div>
      <label>WhatsApp (número con código de país, solo dígitos)</label>
      <input type="tel" name="whatsapp" maxlength="40" placeholder="Ej.: 5351234567">
      <p class="help">El botón de WhatsApp del perfil abre un chat con este número.</p>
      <div style="margin-top:16px"><button class="btn btn-primary" type="submit">Guardar negocio</button></div>
    </form>
  `;
  document.getElementById('biz-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const b = await api('/api/businesses', {
        method: 'POST',
        body: JSON.stringify({
          name: f.get('name'), category: f.get('category'), description: f.get('description'),
          location: f.get('location'), hoursOpen: f.get('hoursOpen'), hoursClose: f.get('hoursClose'),
          whatsapp: f.get('whatsapp'), image: f.get('image'),
        }),
      });
      location.hash = '#/negocio/' + b.id;
    } catch (err) { showError(app, err); }
  });
}

// ---------------------------------------------------------------------------
// 5) Asistente: crear promoción en 1 minuto (5 pasos)
// ---------------------------------------------------------------------------
const OBJECTIVES = [
  'Dar a conocer mi negocio',
  'Vender un producto',
  'Atraer clientes nuevos',
  'Anunciar una oferta',
];
const TEMPLATES = ['calida', 'atardecer', 'fresca', 'cielo', 'elegante', 'fiesta'];

const wiz = {
  step: 1, businessId: '', title: '', objective: OBJECTIVES[0],
  format: 'imagen', template: 'calida', music: 'relajante-calma',
  productId: '', couponId: '', publishMode: 'ahora', scheduledAt: '', text: '',
};
let wizBusinesses = [];
let wizMusic = [];
let wizProducts = [];
let wizCoupons = [];

function suggestText() {
  const biz = wizBusinesses.find((b) => String(b.id) === String(wiz.businessId));
  const name = biz ? biz.name : 'Nuestro negocio';
  const product = wizProducts.find((p) => String(p.id) === String(wiz.productId));
  const coupon = wizCoupons.find((c) => String(c.id) === String(wiz.couponId));
  switch (wiz.objective) {
    case 'Vender un producto':
      return product
        ? `${product.name} por ${fmtMoney(product.price)} en ${name}. ${product.description || ''} ¡Pídelo hoy! Tu promoción lista en 1 minuto.`
        : `${name} — tenemos lo que buscas. ¡Ven y descúbrelo! Tu promoción lista en 1 minuto.`;
    case 'Atraer clientes nuevos':
      return `¿Todavía no conoces ${name}? Ven a visitarnos y descubre por qué nuestros clientes nos recomiendan. ¡Te esperamos!`;
    case 'Anunciar una oferta':
      return coupon
        ? `¡Oferta en ${name}! Usa el cupón ${coupon.code} y llévate ${couponLabel(coupon)}. Válido hasta el ${fmtDate(coupon.expiresAt).split(',')[0]}. ¡No te la pierdas!`
        : `¡Oferta especial en ${name}! Ven hoy y aprovecha. Tu promoción lista en 1 minuto.`;
    default:
      return `${name} — tu negocio de confianza. ${biz && biz.description ? biz.description + ' ' : ''}¡Ven a conocernos!`;
  }
}

async function renderWizard() {
  const steps = ['1. Objetivo', '2. Plantilla', '3. Música', '4. Datos', '5. Textos'];
  app.innerHTML = `
    <h1>Crear promoción en 1 minuto</h1>
    <p class="sub">Cinco pasos y listo. Los textos te los sugerimos y tú los editas: mitad y mitad.</p>
    <div class="steps">${steps.map((s, i) => `<div class="step-dot ${wiz.step === i + 1 ? 'active' : ''} ${wiz.step > i + 1 ? 'done' : ''}">${s}</div>`).join('')}</div>
    <div id="wiz-body"><p class="loading">Cargando…</p></div>
  `;
  const body = document.getElementById('wiz-body');

  try {
    wizBusinesses = await api('/api/businesses');
    wizMusic = await api('/api/music');
  } catch (e) {
    body.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }

  if (!wizBusinesses.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="big">🏪</div>
        <h3>Primero necesitas un negocio</h3>
        <p>SmartVisual empieza vacía. Crea tu primer negocio y vuelve aquí a hacer su promoción.</p>
        <a class="btn btn-primary" href="#/negocio-nuevo">Crear el primer negocio</a>
      </div>`;
    return;
  }

  if (wiz.step === 1) {
    body.innerHTML = `
      <form id="wiz-1" class="panel" style="margin-top:0">
        <label>¿Para qué negocio es la promoción? *</label>
        <select id="wiz-biz">${wizBusinesses.map((b) => `<option value="${b.id}" ${String(b.id) === String(wiz.businessId) ? 'selected' : ''}>${esc(b.name)} (${esc(b.category)})</option>`).join('')}</select>
        <label>¿Qué quieres lograr con esta promoción? *</label>
        <select id="wiz-obj">${OBJECTIVES.map((o) => `<option ${o === wiz.objective ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <label>Título de la promoción *</label>
        <input type="text" id="wiz-title" required maxlength="140" value="${esc(wiz.title)}" placeholder="Ej.: ¡Café fresco cada mañana!">
        <div class="wizard-actions">
          <button class="btn btn-primary" type="submit">Siguiente →</button>
        </div>
      </form>`;
    if (!wiz.businessId) wiz.businessId = wizBusinesses[0].id;
    document.getElementById('wiz-1').addEventListener('submit', (e) => {
      e.preventDefault();
      wiz.businessId = document.getElementById('wiz-biz').value;
      wiz.objective = document.getElementById('wiz-obj').value;
      wiz.title = document.getElementById('wiz-title').value.trim();
      wiz.step = 2;
      renderWizard();
    });
  }

  if (wiz.step === 2) {
    body.innerHTML = `
      <div class="panel" style="margin-top:0">
        <label>Formato de la promoción</label>
        <div class="filters">
          <button class="chip ${wiz.format === 'imagen' ? 'active' : ''}" id="fmt-img">🖼️ Imagen / flyer</button>
          <button class="chip ${wiz.format === 'video' ? 'active' : ''}" id="fmt-vid">🎬 Video corto</button>
        </div>
        <label>Elige una plantilla (el estilo de colores)</label>
        <div class="tpl-grid">
          ${TEMPLATES.map((t) => `
            <button class="tpl-option ${wiz.template === t ? 'selected' : ''}" data-tpl="${t}">
              <span class="swatch ${tplClass(t)}">${wiz.format === 'video' ? '▶' : '✦'}</span>
              <span class="tpl-name">${tplName(t)}</span>
            </button>`).join('')}
        </div>
        <div class="wizard-actions">
          <button class="btn btn-secondary" id="wiz-back">← Atrás</button>
          <button class="btn btn-primary" id="wiz-next">Siguiente →</button>
        </div>
      </div>`;
    document.getElementById('fmt-img').addEventListener('click', () => { wiz.format = 'imagen'; renderWizard(); });
    document.getElementById('fmt-vid').addEventListener('click', () => { wiz.format = 'video'; renderWizard(); });
    body.querySelectorAll('[data-tpl]').forEach((btn) => btn.addEventListener('click', () => { wiz.template = btn.dataset.tpl; renderWizard(); }));
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 1; renderWizard(); });
    document.getElementById('wiz-next').addEventListener('click', () => { wiz.step = 3; renderWizard(); });
  }

  if (wiz.step === 3) {
    body.innerHTML = `
      <div class="panel" style="margin-top:0">
        <label>Elige la música de fondo (opcional)</label>
        <div class="music-row ${wiz.music === '' ? 'selected' : ''}" data-music="">
          <div class="music-info"><div class="music-name">Sin música</div><div class="music-mood">Solo imagen o video, sin sonido.</div></div>
          <button class="btn btn-secondary btn-small" data-pick="">Elegir</button>
        </div>
        ${wizMusic.map((m) => `
          <div class="music-row ${wiz.music === m.id ? 'selected' : ''}" data-music="${m.id}">
            <div class="music-info">
              <div class="music-name">${esc(m.name)} ${m.favorite ? '<span class="fav">★ La favorita</span>' : ''}</div>
              <div class="music-mood">${esc(m.mood)}</div>
            </div>
            <audio controls preload="none" src="${m.file}"></audio>
            <button class="btn btn-secondary btn-small" data-pick="${m.id}">Elegir</button>
          </div>`).join('')}
        <div class="wizard-actions">
          <button class="btn btn-secondary" id="wiz-back">← Atrás</button>
          <button class="btn btn-primary" id="wiz-next">Siguiente →</button>
        </div>
      </div>`;
    body.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => { wiz.music = btn.dataset.pick; renderWizard(); }));
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 2; renderWizard(); });
    document.getElementById('wiz-next').addEventListener('click', () => { wiz.step = 4; renderWizard(); });
  }

  if (wiz.step === 4) {
    const biz = await api('/api/businesses/' + wiz.businessId);
    wizProducts = biz.products || [];
    wizCoupons = biz.coupons || [];
    body.innerHTML = `
      <form id="wiz-4" class="panel" style="margin-top:0">
        <label>Producto del catálogo (opcional)</label>
        <select id="wiz-product">
          <option value="">— Sin producto —</option>
          ${wizProducts.map((p) => `<option value="${p.id}" ${String(p.id) === String(wiz.productId) ? 'selected' : ''}>${esc(p.name)} — ${fmtMoney(p.price)}</option>`).join('')}
        </select>
        ${wizProducts.length ? '' : '<p class="help">Este negocio aún no tiene catálogo. Puedes agregarlo en su perfil.</p>'}
        <label>Cupón de descuento (opcional)</label>
        <select id="wiz-coupon">
          <option value="">— Sin cupón —</option>
          ${wizCoupons.filter((c) => c.status === 'activo').map((c) => `<option value="${c.id}" ${String(c.id) === String(wiz.couponId) ? 'selected' : ''}>${esc(c.code)} — ${couponLabel(c)}</option>`).join('')}
        </select>
        ${wizCoupons.filter((c) => c.status === 'activo').length ? '' : '<p class="help">Este negocio aún no tiene cupones activos. Puedes crearlos en su perfil.</p>'}
        <label>¿Cuándo se publica?</label>
        <div class="filters">
          <button type="button" class="chip ${wiz.publishMode === 'ahora' ? 'active' : ''}" id="pub-ahora">✅ Publicar ahora</button>
          <button type="button" class="chip ${wiz.publishMode === 'programar' ? 'active' : ''}" id="pub-prog">🕐 Programar</button>
        </div>
        <div id="schedule-box" style="display:${wiz.publishMode === 'programar' ? 'block' : 'none'}">
          <label>Fecha y hora de publicación</label>
          <input type="datetime-local" id="wiz-when" value="${esc(wiz.scheduledAt)}">
          <p class="help">La promoción no saldrá en la vitrina hasta esa hora. La verás en la lista como “Programada”.</p>
        </div>
        <div class="wizard-actions">
          <button class="btn btn-secondary" id="wiz-back" type="button">← Atrás</button>
          <button class="btn btn-primary" type="submit">Siguiente →</button>
        </div>
      </form>`;
    document.getElementById('pub-ahora').addEventListener('click', () => { wiz.publishMode = 'ahora'; renderWizard(); });
    document.getElementById('pub-prog').addEventListener('click', () => { wiz.publishMode = 'programar'; renderWizard(); });
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 3; renderWizard(); });
    document.getElementById('wiz-4').addEventListener('submit', (e) => {
      e.preventDefault();
      wiz.productId = document.getElementById('wiz-product').value;
      wiz.couponId = document.getElementById('wiz-coupon').value;
      if (wiz.publishMode === 'programar') {
        const when = document.getElementById('wiz-when').value;
        if (!when) { showError(body, new Error('Elige la fecha y la hora para programar la publicación.')); return; }
        if (new Date(when).getTime() <= Date.now()) { showError(body, new Error('La fecha de publicación debe ser en el futuro.')); return; }
        wiz.scheduledAt = when;
      } else {
        wiz.scheduledAt = '';
      }
      wiz.step = 5;
      renderWizard();
    });
  }

  if (wiz.step === 5) {
    const suggestion = wiz.text || suggestText();
    body.innerHTML = `
      <form id="wiz-5" class="panel" style="margin-top:0">
        <label>Texto de la promoción (sugerido — edítalo a tu gusto)</label>
        <p class="help">Mitad y mitad: SmartVisual sugiere el texto y tú lo editas.</p>
        <textarea id="wiz-text" maxlength="1000" style="min-height:130px">${esc(suggestion)}</textarea>
        <div class="panel" style="background:var(--crema)">
          <h3>Resumen</h3>
          <p class="muted">
            Negocio: <strong>${esc((wizBusinesses.find((b) => String(b.id) === String(wiz.businessId)) || {}).name || '')}</strong><br>
            Objetivo: ${esc(wiz.objective)} · Formato: ${wiz.format === 'video' ? 'Video corto' : 'Imagen / flyer'} · Plantilla: ${tplName(wiz.template)}<br>
            Música: ${wiz.music ? esc((wizMusic.find((m) => m.id === wiz.music) || {}).name || 'Sin música') : 'Sin música'}<br>
            Publicación: ${wiz.publishMode === 'programar' ? '🕐 Programada para el ' + fmtDate(wiz.scheduledAt) : '✅ Ahora mismo'}
          </p>
        </div>
        <div id="wiz-result"></div>
        <div class="wizard-actions">
          <button class="btn btn-secondary" id="wiz-back" type="button">← Atrás</button>
          <button class="btn btn-primary" type="submit" id="wiz-publish">✨ Publicar mi promoción</button>
        </div>
      </form>`;
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 4; renderWizard(); });
    document.getElementById('wiz-5').addEventListener('submit', async (e) => {
      e.preventDefault();
      wiz.text = document.getElementById('wiz-text').value.trim();
      const btn = document.getElementById('wiz-publish');
      btn.disabled = true;
      btn.textContent = 'Publicando…';
      try {
        const p = await api('/api/businesses/' + wiz.businessId + '/promotions', {
          method: 'POST',
          body: JSON.stringify({
            title: wiz.title, objective: wiz.objective, format: wiz.format,
            template: wiz.template, music: wiz.music, text: wiz.text,
            productId: wiz.productId || null, couponId: wiz.couponId || null,
            scheduledAt: wiz.publishMode === 'programar' ? new Date(wiz.scheduledAt).toISOString() : null,
          }),
        });
        // Reiniciar el asistente para la próxima promoción.
        Object.assign(wiz, { step: 1, title: '', productId: '', couponId: '', publishMode: 'ahora', scheduledAt: '', text: '' });
        document.getElementById('wiz-result').innerHTML = `
          <div class="ok-msg">¡Listo! Tu promoción “${esc(p.title)}” quedó ${p.status === 'programada' ? 'programada para el ' + fmtDate(p.scheduledAt) : 'publicada'}.</div>`;
        setTimeout(() => { location.hash = '#/promo/' + p.id; }, 900);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '✨ Publicar mi promoción';
        showError(document.getElementById('wiz-result'), err);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
router();
