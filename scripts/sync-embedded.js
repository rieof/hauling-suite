#!/usr/bin/env node
/**
 * sync-embedded.js
 *
 * Regenera los bloques de datos EMBEBIDOS dentro de index.html a partir
 * de los archivos data/*.json. Sin esto, el index.html tiene copias
 * "congeladas" de los datos (el respaldo/fallback que hace que la app
 * arranque al instante) que se desincronizan de los JSON cada vez que el
 * workflow los actualiza — que fue exactamente el bug del EFE: el JSON
 * decía 'int' pero el embebido seguía en 'efe' viejo.
 *
 * Se corre como último paso del workflow, después de que todos los otros
 * scripts actualizaron los data/*.json. Reemplaza SOLO el contenido entre
 * los marcadores // --- AUTOGEN X START/END ---, sin tocar el resto del
 * HTML ni el código.
 *
 * Bloques que sincroniza:
 *   - LOCS   (const DATA = ...)            <- data/locations.json
 *   - SHIPS  (let SHIPS = ...)             <- data/ships.json
 *            (const QUANTUM_DRIVES = ...)  <- data/drives.json  (va dentro de SHIPS)
 *   - MATS   (let MATERIALS = ...)         <- data/materials.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'));
}

// Reemplaza el contenido entre dos marcadores, conservando los marcadores
function replaceBlock(html, startMarker, endMarker, newInner) {
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`No se encontraron los marcadores: ${startMarker} / ${endMarker}`);
  }
  const before = html.slice(0, startIdx + startMarker.length);
  const after = html.slice(endIdx);
  return before + '\n' + newInner + '\n' + after;
}

// ── Generar el bloque LOCS (const DATA) desde locations.json ──────────
// Formato de destino: DATA[sistema][planeta] = {locs:[{label,x,y,z,type,pad}]}
function genLocsBlock(locations) {
  // Agrupar por sistema → planeta.
  // OJO: en data/locations.json los campos son "system", "parent" y "name"
  // (NO "sys"/"planet"/"label"). Usar los nombres equivocados manda todas
  // las ubicaciones a un sistema falso "Unknown" y rompe la detección de
  // sistemas (saltos interestelares, filtro de mismo sistema del modo 25%).
  const bySys = {};
  for (const l of locations.locations) {
    const sys = l.system || 'Unknown';
    const planet = l.parent || 'Other';
    (bySys[sys] = bySys[sys] || {});
    (bySys[sys][planet] = bySys[sys][planet] || []);
    bySys[sys][planet].push(l);
  }
  let out = 'const DATA={\n';
  const sysNames = Object.keys(bySys);
  sysNames.forEach((sys, si) => {
    out += `  ${JSON.stringify(sys)}:{\n`;
    const planets = Object.keys(bySys[sys]);
    planets.forEach((planet, pi) => {
      out += `    ${JSON.stringify(planet)}:{locs:[\n`;
      bySys[sys][planet].forEach(l => {
        // pad se escribe con comillas simples para replicar el formato original
        const x = l.x != null ? l.x : 0;
        const y = l.y != null ? l.y : 0;
        const z = l.z != null ? l.z : 0;
        out += `    {label:${JSON.stringify(l.label || l.name)},x:${x},y:${y},z:${z},type:${JSON.stringify(l.type || 'station')},pad:'${l.pad || 'int'}'},\n`;
      });
      out += `    ]}${pi < planets.length - 1 ? ',' : ''}\n`;
    });
    out += `  }${si < sysNames.length - 1 ? ',' : ''}\n`;
  });
  out += '};';
  return out;
}

// ── Generar el bloque SHIPS (incluye QUANTUM_DRIVES dentro) ───────────
function genShipsBlock(ships, drives) {
  let out = 'let SHIPS=[\n';
  ships.ships.forEach(s => {
    const scu = s.scu != null ? s.scu : 0;
    const qFuel = s.qFuel != null ? s.qFuel : (s.quantum_fuel != null ? s.quantum_fuel : 0);
    const size = s.size != null ? s.size : 1;
    out += `  {name:${JSON.stringify(s.name)}, scu:${scu}, qFuel:${qFuel}, size:${size}},\n`;
  });
  out += '];\n';

  // Cerrar comentario de ships y abrir el objeto de drives, replicando el
  // layout original donde QUANTUM_DRIVES vive dentro del bloque SHIPS
  out += 'const QUANTUM_DRIVES={\n';
  const driveEntries = Object.entries(drives.drives);
  driveEntries.forEach(([name, d]) => {
    const speed = d.speed != null ? d.speed : 0;
    const fuel = d.fuel != null ? d.fuel : 0;
    const size = d.size != null ? d.size : 1;
    const type = d.type || 'civilian';
    const desc = d.desc || '';
    out += `  ${JSON.stringify(name)}: {speed:${speed},fuel:${fuel},size:${size},type:${JSON.stringify(type)},desc:${JSON.stringify(desc)}},\n`;
  });
  out += '};\n';
  // Preservar la constante del motor por defecto que vive dentro del
  // bloque SHIPS, después de QUANTUM_DRIVES (la usa el resto del código)
  out += 'const QD_DEFAULT="Torrent (S2)";';
  return out;
}

// ── Generar el bloque MATS (MATERIALS + declaración de TRADE_RULES) ───
function genMatsBlock(materials) {
  const list = materials.materials || [];
  // Asegurar que el placeholder esté primero
  const names = list.map(m => (typeof m === 'string' ? m : m.name)).filter(Boolean);
  const withPlaceholder = names[0] === '— Select commodity —' ? names : ['— Select commodity —', ...names.filter(n => n !== '— Select commodity —')];
  let out = 'let TRADE_RULES={}; // ubicación real -> {produces:[...], consumes:[...]} — datos reales de trade_locations.json\n';
  out += 'let MATERIALS=' + JSON.stringify(withPlaceholder) + ';';
  return out;
}

function main() {
  let html = fs.readFileSync(INDEX_PATH, 'utf-8');

  const locations = readJSON('locations.json');
  const ships = readJSON('ships.json');
  const drives = readJSON('drives.json');
  const materials = readJSON('materials.json');

  html = replaceBlock(html, '// --- AUTOGEN LOCS START ---', '// --- AUTOGEN LOCS END ---', genLocsBlock(locations));
  html = replaceBlock(html, '// --- AUTOGEN SHIPS START ---', '// --- AUTOGEN SHIPS END ---', genShipsBlock(ships, drives));
  html = replaceBlock(html, '// --- AUTOGEN MATS START ---', '// --- AUTOGEN MATS END ---', genMatsBlock(materials));

  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log('[sync-embedded] ✓ index.html sincronizado con data/*.json');
  console.log(`  LOCS:  ${locations.locations.length} ubicaciones`);
  console.log(`  SHIPS: ${ships.ships.length} naves`);
  console.log(`  DRIVES: ${Object.keys(drives.drives).length} motores`);
  console.log(`  MATS:  ${(materials.materials || []).length} materiales`);
}

main();
