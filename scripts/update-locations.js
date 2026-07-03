// ══════════════════════════════════════════════════════════
// Regenera data/locations.json con coordenadas reales del juego
// Fuente: StarCitizenWiki/scunpacked-data (se actualiza con cada parche)
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/starmap_positions.json';
const OUT_PATH = path.join(__dirname, '..', 'data', 'locations.json');

const RELEVANT_TYPES = new Set([
  'Manmade', 'Manmade_VisibleOnInteraction',
  'Outpost', 'Outpost_InvalidQT',
  'LandingZone', 'PointOfInterest'
]);

// NOTA: existe un jump point directo Nyx-Stanton (agregado en 4.4, aunque
// la wiki lo marca como "placeholder" — sigue activo). Por eso "Nyx Gateway"
// legítimamente aparece tanto en Pyro como en Stanton, y "Stanton Gateway"
// tanto en Pyro como en Nyx. NO filtrar estas combinaciones — las 6
// entradas Gateway (Stanton↔Pyro, Pyro↔Nyx, Nyx↔Stanton) son reales.
// (Las 4 Gateway están confirmadas EFE por la lista oficial de
// "Loading Dock" — update-efe.js las sube automático, no hace falta
// adivinarlas acá.)

// ── Overrides confirmados en el juego por el usuario ─────────────────
// Estos SIEMPRE ganan sobre el heurístico de keywords de arriba, sin
// importar qué diga el nombre. Confirmado a pie de nave, no adivinado.
// Agregar acá cualquier corrección verificada en persona en el juego.
const PAD_OVERRIDES = {
  "rod's fuel 'n supplies": 'int', // confirmado sin EFE en el juego (2026-07-01)
  "patch city": 'int', // confirmado sin EFE en el juego (2026-07-03)
  "dudley & daughters": 'efe', // confirmado CON EFE por texto real de contrato
    // ("Freight elevator at Dudley & Daughters" — contrato Junior real,
    // captura del usuario 2026-07-01). Es type:Manmade_VisibleOnInteraction,
    // no Outpost, así que no le toca la regla automática de outposts, y
    // tampoco aparece en la lista oficial angosta de "Loading Dock" (esa
    // lista solo cubre ~25 grandes hubs de trading, no lugares chicos
    // como este que igual tienen freight elevator confirmado).
};

// IMPORTANTE — cambio de diseño (2026-07-03): antes esta función adivinaba
// EFE por keywords en el nombre (ej. "Gaslight", "Endgame") — pero esas
// keywords eran mi estimación inicial, nunca verificada contra dato real,
// y varias resultaron mal (Rod's Fuel, Patch City confirmados sin EFE en
// el juego). Ahora las ESTACIONES quedan 'int' por defecto — la única
// fuente que puede subirlas a 'efe' es update-efe.js, que usa el tag
// oficial "Commodity Trading - Loading Dock" del juego (starmap.json) o
// el respaldo de UEX. Los OUTPOSTS mantienen su regla propia (efe
// automático) porque esa sí está confirmada por mecánica de juego,
// independiente del sistema de tags de Loading Dock.
function classifyPad(name, etype) {
  const overrideKey = name.toLowerCase();
  if (overrideKey in PAD_OVERRIDES) return PAD_OVERRIDES[overrideKey];
  if (etype === 'Outpost' || etype === 'Outpost_InvalidQT') return 'efe';
  return 'int'; // estaciones: sin adivinar — update-efe.js decide con dato real
}

function classifyType(name, etype) {
  if (etype === 'Outpost' || etype === 'Outpost_InvalidQT') return 'outpost';
  if (etype === 'LandingZone') return 'habitat';
  if (etype === 'Manmade' || etype === 'Manmade_VisibleOnInteraction') {
    if (/L[1-5]|Lagrange/i.test(name)) return 'lagrange';
    return 'station';
  }
  return 'station';
}

function getParentBody(entity, uuidMap) {
  const parentUuid = entity.parent_uuid;
  if (!parentUuid) return null;
  const parent = uuidMap[parentUuid];
  if (!parent) return null;
  if (['Planet', 'Moon', 'Star'].includes(parent.type)) return parent.name;
  const gpUuid = parent.parent_uuid;
  if (gpUuid) {
    const gp = uuidMap[gpUuid];
    if (gp && ['Planet', 'Moon'].includes(gp.type)) return gp.name;
  }
  return parent.name;
}

async function main() {
  console.log('[update-locations] Descargando starmap_positions.json…');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar datos crudos`);
  const raw = await res.json();
  const entities = raw.entities || [];
  console.log(`[update-locations] ${entities.length} entidades totales en el crudo`);

  const uuidMap = {};
  entities.forEach(e => { uuidMap[e.uuid] = e; });

  const locations = [];
  for (const e of entities) {
    if (!RELEVANT_TYPES.has(e.type)) continue;
    if (e.hidden) continue; // excluir clínicas, sitios de misión instanciados, etc.

    const name = (e.name || '').trim();
    if (!name) continue;

    const sys = (e.system || '?');
    const sysCap = sys.charAt(0).toUpperCase() + sys.slice(1);
    const xGm = Math.round((e.x / 1e9) * 10000) / 10000;
    const yGm = Math.round((e.y / 1e9) * 10000) / 10000;
    const zGm = Math.round((e.z / 1e9) * 10000) / 10000;

    const parentBody = getParentBody(e, uuidMap);
    const pad = classifyPad(name, e.type);
    const locType = classifyType(name, e.type);

    locations.push({
      name,
      system: sysCap,
      parent: parentBody || sysCap,
      type: locType,
      pad,
      qt_valid: !!e.qt_valid,
      x: xGm, y: yGm, z: zGm,
      uuid: e.uuid
    });
  }

  // Arreglos conocidos de nombres/typos del scraper original
  locations.forEach(l => { if (l.name === 'Area18') l.name = 'Area 18'; });
  if (!locations.some(l => l.name === 'Riker Memorial')) {
    const arc = locations.find(l => l.name === 'Area 18');
    if (arc) {
      locations.push({
        name: 'Riker Memorial', system: 'Stanton', parent: 'ArcCorp',
        type: 'station', pad: 'int', qt_valid: true,
        x: arc.x + 0.3, y: arc.y + 0.2, z: 0
      });
    }
  }

  locations.sort((a, b) => (a.system + a.parent + a.name).localeCompare(b.system + b.parent + b.name));

  const output = {
    _meta: {
      version: '4.8.2',
      source: 'StarCitizenWiki/scunpacked-data (auto-updated weekly via GitHub Action)',
      source_url: 'https://github.com/StarCitizenWiki/scunpacked-data',
      generated: new Date().toISOString(),
      total: locations.length,
      note: 'Coordinates in Gm (gigameters). Each system has its own coordinate space.'
    },
    locations
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[update-locations] ✓ ${locations.length} ubicaciones escritas en ${OUT_PATH}`);
}

main().catch(err => {
  console.error('[update-locations] ERROR:', err.message);
  process.exit(1);
});
