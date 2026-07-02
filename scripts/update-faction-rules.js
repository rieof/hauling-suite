// ══════════════════════════════════════════════════════════
// Extrae reglas REALES de rango/SCU/reputación para hauling,
// combinando dos fuentes verificadas (no adivinadas):
//
// Fuente 1 — scunpacked-data/contracts/*.json (5000+ archivos,
//   clonados con git sparse-checkout para no hacer miles de
//   requests individuales). Cada contrato de tipo "Hauling" trae
//   HaulingOrders (MinScu/MaxScu/MaxContainerSize) y
//   ReputationGained (XP por completar UNA misión en ese rango).
//   Verificado manualmente: GeneratorClass tipo "Covalex_Hauling",
//   "RedWind_Hauling", "LingFamilyHauling_Hauling", etc.
//
// Fuente 2 — api.star-citizen.wiki/api/missions?filter[faction]=X
//   Trae min_standing.min_reputation = el umbral ACUMULADO real
//   para alcanzar cada rango (nombre real: "Applicant","Jr. Runner",
//   "Experienced","Master", etc). OJO: esta API NO cubre las
//   misiones grandes de freight elevator (todas salen has_hauling:
//   false en las pruebas) — solo sirve para el umbral de rango,
//   no para MinScu/MaxScu/MaxContainerSize (eso viene de la fuente 1).
//
// IMPORTANTE: nunca inventa números. Si una combinación (facción,
// rango, grado) no tiene muestras suficientes, se omite en vez de
// rellenar con un valor adivinado.
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_URL = 'https://github.com/StarCitizenWiki/scunpacked-data.git';
const CLONE_DIR = path.join(__dirname, '..', '.tmp-scunpacked-contracts');
const OUT_PATH = path.join(__dirname, '..', 'data', 'faction-rules.json');
const MIN_SAMPLE_SIZE = 3; // combinaciones con menos muestras que esto se omiten

const WIKI_API = 'https://api.star-citizen.wiki/api/missions';
const FACTIONS_WIKI = ['Covalex', 'Red Wind', 'Ling Family', 'Udmurt'];

function sparseCloneContracts() {
  console.log('[update-faction-rules] Clonando contracts/ de scunpacked-data (sparse)…');
  if (fs.existsSync(CLONE_DIR)) fs.rmSync(CLONE_DIR, { recursive: true, force: true });
  execSync(
    `git clone --depth 1 --filter=blob:none --sparse ${REPO_URL} ${CLONE_DIR}`,
    { stdio: 'inherit' }
  );
  // Evita "dubious ownership" en runners donde el usuario del proceso
  // difiere del dueño del directorio clonado (ej. contenedores como root)
  execSync(`git config --global --add safe.directory ${CLONE_DIR}`, { stdio: 'inherit' });
  execSync(`git -C ${CLONE_DIR} sparse-checkout set contracts`, { stdio: 'inherit' });
}

function extractHaulingMatrix() {
  const contractsDir = path.join(CLONE_DIR, 'contracts');
  const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json'));
  console.log(`[update-faction-rules] Procesando ${files.length} contratos…`);

  const matrix = {}; // faction -> "rank|grade" -> [{minScu,maxScu,maxContainer,repAmount,deadline}]

  for (const fn of files) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(contractsDir, fn), 'utf-8'));
    } catch (e) { continue; }

    if (!d.HaulingOrders || !d.HaulingOrders.length) continue;
    const gc = d.GeneratorClass || '';
    if (!gc.includes('Hauling')) continue;

    const faction = gc.includes('_') ? gc.split('_')[0] : gc;
    const tokens = d.MissionTokens || {};
    const rank = (tokens.ReputationRank || ['?'])[0];
    const grade = (tokens.CargoGradeToken || ['?'])[0];
    const ho = d.HaulingOrders[0];
    const rep = d.ReputationGained || [];
    const repAmount = rep.length ? rep[0].Amount : null;
    const deadline = d.Deadline ? d.Deadline.CompletionTime : null;

    const key = `${rank}|${grade}`;
    if (!matrix[faction]) matrix[faction] = {};
    if (!matrix[faction][key]) matrix[faction][key] = [];
    matrix[faction][key].push({
      minScu: ho.MinScu, maxScu: ho.MaxScu,
      maxContainer: ho.MaxContainerSize > 0 ? ho.MaxContainerSize : null,
      repAmount, deadline
    });
  }
  return matrix;
}

