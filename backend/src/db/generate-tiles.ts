/**
 * Genera las teselas de los planos que aún no las tienen (planos subidos antes de esta
 * versión). No es obligatorio: si falta, se generan al abrir el plano por primera vez.
 *   desarrollo:  npm run plans:tiles -w backend
 *   producción:  docker compose exec backend node dist/db/generate-tiles.js
 */
import type { FloorPlanRow } from '../domain.js';
import { ensurePlanTiles } from '../modules/plans/planImage.js';
import { pool } from './pool.js';

async function main() {
  const { rows } = await pool.query<FloorPlanRow>('SELECT * FROM floor_plans WHERE storage_key IS NOT NULL ORDER BY created_at');
  console.log(`${rows.length} planos con imagen`);
  let failed = 0;
  for (const [i, plan] of rows.entries()) {
    const t0 = Date.now();
    const size = `${plan.width_px} × ${plan.height_px} px (${Math.round(((plan.width_px ?? 0) * (plan.height_px ?? 0)) / 1e6)} Mpx)`;
    try {
      await ensurePlanTiles(plan); // no hace nada si ya existen
      console.log(`  [${i + 1}/${rows.length}] ${plan.name} (v${plan.version}, ${size}) · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      failed++;
      console.error(`  [${i + 1}/${rows.length}] ${plan.name} (${size}): ${(err as Error).message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().finally(() => pool.end());
