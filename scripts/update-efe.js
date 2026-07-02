// ══════════════════════════════════════════════════════════
// Actualiza el campo "pad" (efe/int) de data/locations.json usando
// datos REALES reportados por la comunidad — no adivinados por keywords.
//
// Fuente: api.uexcorp.uk/2.0/terminals — campo has_freight_elevator
// Es dato crowdsourced (jugadores reportan lo que ven en el juego),
// mucho más confiable que cualquier heurística basada en nombres.
//
// Estrategia: agrupamos todos los terminales de UEX por ubicación física
// (space_station_name / outpost_name / city_name / displayname) y si
// CUALQUIER terminal en esa ubicación reporta has_freight_elevator=1,
// marcamos esa ubicación como 'efe'. Cruzamos por nombre normalizado
// contra nuestras 432 ubicaciones existentes.
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const UEX_BASE = 'https://api.uexcorp.uk/2.0';
const LOCATIONS_PATH = path.join(__dirname, '..', 'data', 'locations.json');

// ── Overrides confirmados en el juego — SIEMPRE ganan, incluso sobre
// UEX. Debe mantenerse igual a la lista en update-locations.js. ─────
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

async function fetchAllTerminals() {
  const url = `${UEX_BASE}/terminals`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en /terminals`);
  const json = await res.json();
  if (json.status !== 'ok') throw new Error(`UEX status: ${json.status}`);
  return json.data || [];
}

async function main() {
  console.log('[update-efe] Descargando terminales reales de UEX…');
  const terminals = await fetchAllTerminals();
  console.log(`[update-efe] ${terminals.length} terminales recibidos`);

  // Agrupar por ubicación física — un lugar puede tener varios terminales
  // (tienda de comodities, tienda de items, etc.), basta con que UNO
  // reporte el elevador para marcar todo el lugar como efe.
  const efeByLocation = {}; // normName -> true/false
  for (const t of terminals) {
    const candidates = [t.space_station_name, t.outpost_name, t.city_name, t.displayname]
      .filter(Boolean);
    for (const name of candidates) {
      const key = normName(name);
      if (!key) continue;
      if (t.has_freight_elevator === 1) efeByLocation[key] = true;
      else if (!(key in efeByLocation)) efeByLocation[key] = false;
    }
  }
  console.log(`[update-efe] ${Object.keys(efeByLocation).length} ubicaciones únicas con dato de terminal`);

  const data = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8'));
  let updated = 0, matched = 0, unmatched = [];

  for (const loc of data.locations) {
    const overrideKey = loc.name.toLowerCase();
    if (overrideKey in PAD_OVERRIDES) continue; // confirmado en el juego, no tocar

    const key = normName(loc.name);
    if (key in efeByLocation) {
      matched++;
      const newPad = efeByLocation[key] ? 'efe' : 'int';
      if (loc.pad !== newPad) {
        console.log(`  ${loc.name}: ${loc.pad} → ${newPad} (confirmado UEX)`);
        loc.pad = newPad;
        updated++;
      }
    } else {
      unmatched.push(loc.name);
    }
  }

  data._meta.efe_source = 'api.uexcorp.uk/2.0/terminals (has_freight_elevator) — dato real reportado por la comunidad';
  data._meta.efe_matched = matched;
  data._meta.efe_unmatched = unmatched.length;
  data._meta.efe_updated_at = new Date().toISOString();

  fs.writeFileSync(LOCATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n[update-efe] ✓ ${matched}/${data.locations.length} ubicaciones cruzadas con UEX`);
  console.log(`[update-efe] ✓ ${updated} cambiaron de clasificación`);
  console.log(`[update-efe] ⚠ ${unmatched.length} sin dato de terminal — mantienen su clasificación heurística previa`);
}

main().catch(err => {
  console.error('[update-efe] ERROR:', err.message);
  process.exit(1);
});
