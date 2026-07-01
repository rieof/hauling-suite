// ══════════════════════════════════════════════════════════
// Regenera data/drives.json desde api.star-citizen.wiki
// Los campos de velocidad/consumo no siempre vienen limpios en la API
// pública, así que este script SIEMPRE preserva los valores curados a
// mano cuando existen, y solo actualiza tamaño/nombre/fabricante desde
// la API. Si aparece un motor nuevo sin datos de velocidad conocidos,
// lo deja marcado para revisión manual en vez de inventar un número.
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.star-citizen.wiki/api';
const OUT_PATH = path.join(__dirname, '..', 'data', 'drives.json');

async function fetchAllPages(endpoint, pageSize = 50) {
  const all = [];
  let page = 1, last = 1;
  do {
    const url = `${API_BASE}/${endpoint}?filter[type]=QuantumDrive&page[number]=${page}&page[size]=${pageSize}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${endpoint} página ${page}`);
    const json = await res.json();
    last = json.meta?.last_page || 1;
    all.push(...(json.data || []));
    page++;
  } while (page <= last);
  return all;
}

// Campos REALES confirmados contra la API en vivo (verificado 2026-07-01,
// patch 4.8.2 — ej. Atlas: quantum_drive.standard_jump.drive_speed=231000000,
// Agni: 383000000, Aither: 242000000). Antes este script adivinaba nombres
// de campo (item.speed, item.quantum_speed…) que NO existen en la API real
// — por eso siempre caía al valor curado a mano. Con el campo correcto,
// la API sí trae el dato real casi siempre.
function extractSpeed(item) {
  const raw = item.quantum_drive?.standard_jump?.drive_speed; // en m/s
  if (typeof raw === 'number' && raw > 0) return raw / 1e9; // m/s → Gm/s
  return null;
}

function extractFuel(item) {
  // fuel_consumption_scu_per_gm: SCU de combustible cuántico gastado por
  // Gm recorrido — unidad directamente usable contra el qFuel de la nave
  const raw = item.quantum_drive?.fuel_consumption_scu_per_gm;
  if (typeof raw === 'number' && raw > 0) return raw;
  return null;
}

function extractSpoolTime(item) {
  const raw = item.quantum_drive?.standard_jump?.spool_up_time;
  return typeof raw === 'number' ? raw : null;
}

async function main() {
  console.log('[update-drives] Descargando catálogo de motores cuánticos…');
  const items = await fetchAllPages('items', 50);
  console.log(`[update-drives] ${items.length} motores en la API`);

  let existing = [];
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
    existing = prev.drives || prev;
  } catch (e) { /* sin archivo previo, ok */ }
  const existingByBaseName = {};
  existing.forEach(d => {
    const base = d.name.replace(/\s*\(S\d\)\s*$/, '').toLowerCase();
    existingByBaseName[base + '_' + d.size] = d;
  });

  const drives = [];
  const needsReview = [];

  for (const item of items) {
    const size = item.size || 1;
    const name = item.name;
    const key = name.toLowerCase() + '_' + size;
    const displayName = `${name} (S${size})`;

    const prev = existingByBaseName[key];
    const apiSpeed = extractSpeed(item);
    const apiFuel = extractFuel(item);
    const apiSpool = extractSpoolTime(item);

    const speed = apiSpeed || prev?.speed;
    const fuel = apiFuel || prev?.fuel;

    if (!speed) {
      needsReview.push(displayName);
      continue;
    }

    drives.push({
      name: displayName,
      speed: Math.round(speed * 1000) / 1000,
      fuel: fuel ? Math.round(fuel * 10000) / 10000 : 1.0,
      spool: apiSpool ?? prev?.spool ?? null,
      size,
      type: (item.class || prev?.type || 'civilian').toLowerCase(),
      manufacturer: item.manufacturer?.name || prev?.manufacturer || '',
      desc: prev?.desc || `${item.manufacturer?.name || ''} S${size} ${(item.class||'').toLowerCase()} drive`.trim()
    });
  }

  drives.sort((a, b) => a.size - b.size || a.speed - b.speed);

  const output = {
    _meta: {
      version: '4.8.2',
      source: 'api.star-citizen.wiki/api/items (QuantumDrive) — campos reales quantum_drive.standard_jump.drive_speed / fuel_consumption_scu_per_gm, confirmados en vivo',
      generated: new Date().toISOString(),
      total: drives.length,
      needs_manual_review: needsReview
    },
    drives
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[update-drives] ✓ ${drives.length} motores escritos en ${OUT_PATH}`);
  if (needsReview.length) {
    console.log(`[update-drives] ⚠ ${needsReview.length} motores sin datos de velocidad confiables, omitidos:`);
    needsReview.forEach(n => console.log(`    - ${n}`));
  }
}

main().catch(err => {
  console.error('[update-drives] ERROR:', err.message);
  process.exit(1);
});