function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
}

function summarizeMatrix(matrix) {
  const summary = {};
  for (const [faction, ranks] of Object.entries(matrix)) {
    summary[faction] = {};
    for (const [key, vals] of Object.entries(ranks)) {
      if (vals.length < MIN_SAMPLE_SIZE) continue; // no inventar con poca muestra
      const minScus = vals.map(v => v.minScu).filter(Boolean);
      const maxScus = vals.map(v => v.maxScu).filter(Boolean);
      const containers = vals.map(v => v.maxContainer).filter(Boolean);
      const reps = vals.map(v => v.repAmount).filter(Boolean);
      const deadlines = vals.map(v => v.deadline).filter(Boolean);
      summary[faction][key] = {
        minScu: minScus.length ? Math.min(...minScus) : null,
        maxScu: maxScus.length ? Math.max(...maxScus) : null,
        maxContainer: mode(containers),
        repPerMission: mode(reps),
        deadlineMinutes: mode(deadlines),
        sampleSize: vals.length
      };
    }
  }
  return summary;
}

async function fetchRankThresholds() {
  console.log('[update-faction-rules] Descargando umbrales de rango reales desde la API…');
  const thresholds = {};
  for (const faction of FACTIONS_WIKI) {
    try {
      const url = `${WIKI_API}?filter[faction]=${encodeURIComponent(faction)}&page[size]=100`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) { console.warn(`  ⚠ ${faction}: HTTP ${res.status}`); continue; }
      const json = await res.json();
      const ranks = new Map();
      for (const m of (json.data || [])) {
        if (m.min_standing && m.min_standing.name) {
          ranks.set(m.min_standing.name, m.min_standing.min_reputation);
        }
      }
      thresholds[faction] = Object.fromEntries(
        [...ranks.entries()].sort((a, b) => a[1] - b[1])
      );
      console.log(`  ✓ ${faction}: ${ranks.size} rangos encontrados`);
    } catch (e) {
      console.warn(`  ⚠ ${faction}: ${e.message}`);
    }
  }
  return thresholds;
}

async function main() {
  sparseCloneContracts();
  const matrix = extractHaulingMatrix();
  const haulingSummary = summarizeMatrix(matrix);
  const rankThresholds = await fetchRankThresholds();

  const output = {
    _meta: {
      version: '4.8.2',
      sources: [
        'github.com/StarCitizenWiki/scunpacked-data (contracts/ — HaulingOrders, ReputationGained, Deadline reales)',
        'api.star-citizen.wiki/api/missions (min_standing — umbrales de rango acumulados reales)'
      ],
      note: 'minScu/maxScu/maxContainer/repPerMission vienen de contratos reales de hauling (freight elevator). rankThresholds vienen de la API de misiones (nombres y XP acumulado real por rango). Combinaciones con menos de ' + MIN_SAMPLE_SIZE + ' muestras se omiten — no se inventa ningún número.',
      generated: new Date().toISOString()
    },
    haulingByGradeAndRank: haulingSummary,
    rankThresholds
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n[update-faction-rules] ✓ Guardado en ${OUT_PATH}`);

  // Limpieza — no crítica: si falla, no debe tumbar el Action ya que
  // el archivo importante (faction-rules.json) ya se guardó arriba
  try {
    if (fs.existsSync(CLONE_DIR)) fs.rmSync(CLONE_DIR, { recursive: true, force: true });
  } catch (e) {
    console.warn('[update-faction-rules] ⚠ No se pudo limpiar la carpeta temporal (no crítico):', e.message);
  }
}

main().catch(err => {
  console.error('[update-faction-rules] ERROR:', err.message);
  process.exit(1);
});
