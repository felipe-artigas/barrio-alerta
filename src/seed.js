import { fileURLToPath } from 'node:url';

// Reclamos ficticios marcados como demo (is_demo = 1). No tienen análisis de IA inventado.
const DEMO = [
  { title: 'Bache profundo en esquina', description: 'Hay un pozo de casi 30 cm en la esquina, ya se rompieron dos ruedas de autos esta semana.', address: 'Av. Pellegrini y Moreno', neighborhood: 'Centro', category: 'bache' },
  { title: 'Cuadra entera sin luz', description: 'Desde hace diez días las tres luminarias de la cuadra están apagadas y de noche no se ve nada.', address: 'Mendoza 4500', neighborhood: 'Echesortu', category: 'alumbrado' },
  { title: 'Microbasural en terreno baldío', description: 'Se acumula basura y escombros en el terreno, hay olor fuerte y aparecieron roedores.', address: 'Bv. Seguí 3200', neighborhood: 'Tablada', category: 'residuos' },
  { title: 'Rama a punto de caer', description: 'Una rama grande del árbol de la vereda quedó colgando después de la tormenta, sobre la parada del colectivo.', address: 'Córdoba 2100', neighborhood: 'Centro', category: 'arbolado' },
  { title: 'Pérdida de agua en la vereda', description: 'Sale agua limpia de la vereda constantemente desde hace una semana, se forma un charco grande.', address: 'Alberdi 900', neighborhood: 'Alberdi', category: 'agua_cloacas' },
  { title: 'Semáforo intermitente', description: 'El semáforo funciona en amarillo intermitente en horario pico y hay mucho riesgo para peatones.', address: 'Oroño y 27 de Febrero', neighborhood: 'Abasto', category: 'transito' },
];

export function seedDemo(repo) {
  for (const r of DEMO) {
    const created = repo.create(r, true);
    repo.saveAi(created.id, { status: 'pendiente', message: 'Reclamo de demostración: podés pedir el análisis con IA.' });
  }
  return DEMO.length;
}

// Ejecución directa: npm run seed
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('./config.js');
  const { openDb, createRepo } = await import('./db.js');
  const { config } = loadConfig();
  const db = openDb(config.dbPath);
  const repo = createRepo(db);
  if (repo.count() > 0) console.log('La base ya tiene datos; no se cargó la demo.');
  else console.log(`Cargados ${seedDemo(repo)} reclamos de demostración en ${config.dbPath}`);
  db.close();
}
