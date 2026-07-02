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

const UEX_BASE = 'https://api.uexcorp.uk/2.0';
const STARMAP_URL = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/refs/heads/master/starmap.json';
const LOCATIONS_PATH = path.join(__dirname, '..', 'data', 'locations.json');

// ── Overrides confirmados en el juego — SIEMPRE ganan, incluso sobre
// las fuentes automáticas. Debe mantenerse igual a la lista en
// update-locations.js. ────────────────────────────────────────────
const PAD_OVERRIDES = {
  "rod's fuel 'n supplies": 'int', // confirmado sin EFE en el juego (2026-07-01)
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

async function fetchUexPositive() {
  console.log('[update-efe] Descargando terminales de UEX (respaldo, menor prioridad)…');
  const res = await fetch(`${UEX_BASE}/terminals`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en /terminals`);
  const json = await res.json();
  if (json.status !== 'ok') throw new Error(`UEX status: ${json.status}`);
  const confirmed = new Set();
  for (const t of (json.data || [])) {
    if (t.has_freight_elevator !== 1) continue;
    const candidates = [t.space_station_name, t.outpost_name, t.city_name, t.displayname].filter(Boolean);
    for (const name of candidates) confirmed.add(normName(name));
  }
  console.log(`[update-efe] ${confirmed.size} ubicaciones con freight elevator reportado en UEX (puede incluir interiores)`);
  return confirmed;
}

async function main() {
  let official = new Set(), uex = new Set();
  try { official = await fetchOfficialLoadingDocks(); }
  catch (e) { console.warn('[update-efe] ⚠ No se pudo leer starmap.json:', e.message); }
  try { uex = await fetchUexPositive(); }
  catch (e) { console.warn('[update-efe] ⚠ No se pudo leer UEX:', e.message); }

  if (!official.size && !uex.size) {
    console.log('[update-efe] Ninguna fuente disponible — no se toca locations.json');
    return;
  }

  const data = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8'));
  let updated = 0;

  for (const loc of data.locations) {
    const overrideKey = loc.name.toLowerCase();
    if (overrideKey in PAD_OVERRIDES) continue; // confirmado en el juego, no tocar
    if (loc.pad === 'efe') continue; // ya está bien, no hace falta tocar

    const key = normName(loc.name);
    // Prioridad: dato oficial del juego primero (más preciso, distingue
    // exterior de interior); UEX solo si el oficial no dice nada de este lugar
    const confirmedByOfficial = official.has(key);
    const confirmedByUex = !confirmedByOfficial && uex.has(key);

    if (confirmedByOfficial || confirmedByUex) {
      console.log(`  ${loc.name}: ${loc.pad} → efe (confirmado ${confirmedByOfficial ? 'oficial' : 'UEX, respaldo'})`);
      loc.pad = 'efe';
      updated++;
    }
    // NUNCA se reclasifica a 'int' por ausencia — solo confirmación positiva
  }

  data._meta.efe_sources = 'scunpacked-data starmap.json "Loading Dock" oficial (prioridad alta, distingue exterior/interior) + api.uexcorp.uk/2.0/terminals (respaldo de menor prioridad) — solo confirmación positiva, nunca marca int por ausencia';
  data._meta.efe_updated_at = new Date().toISOString();

  fs.writeFileSync(LOCATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n[update-efe] ✓ ${updated} ubicaciones confirmadas como EFE con datos reales`);
}

main().catch(err => {
  console.error('[update-efe] ERROR:', err.message);
  process.exit(1);
});
