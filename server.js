/**
 * SAP Business ByDesign Proxy Server
 * Handles CORS and forwards SOAP requests to ByD
 *
 * Deploy on Railway / Render / Fly.io / any Node host
 * Set these environment variables:
 *   BYD_TENANT   → e.g. my433447
 *   BYD_USER     → your ByD service user (e.g. APIUSER)
 *   BYD_PASS     → your ByD password
 *   PORT         → auto-set by most platforms (default 3000)
 */

const http = require('http');
const https = require('https');
const url = require('url');

// ── Config (env vars override these defaults) ──────────────────────────────
const BYD_TENANT = process.env.BYD_TENANT || 'my433447';
const BYD_USER   = process.env.BYD_USER   || 'YOUR_USER';
const BYD_PASS   = process.env.BYD_PASS   || 'YOUR_PASS';
const PORT       = process.env.PORT        || 3000;

const BYD_HOST   = `${BYD_TENANT}.businessbydesign.cloud.sap`;
const BYD_PATH   = '/sap/bc/srt/scs/sap/querymanuproductionlotinreq?sap-client=100';

// ── SOAP envelope builder ──────────────────────────────────────────────────
function buildSoapEnvelope(count, dateFrom, dateTo) {
  const fromPart = dateFrom
    ? `<ProductionStartDateFromDate>${dateFrom}T00:00:00Z</ProductionStartDateFromDate>` : '';
  const toPart = dateTo
    ? `<ProductionStartDateToDate>${dateTo}T23:59:59Z</ProductionStartDateToDate>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:glob="http://sap.com/xi/SAPGlobal20/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <glob:ManufacturingProductionLotSimpleByElementsQuery_sync>
      <QueryByElements>
        <MaximumNumberOfResults>${count}</MaximumNumberOfResults>
        ${fromPart}
        ${toPart}
      </QueryByElements>
    </glob:ManufacturingProductionLotSimpleByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── Main HTTP server ───────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS headers — allow any origin (scope down in production if needed)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url);

  // Health-check endpoint
  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', tenant: BYD_HOST }));
    return;
  }

  // Main sync endpoint
  if (parsedUrl.pathname === '/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      let count = 100, dateFrom = '', dateTo = '';
      try {
        const parsed = JSON.parse(body);
        count    = parsed.count    || 100;
        dateFrom = parsed.dateFrom || '';
        dateTo   = parsed.dateTo   || '';
      } catch (_) { /* use defaults */ }

      const soapBody = buildSoapEnvelope(count, dateFrom, dateTo);
      const auth     = Buffer.from(`${BYD_USER}:${BYD_PASS}`).toString('base64');

      const options = {
        hostname: BYD_HOST,
        path: BYD_PATH,
        method: 'POST',
        headers: {
          'Content-Type':   'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(soapBody),
          'Authorization':  `Basic ${auth}`,
          'SOAPAction':     '""',
        },
      };

      const proxyReq = https.request(options, proxyRes => {
        let xmlData = '';
        proxyRes.on('data', chunk => (xmlData += chunk));
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'text/xml',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(xmlData);
        });
      });

      proxyReq.on('error', err => {
        console.error('ByD request error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Upstream SAP ByD error: ' + err.message }));
      });

      proxyReq.write(soapBody);
      proxyReq.end();
    });
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. Use POST /sync');
});

server.listen(PORT, () => {
  console.log(`✅ ByD Proxy running on port ${PORT}`);
  console.log(`   Tenant: ${BYD_HOST}`);
  console.log(`   User:   ${BYD_USER}`);
});
