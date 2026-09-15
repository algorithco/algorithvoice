import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = buildApp();

app.listen({ port: env.PORT, host: "::" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
