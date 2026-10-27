// SmartVisual — servidor completo en un solo proceso.
// Express + SQLite (node:sqlite, integrado en Node 22.5+).
// Sin cuentas, sin servicios externos: todos los datos viven en ./data/smartvisual.db
// y los comparten TODOS los visitantes (vitrina pública + opiniones con estrellas).
//
// Arranque:  npm install && npm start   (puerto 3000, o PORT si se define)

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'smartvisual.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ---------------------------------------------------------------------------
// Esquema de la base de datos
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Servicios','Productos','Otras APK')),
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  hoursOpen TEXT NOT NULL DEFAULT '',
  hoursClose TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  businessId INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'imagen' CHECK (format IN ('imagen','video')),
  template TEXT NOT NULL DEFAULT 'calida',
  music TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  productId INTEGER NULL REFERENCES products(id) ON DELETE SET NULL,
  couponId INTEGER NULL REFERENCES coupons(id) ON DELETE SET NULL,
  scheduledAt TEXT NULL,
  createdAt TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  contacts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  businessId INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  promotionId INTEGER NULL REFERENCES promotions(id) ON DELETE SET NULL,
  author TEXT NOT NULL DEFAULT 'Visitante',
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  businessId INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT 'naranja',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  businessId INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'porcentaje' CHECK (type IN ('porcentaje','cantidad')),
  value REAL NOT NULL DEFAULT 0,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();

function promotionStatus(p) {
  if (p.scheduledAt && new Date(p.scheduledAt).getTime() > Date.now()) return 'programada';
  return 'publicada';
}

function couponStatus(c) {
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return 'vencido';
  return 'activo';
}

function businessStats(businessId) {
  const row = db.prepare(`
    SELECT
      COALESCE((SELECT COUNT(*) FROM reviews WHERE businessId = ?), 0) AS reviewCount,
      COALESCE((SELECT AVG(stars) FROM reviews WHERE businessId = ?), 0) AS avgStars,
      COALESCE((SELECT SUM(views) FROM promotions WHERE businessId = ?), 0) AS views,
      COALESCE((SELECT SUM(clicks) FROM promotions WHERE businessId = ?), 0) AS clicks,
      COALESCE((SELECT SUM(contacts) FROM promotions WHERE businessId = ?), 0) AS contacts,
      COALESCE((SELECT COUNT(*) FROM promotions WHERE businessId = ?), 0) AS promotionCount,
      COALESCE((SELECT COUNT(*) FROM products WHERE businessId = ?), 0) AS productCount,
      COALESCE((SELECT COUNT(*) FROM coupons WHERE businessId = ?), 0) AS couponCount
  `).get(businessId, businessId, businessId, businessId, businessId, businessId, businessId, businessId);
  return {
    reviewCount: row.reviewCount,
    avgStars: Math.round(row.avgStars * 10) / 10,
    views: row.views,
    clicks: row.clicks,
    contacts: row.contacts,
    promotionCount: row.promotionCount,
    productCount: row.productCount,
    couponCount: row.couponCount,
  };
}

function businessPublic(b) {
  if (!b) return null;
  const stats = businessStats(b.id);
  return { ...b, ...stats };
}

function promotionPublic(p) {
  const business = db.prepare('SELECT id, name, category, location FROM businesses WHERE id = ?').get(p.businessId);
  const product = p.productId ? db.prepare('SELECT id, name, price, description, image FROM products WHERE id = ?').get(p.productId) : null;
  const couponRaw = p.couponId ? db.prepare('SELECT * FROM coupons WHERE id = ?').get(p.couponId) : null;
  const coupon = couponRaw ? { ...couponRaw, status: couponStatus(couponRaw) } : null;
  const stats = businessStats(p.businessId);
  return {
    ...p,
    status: promotionStatus(p),
    business,
    product,
    coupon,
    businessAvgStars: stats.avgStars,
    businessReviewCount: stats.reviewCount,
  };
}

function bad(res, code, message) {
  return res.status(code).json({ error: message });
}

function cleanStr(v, max = 500) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// App Express
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));

