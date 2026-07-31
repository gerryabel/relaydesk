import pg from "pg";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

try {
  await client.connect();
  console.log("PostgreSQL OK");
} catch (error) {
  console.error("PostgreSQL check failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
