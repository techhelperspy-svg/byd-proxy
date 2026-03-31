const https = require('https');
const http  = require('http');
const PORT  = process.env.PORT || 3000;

// ── SAP ByD credentials (from your WSDL + login) ──────────────────────────
const BYD_HOST    = 'my433447.businessbydesign.cloud.sap';
const BYD_PATH    = '/sap/bc/srt/scs/sap/queryproductionlotisiin?sap-vhost=my433447.businessbydesign.cloud.sap';
const SOAP_ACTION = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';
const BYD_USER    = '_DEV';
const BYD_PASS    = 'Welcome123';

// ── SOAP envelope (matches WSDL: ProductionLotByElementsQuery_sync) ────────
function buildSOAP(count, dateFrom, dateTo) {
  const fromPart = dateFrom
    ? `<ns1:ProductionStartDateFromDate>${dateFrom}T00:00:00Z</ns1:ProductionStartDateFromDate>` : '';
  const toPart = dateTo
    ? `<ns1:ProductionStartDateToDate>${dateTo}T23:59:59Z</ns1:ProductionStartDateToDate>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://sap.com/xi/SAPGlobal20/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <ns1:ProductionLotByElementsQuery_sync>
      <ns1:MaximumNumberOfResults>${count}</ns1:MaximumNumberOfResults>
      ${fromPart}
      ${toPart}
    </ns1:ProductionLotByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── HTTP server ────────────────────────────────────────────────────────────
http.createServer((req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', host: BYD_HOST, user: BYD_USER }));
    return;
  }

  // Main sync endpoint
  if (req.url === '/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let count = 100, dateFrom = '', dateTo = '';
      try {
        const p = JSON.parse(body);
        count    = p.count    || 100;
        dateFrom = p.dateFrom || '';
        dateTo   = p.dateTo   || '';
      } catch(_) {}

      const soap = buildSOAP(count, dateFrom, dateTo);
      const auth = Buffer.from(`${BYD_USER}:${BYD_PASS}`).toString('base64');

      const options = {
        hostname: BYD_HOST,
        path:     BYD_PATH,
        method:   'POST',
        headers: {
          'Content-Type':   'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(soap),
          'Authorization':  `Basic ${auth}`,
          'SOAPAction':     SOAP_ACTION,
        }
      };

      const proxyReq = https.request(options, proxyRes => {
        let xml = '';
        proxyRes.on('data', c => xml += c);
        proxyRes.on('end', () => {
          console.log('ByD response: HTTP ' + proxyRes.statusCode);
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'text/xml',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(xml);
        });
      });

      proxyReq.on('error', err => {
        console.error('ByD error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      });

      proxyReq.write(soap);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404); res.end('Use POST /sync');

}).listen(PORT, () => {
  console.log('ByD Proxy running — port ' + PORT);
  console.log('Host: ' + BYD_HOST);
  console.log('User: ' + BYD_USER);
});
