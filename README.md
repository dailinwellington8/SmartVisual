# SmartVisual — aplicación web completa

**SmartVisual — Tu promoción lista en 1 minuto.**

Dailin crea promociones de negocios. Cualquier persona en internet entra a la
página, ve las promociones y deja su puntuación con estrellas (1–5) con
comentario. **Todos los visitantes ven esas votaciones y el promedio**, para
saber qué tan bueno y confiable es cada negocio. Es a la vez creadora de
promociones y escaparate público con reputación visible.

## Arranque en local

```bash
cd app-completa
npm install
npm start
```

Abre **http://localhost:3000**. La app empieza **vacía** (0 negocios, 0
promociones, 0 opiniones): el primer paso es crear un negocio desde la
interfaz ("Agregar un negocio") y luego su promoción con el asistente.

Requisito: **Node.js 22.5 o superior** (usa `node:sqlite`, que viene
integrado en Node; no necesita compilar nada nativo).

El puerto se cambia con la variable `PORT` (por ejemplo `PORT=8080 npm start`).
La base de datos se guarda en `data/smartvisual.db` (se crea sola al arrancar);
se puede cambiar con `DB_PATH`.

## Funciones

1. **Vitrina pública** por categorías (Servicios / Productos / Otras APK) +
   buscador. Solo muestra las promociones ya publicadas.
2. **Perfil público del negocio**: ubicación, horario con indicador
   abierto/cerrado, botón de WhatsApp, promedio de estrellas calculado de las
   opiniones guardadas.
3. **Asistente "crear promoción en 1 minuto"** (5 pasos: objetivo, plantilla
   imagen/video, música, datos, textos sugeridos editables — mitad y mitad:
   SmartVisual sugiere y el usuario edita).
4. **Opiniones con estrellas 1–5 con comentario**, visibles para todos; el
   promedio se recalcula con cada opinión nueva.
5. **Programar la publicación**: "Publicar ahora" o "Programar" con fecha y
   hora. Las programadas no salen en la vitrina hasta su hora y se listan con
   su estado (programada / publicada).
6. **Catálogo de productos por negocio**: crear/editar/eliminar productos
   (nombre, precio, descripción, foto de ejemplo); visible en el perfil y
   elegible al crear una promoción.
7. **Cupones de descuento por negocio**: código, porcentaje o cantidad fija,
   fecha de vencimiento, estado activo/vencido; visibles en el perfil y en
   las promociones.
8. **Panel de resultados en lenguaje sencillo** (visitas, clics, contactos,
   opiniones y promedio) en el perfil de cada negocio.
9. **Biblioteca musical** original de SmartVisual (4 pistas, incluidas en
   `public/assets/musica/`; la favorita es "Relajante — Calma", dulce y suave).

## Estructura de archivos

```
app-completa/
├── server.js            # Backend: Express + SQLite (un solo proceso)
├── package.json         # Dependencias (solo express) y script "start"
├── README.md            # Este archivo
├── data/
│   └── smartvisual.db   # Base de datos SQLite (se crea al arrancar; no borrar)
└── public/              # Frontend (una sola página, sin frameworks)
    ├── index.html
    ├── style.css
    ├── app.js
    └── assets/
        ├── logo.webp    # Logotipo oficial: ojo con estrella dorada (SMARTVISUAL)
        └── musica/      # 4 pistas originales (mp3)
```

## Estructura de la base de datos (SQLite)

| Tabla | Campos principales |
|---|---|
| `businesses` | id, name, category (Servicios/Productos/Otras APK), description, location, hoursOpen, hoursClose, whatsapp, image, createdAt |
| `promotions` | id, businessId, title, objective, format (imagen/video), template, music, text, productId, couponId, scheduledAt (null = ahora), createdAt, views, clicks, contacts |
| `reviews` | id, businessId, promotionId (puede ser null), author, stars (1–5), comment, createdAt |
| `products` | id, businessId, name, price, description, image, createdAt |
| `coupons` | id, businessId, code, type (porcentaje/cantidad), value, expiresAt, createdAt |

Reglas que calcula el servidor (no el navegador):

- **Estado de una promoción**: `programada` si `scheduledAt` es una fecha
  futura; `publicada` en cualquier otro caso. La vitrina (`GET /api/promotions`)
  solo devuelve las publicadas.
- **Promedio de estrellas** de un negocio: media de todas sus opiniones
  guardadas (redondeada a 1 decimal).
- **Estado de un cupón**: `vencido` si `expiresAt` ya pasó; `activo` si no.
- **Estadísticas**: las visitas se cuentan al abrir una promoción; los clics y
  los contactos de WhatsApp se suman cuando el visitante los usa.

Principales rutas de la API (todas devuelven JSON):

- `GET /api/businesses` · `POST /api/businesses` · `GET /api/businesses/:id`
- `GET /api/promotions` (solo publicadas) · `POST /api/businesses/:id/promotions`
- `GET /api/promotions/:id` · `POST /api/promotions/:id/reviews`
- `POST /api/businesses/:id/reviews` · `GET /api/businesses/:id/reviews`
- `GET/POST /api/businesses/:id/products` · `PUT/DELETE /api/products/:id`
- `GET/POST /api/businesses/:id/coupons` · `PUT/DELETE /api/coupons/:id`
- `GET /api/businesses/:id/stats` · `GET /api/music` · `GET /api/health`

## Cómo publicarla (hosting)

La app tiene **backend con base de datos**, así que no sirve un alojamiento
solo de páginas estáticas (como GitHub Pages): necesita un servicio que
ejecute Node.js. Cualquier servicio de hosting con Node.js sirve (por ejemplo
Render, Railway, Fly.io o un servidor VPS propio). No hace falta comprar ni
tener un servidor propio: se usa el del servicio de alojamiento.

**Qué subir:** toda la carpeta `app-completa` tal cual está, **incluyendo**
`data/` (aunque esté vacía al principio: ahí se creará la base de datos).
No hace falta subir nada más.

**Pasos generales en el servicio elegido:**

1. Sube la carpeta (o conecta el repositorio si el servicio lo pide).
2. El servicio ejecuta `npm install` y luego `npm start` (comando de inicio:
   `node server.js`).
3. El servicio asigna el puerto con la variable `PORT`; la app ya la respeta.
   No hay que configurar nada más.
4. Te dará una dirección web (por ejemplo `https://smartvisual.onrender.com`):
   esa es la página pública que cualquiera puede abrir.

**Datos:** la base de datos es un solo archivo (`data/smartvisual.db`) que
vive junto a la app en el servidor. Haz una copia de ese archivo de vez en
cuando como respaldo (descargarlo del servicio o copiarlo). Si el servicio
borra los archivos al reiniciar, conviene usar su opción de "disco
persistente" o hacer respaldos del archivo con frecuencia.

**Límites de esta versión:** no hay cuentas ni contraseñas: cualquier
visitante puede crear negocios, promociones y opiniones (eso es justo lo que
se buscaba para el escaparate público). Si más adelante se quiere que solo
Dailin pueda crear negocios y promociones, habrá que añadir un inicio de
sesión para ella.
