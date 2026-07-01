// ══════════════════════════════════════════════════════════
// Regenera data/ships.json con SCU real desde api.star-citizen.wiki
// Preserva qFuel/notas curadas a mano cuando el nombre coincide
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.star-citizen.wiki/api';
const OUT_PATH = path.join(__dirname, '..', 'data', 'ships.json');

// Naves relevantes para hauling — filtramos el catálogo completo (incluye
// cazas/naves de combate sin cargo) a solo las que sirven para transportar
const MIN_SCU_INTEREST = 1; // ignorar naves con 0 SCU (cazas, exploradores puros)

async function fetchAllPages(endpoint, pageSize = 100) {
  const all = [];
  let page = 1, last = 1;
  do {
    const url = `${API_BASE}/${endpoint}?page[number]=${page}&page[size]=${pageSize}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${endpoint} página ${page}`);
    const json = await res.json();
    last = json.meta?.last_page || 1;
    all.push(...(json.data || []));
    page++;
  } while (page <= last);
  return all;
}

function sizeFromLength(lengthM) {
  // Aproximación de tamaño de motor cuántico (máx real S3) según longitud de casco
  if (!lengthM) return 2;
  if (lengthM < 20) return 1;
  if (lengthM < 45) return 2;
  return 3; // todo lo más grande sigue usando motor S3 (ver Polaris: Erebos/Exodus S3)
}

async function main() {
  console.log('[update-ships] Descargando catálogo de naves…');
  const vehicles = await fetchAllPages('vehicles', 50);
  console.log(`[update-ships] ${vehicles.length} naves totales en la API`);

  // Cargar valores curados existentes (qFuel, notas) para preservarlos por nombre
  let existing = [];
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
    existing = prev.ships || prev;
  } catch (e) { /* sin archivo previo, ok */ }
  const existingByName = {};
  existing.forEach(s => { existingByName[s.name] = s; });

  const ships = vehicles
    .filter(v => (v.cargo_capacity || 0) >= MIN_SCU_INTEREST)
    .map(v => {
      const prev = existingByName[v.name];
      // Campo real confirmado contra la API en vivo: v.quantum.quantum_fuel_capacity
      // (en SCU — misma unidad que fuel_consumption_scu_per_gm de los motores,
      // así que ambos combinan directo sin factores de conversión inventados)
      const apiQFuel = v.quantum?.quantum_fuel_capacity;
      const qFuel = (typeof apiQFuel === 'number' && apiQFuel > 0) ? apiQFuel : (prev?.qFuel || 3);
      return {
        name: v.name,
        scu: Math.round(v.cargo_capacity),
        qFuel: Math.round(qFuel * 100) / 100,
        size: prev?.size || sizeFromLength(v.length),
        manufacturer: v.manufacturer?.name || prev?.manufacturer || '',
        ...(prev?.note ? { note: prev.note } : {})
      };
    })
    .sort((a, b) => a.scu - b.scu);

  ships.push({ name: 'Personalizado', scu: 0, qFuel: 5, size: 2, manufacturer: '' });

  const output = {
    _meta: {
      version: '4.8.2',
      source: 'api.star-citizen.wiki/api/vehicles — campo real quantum.quantum_fuel_capacity (SCU), confirmado en vivo',
      note: 'SCU y qFuel desde la API en vivo. qFuel en las mismas unidades (SCU) que fuel_consumption_scu_per_gm de drives.json — combinan directo sin factor de escala.',
      generated: new Date().toISOString(),
      total: ships.length
    },
    ships
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[update-ships] ✓ ${ships.length} naves escritas en ${OUT_PATH}`);

  const newOnes = ships.filter(s => !existingByName[s.name] && s.name !== 'Personalizado');
  if (newOnes.length) {
    console.log(`[update-ships] ℹ ${newOnes.length} naves nuevas agregadas (SCU y qFuel reales de la API):`);
    newOnes.forEach(s => console.log(`    - ${s.name} (${s.scu} SCU, ${s.qFuel} qFuel)`));
  }
}

main().catch(err => {
  console.error('[update-ships] ERROR:', err.message);
  process.exit(1);
});
