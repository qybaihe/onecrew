import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://onecrew:onecrew-local-postgres@127.0.0.1:55432/onecrew',
  },
  migrations: {
    table: '__onecrew_migrations',
    schema: 'drizzle',
  },
  strict: true,
  verbose: true,
});
