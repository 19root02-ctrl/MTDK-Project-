// Database connection configuration for the IMTSE portal.
// This file uses PostgreSQL environment variables and supports cloud SSL.

module.exports = {
  host: process.env.PGHOST || process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  user: process.env.PGUSER || process.env.DB_USER || "postgres",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.PGDATABASE || process.env.DB_NAME || "imtse_portal",
  connectionTimeoutMillis: 10000,
  max: 10,
  ssl: (() => {
    const sslValue = process.env.PGSSL || process.env.PGSSLMODE;
    if (sslValue === "true" || sslValue === "1" || sslValue === "require" || sslValue === "verify-ca" || sslValue === "verify-full") {
      return { rejectUnauthorized: false };
    }
    return false;
  })()
};
