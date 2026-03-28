import type { Knex } from "knex";

const config: Knex.Config = {
  client: "pg",
  connection: process.env.DATABASE_URL ?? {
    host: "localhost",
    port: 5432,
    user: process.env.PGUSER ?? process.env.USER,
    database: "allaboard",
  },
  migrations: {
    directory: "./migrations",
    extension: "ts",
    loadExtensions: [".ts"],
  },
  seeds: {
    directory: "./seeds",
    extension: "ts",
    loadExtensions: [".ts"],
  },
};

// CLI helper — run via `tsx knexfile.ts migrate|rollback|seed|migrate:make <name>`
const [, , command, ...args] = process.argv;
if (command) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const knex = require("knex")(config);
  (async () => {
    try {
      if (command === "migrate") {
        const [batch, applied] = await knex.migrate.latest();
        console.log(`Batch ${batch} — ran ${applied.length} migration(s):`, applied);
      } else if (command === "rollback") {
        const [batch, reverted] = await knex.migrate.rollback();
        console.log(`Rolled back batch ${batch}:`, reverted);
      } else if (command === "seed") {
        await knex.seed.run();
        console.log("Seeds ran successfully.");
      } else if (command === "migrate:make" && args[0]) {
        const file = await knex.migrate.make(args[0]);
        console.log("Created migration:", file);
      } else {
        console.error("Unknown command:", command);
        process.exit(1);
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    } finally {
      await knex.destroy();
    }
  })();
}

export default config;
