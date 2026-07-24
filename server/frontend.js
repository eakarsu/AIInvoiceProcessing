const express = require('express');
const http = require('http');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = Number(process.env.FRONTEND_PORT || 4000);
const backendPort = Number(process.env.BACKEND_PORT || 4001);

app.use('/api', (request, response) => {
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: backendPort,
    path: request.originalUrl,
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${backendPort}` },
  }, (backendResponse) => {
    response.writeHead(backendResponse.statusCode || 502, backendResponse.headers);
    backendResponse.pipe(response);
  });
  proxy.on('error', () => {
    if (!response.headersSent) response.status(502).json({ error: 'Backend unavailable' });
    else response.end();
  });
  request.pipe(proxy);
});

app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('*', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Frontend running on http://127.0.0.1:${port}`);
});
