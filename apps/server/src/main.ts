import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8787);
// Por defecto, data/private/server en la raíz del repo (ignorada por git), sin importar desde dónde se ejecute.
const dataDir = resolve(process.env.RAMO_DATA_DIR ?? fileURLToPath(new URL('../../../data/private/server', import.meta.url)));

const app = await createApp({ dataDir, log: (m) => console.log(`[ramo-server] ${m}`) });
const actual = await app.listen(port);
console.log(`[ramo-server] escuchando en http://127.0.0.1:${actual} · datos en ${dataDir}`);