// Archivos estáticos: la app (index.html, css, js) + logo + música.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Biblioteca musical (archivos originales de SmartVisual, libres para uso en la app).
const MUSIC = [
  { id: 'relajante-calma', name: 'Relajante — Calma', mood: 'Dulce y suave, como piano', file: '/assets/musica/relajante-calma.mp3', favorite: true },
  { id: 'alegre-soleado', name: 'Alegre — Soleado', mood: 'Animada y luminosa', file: '/assets/musica/alegre-soleado.mp3' },
  { id: 'elegante-cafe', name: 'Elegante — Café', mood: 'Tranquila y con clase', file: '/assets/musica/elegante-cafe.mp3' },
  { id: 'energetica-impulso', name: 'Energética — Impulso', mood: 'Con fuerza y ritmo', file: '/assets/musica/energetica-impulso.mp3' },
];
app.get('/api/music', (req, res) => res.json(MUSIC));

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'SmartVisual', time: nowIso() }));

// ---------------------------------------------------------------------------
// Negocios
// ---------------------------------------------------------------------------
app.get('/api/businesses', (req, res) => {
  const { search = '', category = '' } = req.query;
  let rows = db.prepare('SELECT * FROM businesses ORDER BY createdAt DESC').all();
  if (category) rows = rows.filter((b) => b.category === category);
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((b) => (b.name + ' ' + b.description + ' ' + b.location).toLowerCase().includes(q));
  }
  res.json(rows.map(businessPublic));
});

app.post('/api/businesses', (req, res) => {
  const name = cleanStr(req.body.name, 120);
  const category = req.body.category;
  if (!name) return bad(res, 400, 'El negocio necesita un nombre.');
  if (!['Servicios', 'Productos', 'Otras APK'].includes(category)) {
    return bad(res, 400, 'La categoría debe ser Servicios, Productos u Otras APK.');
  }
  const info = db.prepare(
    'INSERT INTO businesses (name, category, description, location, hoursOpen, hoursClose, whatsapp, image, createdAt) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    name, category,
    cleanStr(req.body.description, 1000),
    cleanStr(req.body.location, 200),
    cleanStr(req.body.hoursOpen, 10),
    cleanStr(req.body.hoursClose, 10),
    cleanStr(req.body.whatsapp, 40),
    cleanStr(req.body.image, 40),
    nowIso()
  );
  res.status(201).json(businessPublic(db.prepare('SELECT * FROM businesses WHERE id = ?').get(info.lastInsertRowid)));
});

app.get('/api/businesses/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const products = db.prepare('SELECT * FROM products WHERE businessId = ? ORDER BY createdAt DESC').all(b.id);
  const coupons = db.prepare('SELECT * FROM coupons WHERE businessId = ? ORDER BY createdAt DESC').all(b.id)
    .map((c) => ({ ...c, status: couponStatus(c) }));
  const promotions = db.prepare('SELECT * FROM promotions WHERE businessId = ? ORDER BY createdAt DESC').all(b.id)
    .map(promotionPublic);
  const reviews = db.prepare('SELECT * FROM reviews WHERE businessId = ? ORDER BY createdAt DESC').all(b.id);
  res.json({ ...businessPublic(b), products, coupons, promotions, reviews });
});

app.put('/api/businesses/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const name = cleanStr(req.body.name, 120) || b.name;
  const category = ['Servicios', 'Productos', 'Otras APK'].includes(req.body.category) ? req.body.category : b.category;
  db.prepare(
    'UPDATE businesses SET name=?, category=?, description=?, location=?, hoursOpen=?, hoursClose=?, whatsapp=?, image=? WHERE id=?'
  ).run(
    name, category,
    cleanStr(req.body.description ?? b.description, 1000),
    cleanStr(req.body.location ?? b.location, 200),
    cleanStr(req.body.hoursOpen ?? b.hoursOpen, 10),
    cleanStr(req.body.hoursClose ?? b.hoursClose, 10),
    cleanStr(req.body.whatsapp ?? b.whatsapp, 40),
    cleanStr(req.body.image ?? b.image, 40),
    b.id
  );
  res.json(businessPublic(db.prepare('SELECT * FROM businesses WHERE id = ?').get(b.id)));
});

// ---------------------------------------------------------------------------
// Promociones
// ---------------------------------------------------------------------------
app.get('/api/promotions', (req, res) => {
  // Vitrina pública: SOLO las publicadas (las programadas no salen hasta su hora).
  const { search = '', category = '' } = req.query;
  let rows = db.prepare('SELECT * FROM promotions ORDER BY createdAt DESC').all()
    .filter((p) => promotionStatus(p) === 'publicada');
  if (category) rows = rows.filter((p) => {
    const b = db.prepare('SELECT category FROM businesses WHERE id = ?').get(p.businessId);
    return b && b.category === category;
  });
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((p) => (p.title + ' ' + p.text).toLowerCase().includes(q));
  }
  res.json(rows.map(promotionPublic));
});

