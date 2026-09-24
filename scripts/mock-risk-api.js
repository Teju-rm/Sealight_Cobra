// TEMPORARY scaffolding for Phase 5 development only.
// Remove this mock once the real Mapping Engine GET /risk/:buildId (Phase 4)
// is deployed and INGESTION_API_HOST points to it. Do not let this mock silently
// mask a broken real integration later.

const http = require('node:http');

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost:4000');
  const match = url.pathname.match(/^\/risk\/([^/]+)$/);

  if (request.method !== 'GET' || !match) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let buildId;
  try {
    buildId = decodeURIComponent(match[1]);
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Invalid buildId' }));
    return;
  }

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ buildId, untestedChanges: [], riskScore: 0.1 }));
});

server.listen(4000, () => {
  console.log('Temporary mock Risk API listening on http://localhost:4000');
});
