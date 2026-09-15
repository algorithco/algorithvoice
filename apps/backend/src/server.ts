import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { closeRedis } from "./queues/connection.js";

const env = loadEnv();
const app = buildApp();

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await closeRedis().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
  app.log.fatal({ err }, "unhandled rejection");
  process.exit(1);
});

app.listen({ port: env.PORT, host: "::" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
