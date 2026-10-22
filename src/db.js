const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  // Fail loudly and immediately rather than letting every query error out
  // later with a confusing message.
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in your " +
      "Supabase connection string before starting the server."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase's pooled connection requires SSL; this accepts its certificate
  // without pinning it, which is fine for a hobby project's free-tier db.
  ssl: { rejectUnauthorized: false },
});

module.exports = { pool };
