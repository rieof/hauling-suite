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
// Nombres completos verificados (aparecen en texto plano en las misiones
// reales, ej. "Faction · Red Wind Linehaul" en api.star-citizen.wiki/missions/...)
// Solo 3 facciones de hauling reales confirmadas por la wiki oficial:
// Covalex Shipping, Red Wind Linehaul, Ling Family Hauling.
// ("Udmurt" no es una facción de hauling real — quitada tras verificar
// que no aparece en ningún lado como mission-giver de carga)
const FACTIONS_WIKI = ['Covalex', 'Red Wind Linehaul', 'Ling Family Hauling'];

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

// El objeto de reputación del juego mezcla 3 escaleras distintas en el
// mismo bloque: Afinidad general (Applicant/Neutral), la carrera vieja
// de Delivery/Courier (Jr. Runner/Runner/Jr. Contractor/Contractor/
// Sr. Contractor/Veteran Contractor), y la carrera de Hauling (freight
// elevator, parche 3.24+) que es la única que nos importa. Confirmado
// cruzando contra MissionTokens.ReputationRank de los contratos reales
// de scunpacked-data — ese campo SOLO usa estos 7 nombres en misiones
// de HaulingOrders, nunca "Jr. Runner" ni "Contractor".
const HAULING_RANKS = ['Trainee', 'Rookie', 'Junior', 'Member', 'Experienced', 'Senior', 'Master'];

function filterToHaulingRanks(rawRanks) {
  const filtered = {};
  for (const [name, xp] of Object.entries(rawRanks)) {
    if (HAULING_RANKS.includes(name)) filtered[name] = xp;
  }
  return filtered;
}

async function fetchRankThresholds() {
  console.log('[update-faction-rules] Descargando umbrales de rango reales desde la API…');
  const thresholds = {};
  for (const faction of FACTIONS_WIKI) {
    try {
      // CLAVE: filter[faction] SOLO no filtra bien (bug/limitación de la
      // API — siempre devuelve Covalex). Pero combinado con
      // filter[reward_scope]=Hauling sí filtra correctamente. Confirmado
      // con Red Wind Linehaul: 298 misiones reales, todas con
      // faction.name="Red Wind Linehaul".
      const ranks = new Map();
      let page = 1, lastPage = 1, totalMissions = 0;
      do {
        const url = `${WIKI_API}?filter[reward_scope]=Hauling&filter[faction]=${encodeURIComponent(faction)}&page[number]=${page}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) { console.warn(`  ⚠ ${faction}: HTTP ${res.status}`); break; }
        const json = await res.json();
        const missions = json.data || [];
        lastPage = json.meta?.last_page || 1;
        totalMissions += missions.length;

        for (const m of missions) {
          if (m.min_standing && m.min_standing.name) {
            ranks.set(m.min_standing.name, m.min_standing.min_reputation);
          }
        }
        page++;
      } while (page <= lastPage);

      // Validación: confirmar que lo que volvió es realmente de esta
      // facción (por si acaso, aunque ya lo confirmamos manualmente)
      if (ranks.size === 0) {
        console.warn(`  ⚠ ${faction}: sin datos de rango encontrados`);
        continue;
      }

      const rawObj = Object.fromEntries(
        [...ranks.entries()].sort((a, b) => a[1] - b[1])
      );
      const haulingOnly = filterToHaulingRanks(rawObj);
      const missingHaulingRanks = HAULING_RANKS.filter(r => !(r in haulingOnly));

      thresholds[faction] = {
        hauling: haulingOnly, // ← usar esto en la app (solo los 7 rangos reales de Hauling)
        raw: rawObj,          // ← las 3 escaleras mezcladas (Afinidad + Delivery + Hauling), para referencia/cruce manual
        missingFromThisFaction: missingHaulingRanks // rangos de Hauling que no aparecieron en la muestra de ESTA facción
      };
      console.log(`  ✓ ${faction}: ${ranks.size} rangos crudos, ${totalMissions} misiones revisadas, ${Object.keys(haulingOnly).length}/7 rangos de Hauling confirmados${missingHaulingRanks.length ? ' (faltan: '+missingHaulingRanks.join(', ')+')' : ''}`);
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
      note: 'minScu/maxScu/maxContainer/repPerMission vienen de contratos reales de hauling (freight elevator). rankThresholds.hauling = solo los 7 rangos reales de la carrera Hauling (Trainee..Master), filtrados de la respuesta cruda de la API que mezcla 3 escaleras distintas (Afinidad general, Delivery/Courier viejo, y Hauling). rankThresholds.raw conserva todo sin filtrar por si hace falta cruzar manualmente. missingFromThisFaction avisa qué rangos de Hauling no aparecieron en la muestra de esa facción específica (puede inferirse de otra facción si la escalera resulta ser universal — verificar antes de asumir). Combinaciones con menos de ' + MIN_SAMPLE_SIZE + ' muestras se omiten — no se inventa ningún número.',
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