app.post('/api/businesses/:id/promotions', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const title = cleanStr(req.body.title, 140);
  if (!title) return bad(res, 400, 'La promoción necesita un título.');
  const format = req.body.format === 'video' ? 'video' : 'imagen';
  const scheduledAt = req.body.scheduledAt ? String(req.body.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) {
    return bad(res, 400, 'La fecha de programación no es válida.');
  }
  const productId = req.body.productId ? Number(req.body.productId) : null;
  const couponId = req.body.couponId ? Number(req.body.couponId) : null;
  if (productId && !db.prepare('SELECT id FROM products WHERE id = ? AND businessId = ?').get(productId, b.id)) {
    return bad(res, 400, 'Ese producto no pertenece a este negocio.');
  }
  if (couponId && !db.prepare('SELECT id FROM coupons WHERE id = ? AND businessId = ?').get(couponId, b.id)) {
    return bad(res, 400, 'Ese cupón no pertenece a este negocio.');
  }
  const info = db.prepare(
    `INSERT INTO promotions (businessId, title, objective, format, template, music, text, productId, couponId, scheduledAt, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    b.id, title,
    cleanStr(req.body.objective, 300),
    format,
    cleanStr(req.body.template, 40) || 'calida',
    cleanStr(req.body.music, 60),
    cleanStr(req.body.text, 1000),
    productId, couponId, scheduledAt, nowIso()
  );
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(promotionPublic(p));
});

app.get('/api/promotions/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 404, 'Promoción no encontrada.');
  // Ver una promoción cuenta como una visita (solo las publicadas se muestran en la vitrina).
  db.prepare('UPDATE promotions SET views = views + 1 WHERE id = ?').run(p.id);
  const updated = db.prepare('SELECT * FROM promotions WHERE id = ?').get(p.id);
  const reviews = db.prepare('SELECT * FROM reviews WHERE promotionId = ? ORDER BY createdAt DESC').all(p.id);
  res.json({ ...promotionPublic(updated), reviews });
});

app.post('/api/promotions/:id/click', (req, res) => {
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 404, 'Promoción no encontrada.');
  db.prepare('UPDATE promotions SET clicks = clicks + 1 WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

app.post('/api/promotions/:id/contact', (req, res) => {
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 404, 'Promoción no encontrada.');
  db.prepare('UPDATE promotions SET contacts = contacts + 1 WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// Contacto desde el perfil del negocio (sin una promoción concreta):
// se anota en su promoción más reciente; si aún no tiene, no hay nada que contar.
app.post('/api/businesses/:id/contact', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const latest = db.prepare('SELECT id FROM promotions WHERE businessId = ? ORDER BY createdAt DESC LIMIT 1').get(b.id);
  if (latest) db.prepare('UPDATE promotions SET contacts = contacts + 1 WHERE id = ?').run(latest.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Opiniones con estrellas (visibles para todos, promedio recalculado)
// ---------------------------------------------------------------------------
function createReview(req, res, businessId, promotionId) {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return bad(res, 400, 'La puntuación debe ser de 1 a 5 estrellas.');
  }
  const author = cleanStr(req.body.author, 80) || 'Visitante';
  const comment = cleanStr(req.body.comment, 1000);
  const info = db.prepare(
    'INSERT INTO reviews (businessId, promotionId, author, stars, comment, createdAt) VALUES (?,?,?,?,?,?)'
  ).run(businessId, promotionId, author, stars, comment, nowIso());
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
  const stats = businessStats(businessId);
  res.status(201).json({ ...review, businessAvgStars: stats.avgStars, businessReviewCount: stats.reviewCount });
}

app.post('/api/businesses/:id/reviews', (req, res) => createReview(req, res, req.params.id, null));

app.post('/api/promotions/:id/reviews', (req, res) => {
  const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 404, 'Promoción no encontrada.');
  createReview(req, res, p.businessId, p.id);
});

app.get('/api/businesses/:id/reviews', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  res.json(db.prepare('SELECT * FROM reviews WHERE businessId = ? ORDER BY createdAt DESC').all(b.id));
});

// ---------------------------------------------------------------------------
// Catálogo de productos
// ---------------------------------------------------------------------------
app.get('/api/businesses/:id/products', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  res.json(db.prepare('SELECT * FROM products WHERE businessId = ? ORDER BY createdAt DESC').all(b.id));
});

app.post('/api/businesses/:id/products', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const name = cleanStr(req.body.name, 120);
  if (!name) return bad(res, 400, 'El producto necesita un nombre.');
  const price = Number(req.body.price);
  if (Number.isNaN(price) || price < 0) return bad(res, 400, 'El precio no es válido.');
  const info = db.prepare(
    'INSERT INTO products (businessId, name, price, description, image, createdAt) VALUES (?,?,?,?,?,?)'
  ).run(b.id, name, price, cleanStr(req.body.description, 500), cleanStr(req.body.image, 40) || 'naranja', nowIso());
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 404, 'Producto no encontrado.');
  const name = cleanStr(req.body.name, 120) || p.name;
  const price = req.body.price !== undefined ? Number(req.body.price) : p.price;
  if (Number.isNaN(price) || price < 0) return bad(res, 400, 'El precio no es válido.');
  db.prepare('UPDATE products SET name=?, price=?, description=?, image=? WHERE id=?').run(
    name, price,
    cleanStr(req.body.description ?? p.description, 500),
    cleanStr(req.body.image ?? p.image, 40),
    p.id
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(p.id));
});

app.delete('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 404, 'Producto no encontrado.');
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cupones de descuento
// ---------------------------------------------------------------------------
app.get('/api/businesses/:id/coupons', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  res.json(db.prepare('SELECT * FROM coupons WHERE businessId = ? ORDER BY createdAt DESC').all(b.id)
    .map((c) => ({ ...c, status: couponStatus(c) })));
});

app.post('/api/businesses/:id/coupons', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  const code = cleanStr(req.body.code, 40).toUpperCase();
  if (!code) return bad(res, 400, 'El cupón necesita un código.');
  const type = req.body.type === 'cantidad' ? 'cantidad' : 'porcentaje';
  const value = Number(req.body.value);
  if (Number.isNaN(value) || value <= 0) return bad(res, 400, 'El descuento no es válido.');
  if (type === 'porcentaje' && value > 100) return bad(res, 400, 'El porcentaje no puede pasar de 100.');
  const expiresAt = req.body.expiresAt ? String(req.body.expiresAt) : null;
  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
    return bad(res, 400, 'El cupón necesita una fecha de vencimiento válida.');
  }
  const info = db.prepare(
    'INSERT INTO coupons (businessId, code, type, value, expiresAt, createdAt) VALUES (?,?,?,?,?,?)'
  ).run(b.id, code, type, value, expiresAt, nowIso());
  const c = db.prepare('SELECT * FROM coupons WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...c, status: couponStatus(c) });
});

app.put('/api/coupons/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 404, 'Cupón no encontrado.');
  const code = cleanStr(req.body.code, 40).toUpperCase() || c.code;
  const type = req.body.type === 'cantidad' ? 'cantidad' : (req.body.type === 'porcentaje' ? 'porcentaje' : c.type);
  const value = req.body.value !== undefined ? Number(req.body.value) : c.value;
  if (Number.isNaN(value) || value <= 0 || (type === 'porcentaje' && value > 100)) {
    return bad(res, 400, 'El descuento no es válido.');
  }
  const expiresAt = req.body.expiresAt ? String(req.body.expiresAt) : c.expiresAt;
  if (Number.isNaN(new Date(expiresAt).getTime())) return bad(res, 400, 'La fecha de vencimiento no es válida.');
  db.prepare('UPDATE coupons SET code=?, type=?, value=?, expiresAt=? WHERE id=?').run(code, type, value, expiresAt, c.id);
  const updated = db.prepare('SELECT * FROM coupons WHERE id = ?').get(c.id);
  res.json({ ...updated, status: couponStatus(updated) });
});

app.delete('/api/coupons/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 404, 'Cupón no encontrado.');
  db.prepare('DELETE FROM coupons WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Estadísticas del negocio (lenguaje sencillo)
// ---------------------------------------------------------------------------
app.get('/api/businesses/:id/stats', (req, res) => {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.params.id);
  if (!b) return bad(res, 404, 'Negocio no encontrado.');
  res.json({ businessId: b.id, name: b.name, ...businessStats(b.id) });
});

// Cualquier otra ruta devuelve la app (navegación interna).
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return bad(res, 404, 'Ruta no encontrada.');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SmartVisual corriendo en http://localhost:${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
});
