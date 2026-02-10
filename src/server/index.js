import { createApp } from "./app.js";
import { loadDotEnv } from "../shared/loadEnv.js";

loadDotEnv();

const port = Number(process.env.PORT ?? "4000");
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ThinkShip-Core server listening on http://localhost:${port}`);
});

