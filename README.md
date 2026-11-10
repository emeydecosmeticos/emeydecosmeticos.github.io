# Catálogo eme y de

Sitio: https://emeydecosmeticos.github.io/

Página estática, sin compilación. GitHub Pages publica la rama `main` tal cual.

## Cambiar productos

Todo está en `products.json`:

- `tienda.whatsapp`: número con código de país, solo dígitos (ej. `5215512345678`). Vacío = WhatsApp pide elegir contacto.
- `tienda.ejemplo`: ponlo en `false` para quitar el aviso de "productos de ejemplo".
- `categorias`: las pestañas de arriba.
- `productos`: cada uno con `id`, `nombre`, `categoria`, `precio`, `descripcion`, y opcionalmente `tonos`, `imagen` y `"agotado": true`.

## Fotos

Guárdalas en `images/` (800x1000 px, menos de 150 KB) y escribe la ruta en `"imagen"`, por ejemplo `"images/labial-mate.jpg"`. Un tono también puede llevar su propia `"imagen"`.

## Probar en tu computadora

    python3 -m http.server 4173

y abre http://localhost:4173
