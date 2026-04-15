import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { env } from "$env/dynamic/private";

const sql = neon(env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
export type Database = typeof db;
