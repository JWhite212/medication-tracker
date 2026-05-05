import { deleteE2EUsers } from "../../scripts/seed-e2e";

export default async function globalTeardown(): Promise<void> {
  if (!process.env.DATABASE_URL && !process.env.E2E_DATABASE_URL) return;
  const removed = await deleteE2EUsers();
  if (removed > 0) {
    console.log(`E2E teardown removed ${removed} test user(s).`);
  }
}
