# Actualización automática de datos

Este repo tiene un **GitHub Action** que actualiza `data/locations.json`,
`data/ships.json` y `data/drives.json` automáticamente **cada lunes a las
06:00 UTC**, sin que tengas que hacer nada.

## Cómo activarlo (una sola vez)

1. Sube estos archivos a tu repo, respetando la carpeta:
   ```
   tu-repo/
   ├── .github/
   │   └── workflows/
   │       └── update-data.yml
   ├── scripts/
   │   ├── update-locations.js
   │   ├── update-ships.js
   │   └── update-drives.js
   ├── index.html
   └── data/
       ├── ships.json
       ├── drives.json
       ├── materials.json
       └── factions.json
   ```

2. En GitHub, entra a **Settings → Actions → General**, baja hasta
   "Workflow permissions" y selecciona **"Read and write permissions"**.
   Guarda. (Sin esto el Action no puede commitear los cambios.)

3. Listo. El Action ya corre automático cada semana.

## Cómo forzarlo manualmente

Entra a la pestaña **"Actions"** de tu repo → click en **"Update game
data"** en la lista de la izquierda → botón **"Run workflow"**.

## Qué hace cada script

- **`update-locations.js`** — descarga `starmap_positions.json` desde
  `StarCitizenWiki/scunpacked-data` (se actualiza con cada parche del
  juego) y regenera las 432 ubicaciones con coordenadas reales.
  **100% confiable**, mismos datos que usa la wiki.

- **`update-ships.js`** — descarga el catálogo de naves desde
  `api.star-citizen.wiki` y actualiza el SCU real de cada una.
  Preserva el `qFuel` y `size` (tamaño de motor) que ya tenías curados
  a mano; solo naves nuevas reciben un placeholder que queda marcado
  en la consola del Action para que lo revises.

- **`update-drives.js`** — igual que naves pero para motores cuánticos.
  **Importante:** la API pública no siempre trae velocidad/consumo
  limpios, así que el script nunca inventa un número — si un motor no
  tiene dato confiable, se omite y queda listado en
  `_meta.needs_manual_review` dentro del JSON para que lo completes
  a mano si quieres.

## Si algo sale mal

El Action no rompe nada si una fuente falla — cada script tiene su
propio `catch` y termina con `process.exit(1)` sin tocar los demás
archivos. Revisa la pestaña "Actions" → el run que falló → los logs
te dicen exactamente qué paso falló y por qué.
