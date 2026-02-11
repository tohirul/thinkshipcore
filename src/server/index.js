// src/server/index.js
import { loadDotEnv } from "../shared/loadEnv.js";
import { createApp } from "./app.js";

loadDotEnv();

const app = createApp();

// Only bind a local port outside Vercel.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? "4000");
  app.listen(port, () => {
    console.log(`ThinkShip-Core server listening on http://localhost:${port}`);
  });
}

// Vercel Node Functions can use Express directly as a request handler.
export default app;
