// ══════════════════════════════════════════════════════════
// Regenera data/materials.json desde api.star-citizen.wiki
// Antes era una lista hardcodeada a mano — ahora viene de la API real
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.star-citizen.wiki/api';
const OUT_PATH = path.join(__dirname, '..', 'data', 'materials.json');

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

async function main() {
  console.log('[update-materials] Descargando catálogo de commodities…');
  const commodities = await fetchAllPages('commodities', 100);
  console.log(`[update-materials] ${commodities.length} commodities en la API`);

  const names = [...new Set(commodities.map(c => c.name).filter(Boolean))].sort();
  const materials = ['— Select commodity —', ...names];

  const output = {
    _meta: {
      version: '4.8.2',
      source: 'api.star-citizen.wiki/api/commodities — auto-updated weekly via GitHub Action',
      generated: new Date().toISOString(),
      total: materials.length
    },
    materials
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[update-materials] ✓ ${materials.length} commodities escritas en ${OUT_PATH}`);
}

main().catch(err => {
  console.error('[update-materials] ERROR:', err.message);
  process.exit(1);
});
