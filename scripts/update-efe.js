// ══════════════════════════════════════════════════════════
// Actualiza el campo "pad" (efe/int) de data/locations.json usando
// dato oficial de los archivos del juego como fuente principal.
//
// IMPORTANTE — hallazgo clave: el juego usa DOS tags distintos de
// Amenities que parecen iguales pero no lo son:
//   - "Commodity Trading - Freight Elevator" (genérico, ~225 lugares)
//     Solo confirma que existe ALGÚN elevador de carga — puede ser
//     interior (requiere pedir hangar) o exterior.
//   - "Commodity Trading - Loading Dock" (específico, ~25 lugares)
//     Confirma que el elevador es EXTERIOR — sin pedir hangar. Es un
//     sub-conjunto del anterior (todo Loading Dock implica Freight
//     Elevator, pero no al revés).
// Verificado: Everus Harbor (EFE confirmado) tiene AMBOS tags.
// Lorville/Area18/New Babbage/Orison (sin EFE) solo tienen el genérico.
// Por eso usamos SOLO "Loading Dock" como señal — el genérico no sirve
// para distinguir exterior de interior.
//
// UEX (has_freight_elevator) se mantiene como respaldo de baja prioridad,
// pero puede estar sobre-marcando lugares con elevador interior como si
// fueran EFE — el dato oficial del juego siempre gana si hay conflicto.
//
// Fuente 1 (prioridad alta): scunpacked-data/starmap.json
// Fuente 2 (respaldo, prioridad baja): api.uexcorp.uk/2.0/terminals
// Ambas se usan SOLO como confirmación positiva — nunca se reclasifica
// a 'int' por ausencia de dato, para evitar falsos negativos.
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const STARMAP_URL = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/refs/heads/master/starmap.json';
const LOCATIONS_PATH = path.join(__dirname, '..', 'data', 'locations.json');

// ── Overrides confirmados en el juego — SIEMPRE ganan, incluso sobre
// las fuentes automáticas. Debe mantenerse igual a la lista en
// update-locations.js. ────────────────────────────────────────────
const PAD_OVERRIDES = {
  "rod's fuel 'n supplies": 'int', // confirmado sin EFE en el juego (2026-07-01)
  "patch city": 'int', // confirmado sin EFE en el juego (2026-07-03)
  "dudley & daughters": 'efe', // confirmado CON EFE por texto real de contrato (ver update-locations.js)
};

function normName(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/^(admin|tdd - trade and development division|microtech planetary services|orison municipal services)\s*-\s*/i, '')
    .replace(/\s*-\s*(commons|providence platform|cloudview center|metro center).*$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

async function fetchOfficialLoadingDocks() {
  console.log('[update-efe] Descargando starmap.json (dato oficial del juego)…');
  const res = await fetch(STARMAP_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} en starmap.json`);
  const entities = await res.json();
  const confirmed = new Set();
  for (const e of entities) {
    const amenities = e.Amenities || [];
    // OJO: buscamos el tag ESPECÍFICO "Loading Dock", NO el genérico
    // "Freight Elevator" — ver nota arriba sobre la diferencia.
    const hasDock = amenities.some(a => a && /commodity trading - loading dock/i.test(a.Name || ''));
    if (hasDock) confirmed.add(normName(e.Name));
  }
  console.log(`[update-efe] ${confirmed.size} ubicaciones con "Loading Dock" (exterior) oficial confirmado`);
  return confirmed;
}


async function main() {
  let official = new Set();
  try { official = await fetchOfficialLoadingDocks(); }
  catch (e) { console.warn('[update-efe] ⚠ No se pudo leer starmap.json:', e.message); }

  if (!official.size) {
    console.log('[update-efe] Fuente oficial no disponible — no se toca locations.json (evita corromper datos buenos)');
    return;
  }

  const data = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8'));
  let toEfe = 0, toInt = 0;

  for (const loc of data.locations) {
    const overrideKey = loc.name.toLowerCase();
    if (overrideKey in PAD_OVERRIDES) {
      // Override manual confirmado en el juego — respetar, no tocar
      loc.pad = PAD_OVERRIDES[overrideKey];
      continue;
    }
    // Los OUTPOSTS mantienen su lógica propia (regla de juego: outpost = efe
    // automático, definido en update-locations.js). No los tocamos acá.
    if (loc.type === 'outpost') continue;

    const key = normName(loc.name);
    // La lista oficial "Loading Dock" es AUTORITATIVA para estaciones:
    // distingue freight elevator EXTERNO (Loading Dock) del INTERNO
    // (solo "Freight Elevator" genérico, dentro del hangar). Si una
    // estación NO está en Loading Dock, su elevator es interno → 'int'.
    // Esto CORRIGE errores viejos (antes una fuente imprecisa marcaba
    // EFE de más y nunca se revertía).
    const shouldBeEfe = official.has(key);
    const newPad = shouldBeEfe ? 'efe' : 'int';
    if (loc.pad !== newPad) {
      console.log(`  ${loc.name}: ${loc.pad} → ${newPad} (${shouldBeEfe ? 'Loading Dock oficial' : 'solo elevator interno / sin dock externo'})`);
      loc.pad = newPad;
      if (newPad === 'efe') toEfe++; else toInt++;
    }
  }

  data._meta.efe_sources = 'scunpacked-data starmap.json "Loading Dock" (AUTORITATIVO para estaciones — distingue freight elevator exterior del interior). Outposts mantienen efe automático. UEX ya NO se usa: marcaba EFE de más sin distinguir interior/exterior.';
  data._meta.efe_updated_at = new Date().toISOString();

  fs.writeFileSync(LOCATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n[update-efe] ✓ Estaciones reclasificadas: ${toEfe} → efe, ${toInt} → int (corregidas)`);
}

main().catch(err => {
  console.error('[update-efe] ERROR:', err.message);
  process.exit(1);
});
