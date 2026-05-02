import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { env } from "$env/dynamic/private";

// HTTP driver — used for everything that doesn't need a transaction.
// Single round-trip per query, no connection pool, near-zero cold-start
// cost. The Neon HTTP driver does NOT support transactions.
const sql = neon(env.DATABASE_URL!);
export const db = drizzleHttp(sql, { schema });

// Websocket driver — used ONLY for code paths that need transactional
// atomicity (dose+inventory writes, schedule replacement). Pool is
// lazy — no connection is opened until the first query, so adding
// this export does not impact cold-start cost for read-only paths.
const pool = new Pool({ connectionString: env.DATABASE_URL! });
export const dbTx = drizzleWs(pool, { schema });
