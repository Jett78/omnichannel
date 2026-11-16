import { createServer } from "node:http";

import "./index"; // starts the BullMQ workers (side effect of the import)

/**
 * Demo-hosting shim: hosts the BullMQ worker inside a free-tier WEB service
 * (e.g. Render free), which requires an HTTP listener on $PORT for health
 * checks. Production hosting should run `npm run worker` as a real
 * background worker instead — this file exists only for the $0 test setup.
 */
const port = Number(process.env.PORT) || 10000;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("worker ok\n");
}).listen(port, () => {
  console.log(`[worker-web] health listener on :${port} (demo hosting shim)`);
});
