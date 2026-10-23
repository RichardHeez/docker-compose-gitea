// `npm run migrate` — bring the database up to date (the server also does this when it starts).
import { config } from './config.mjs';
import { createDb, migrate } from './db.mjs';
const db = createDb(config.databaseUrl);
await migrate(db);
await db.close();
console.log('Database is up to date');
