// ══════════════════════════════════════════════════════════
// Extrae reglas REALES de qué commodity produce/consume cada
// ubicación, desde trade_locations.json (dato oficial del juego,
// NO adivinado). Confirmado manualmente: 961 ubicaciones de trading
// reales, cada una con ProducesTags (lo que genera/vendes ahí) y
// ConsumesTags (lo que compra/puedes entregar ahí).
//
// OJO — descubrimiento real durante la investigación: el documento
// que sugirió esto hablaba de una carpeta "shops" que NO EXISTE en
// el repo. El archivo real se llama trade_locations.json (single
// file, no carpeta), con nombres de campo distintos a los que se
// habían adivinado (ProducesTags/ConsumesTags, no "DropPool").
//
// Cobertura real verificada: 141 de nuestras 432 ubicaciones tienen
// coincidencia exacta de nombre en trade_locations.json (33%). El
// resto son sub-terminales dentro de estaciones grandes que no
// tenemos como entrada propia en locations.json — se omiten, no se
// inventa nada para ellas.
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const TRADE_URL = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/trade_locations.json';
const LOCATIONS_PATH = path.join(__dirname, '..', 'data', 'locations.json');
const MATERIALS_PATH = path.join(__dirname, '..', 'data', 'materials.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'trade-rules.json');

// Convierte "AgriculturalSupplies" -> "agriculturalsupplies" y
// "Agricultural Supplies" -> "agriculturalsupplies" para poder cruzar
// el nombre interno del juego (CamelCase) con nuestra lista legible
function norm(s) {
  if (!s) return '';
  const spaced = s.replace(/(?<!^)(?=[A-Z])/g, ' ');
  return spaced.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
  console.log('[update-trade-rules] Descargando trade_locations.json…');
  const res = await fetch(TRADE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const trade = await res.json();

  const materials = JSON.parse(fs.readFileSync(MATERIALS_PATH, 'utf-8')).materials;
  const matByNorm = {};
  materials.forEach(m => { matByNorm[norm(m)] = m; });

  function extractMats(tagSection) {
    const tags = (tagSection?.Positive) || [];
    const names = new Set();
    for (const t of tags) {
      const real = matByNorm[norm(t.Name)];
      if (real) names.add(real);
    }
    return [...names];
  }

  // trade_locations.json puede tener varias entradas con el mismo
  // DisplayName (varios terminales dentro del mismo lugar) — se unen
  const byName = {};
  let activeCount = 0;
  for (const t of trade) {
    if (t.Disabled) continue;
    if (!t.DisplayName) continue;
    activeCount++;
    const produces = extractMats(t.ProducesTags);
    const consumes = extractMats(t.ConsumesTags);
    if (!produces.length && !consumes.length) continue;
    if (!byName[t.DisplayName]) byName[t.DisplayName] = { produces: new Set(), consumes: new Set() };
    produces.forEach(m => byName[t.DisplayName].produces.add(m));
    consumes.forEach(m => byName[t.DisplayName].consumes.add(m));
  }
  console.log(`[update-trade-rules] ${activeCount} ubicaciones de trading activas en el dataset`);

  // Cruzar contra nuestras 432 ubicaciones reales — solo guardamos
  // las que coinciden EXACTO por nombre, nada de fuzzy-matching que
  // pueda inventar una asociación incorrecta
  const ourLocs = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8')).locations;
  const ourNames = new Set(ourLocs.map(l => l.name));

  const rules = {};
  let matched = 0;
  for (const [name, data] of Object.entries(byName)) {
    if (!ourNames.has(name)) continue;
    if (!data.produces.size && !data.consumes.size) continue;
    matched++;
    rules[name] = {
      produces: [...data.produces],
      consumes: [...data.consumes]
    };
  }

  const output = {
    _meta: {
      version: '4.8.2',
      source: 'github.com/StarCitizenWiki/scunpacked-data (trade_locations.json — ProducesTags/ConsumesTags reales)',
      note: 'Solo incluye ubicaciones con coincidencia EXACTA de nombre contra locations.json, y solo materiales que existen en nuestra lista curada (materials.json). No se adivina ninguna asociación.',
      totalActiveInSource: activeCount,
      matchedToOurLocations: matched,
      generated: new Date().toISOString()
    },
    rules
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[update-trade-rules] ✓ ${matched} ubicaciones con reglas de material guardadas en ${OUT_PATH}`);
}

main().catch(err => {
  console.error('[update-trade-rules] ERROR:', err.message);
  process.exit(1);
});
