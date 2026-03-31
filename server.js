const https = require('https');
const http  = require('http');
const PORT  = process.env.PORT || 3000;

// ── SAP ByD credentials ────────────────────────────────────────────────────
const BYD_HOST = 'my433447.businessbydesign.cloud.sap';
const BYD_USER = '_DEV';
const BYD_PASS = 'Welcome123';

// ── Endpoint 1: QUERY production lots ─────────────────────────────────────
const QUERY_PATH   = '/sap/bc/srt/scs/sap/queryproductionlotisiin?sap-vhost=my433447.businessbydesign.cloud.sap';
const QUERY_ACTION = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';

// ── Endpoint 2: CONFIRM (maintain) production lots ─────────────────────────
const CONFIRM_PATH   = '/sap/bc/srt/scs/sap/manageproductionlotsin?sap-vhost=my433447.businessbydesign.cloud.sap';
const CONFIRM_ACTION = 'http://sap.com/xi/A1S/Global/ManageProductionLotsIn/MaintainBundle_V1Request';

// ── Helper: make HTTPS request to ByD ─────────────────────────────────────
function callByD(path, soapAction, soapBody, res) {
  const auth = Buffer.from(`${BYD_USER}:${BYD_PASS}`).toString('base64');
  const options = {
    hostname: BYD_HOST,
    path,
    method: 'POST',
    headers: {
      'Content-Type':   'text/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(soapBody),
      'Authorization':  `Basic ${auth}`,
      'SOAPAction':     soapAction,
    }
  };
  const req = https.request(options, proxyRes => {
    let xml = '';
    proxyRes.on('data', c => xml += c);
    proxyRes.on('end', () => {
      console.log(`ByD ${path.includes('manage') ? 'CONFIRM' : 'QUERY'} → HTTP ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'text/xml',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(xml);
    });
  });
  req.on('error', err => {
    console.error('ByD error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: err.message }));
  });
  req.write(soapBody);
  req.end();
}

// ── SOAP: Query production lots ────────────────────────────────────────────
function buildQuerySOAP(count, dateFrom, dateTo) {
  const fromPart = dateFrom ? `<ns1:ProductionStartDateFromDate>${dateFrom}T00:00:00Z</ns1:ProductionStartDateFromDate>` : '';
  const toPart   = dateTo   ? `<ns1:ProductionStartDateToDate>${dateTo}T23:59:59Z</ns1:ProductionStartDateToDate>`     : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://sap.com/xi/SAPGlobal20/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <ns1:ProductionLotByElementsQuery_sync>
      <ns1:MaximumNumberOfResults>${count}</ns1:MaximumNumberOfResults>
      ${fromPart}${toPart}
    </ns1:ProductionLotByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── SOAP: Confirm (maintain) a task ───────────────────────────────────────
// lotId       = ProductionLotID  e.g. "LOT-001"
// lotUUID     = ProductionLotUUID (guid)
// cgUUID      = ConfirmationGroupUUID (guid)
// taskId      = ProductionTaskID
// taskUUID    = ProductionTaskUUID (guid)
// confirmedQty / unitCode  = quantity to confirm
// finished    = true/false → ConfirmationFinishedIndicator
function buildConfirmSOAP(lotId, lotUUID, cgUUID, taskId, taskUUID, confirmedQty, unitCode, finished) {
  const msgId = 'MSG-' + Date.now();
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://sap.com/xi/SAPGlobal20/Global" xmlns:ns2="http://sap.com/xi/A1S/Global" xmlns:ns3="http://sap.com/xi/AP/Common/GDT">
  <soapenv:Header/>
  <soapenv:Body>
    <ns1:ProductionLotsBundleMaintainRequest_sync_V1>
      <ns2:BasicMessageHeader>
        <ns3:ID>${msgId}</ns3:ID>
      </ns2:BasicMessageHeader>
      <ns2:ProductionLot>
        <ns2:ProductionLotID>${lotId}</ns2:ProductionLotID>
        <ns2:ProductionLotUUID>${lotUUID}</ns2:ProductionLotUUID>
        <ns2:ConfirmationGroup>
          <ns2:ConfirmationGroupUUID>${cgUUID}</ns2:ConfirmationGroupUUID>
          <ns2:ProductionTask>
            <ns2:ProductionTaskID>${taskId}</ns2:ProductionTaskID>
            <ns2:ProducionTaskUUID>${taskUUID}</ns2:ProducionTaskUUID>
            <ns2:ExecutionDateTime>${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</ns2:ExecutionDateTime>
          </ns2:ProductionTask>
          <ns2:ReportingPoint>
            <ns2:ConfirmedQuantity unitCode="${unitCode}">${confirmedQty}</ns2:ConfirmedQuantity>
            <ns2:ConfirmationFinishedIndicator>${finished ? 'true' : 'false'}</ns2:ConfirmationFinishedIndicator>
          </ns2:ReportingPoint>
        </ns2:ConfirmationGroup>
      </ns2:ProductionLot>
    </ns1:ProductionLotsBundleMaintainRequest_sync_V1>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── HTTP Server ────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', host: BYD_HOST, user: BYD_USER, endpoints: ['/sync', '/confirm'] }));
    return;
  }

  // Read body for POST requests
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {

    // ── /sync  → Query production lots ──────────────────────────────────
    if (req.url === '/sync' && req.method === 'POST') {
      let count = 100, dateFrom = '', dateTo = '';
      try { const p = JSON.parse(body); count = p.count||100; dateFrom = p.dateFrom||''; dateTo = p.dateTo||''; } catch(_) {}
      callByD(QUERY_PATH, QUERY_ACTION, buildQuerySOAP(count, dateFrom, dateTo), res);
      return;
    }

    // ── /confirm  → Confirm a production task ───────────────────────────
    if (req.url === '/confirm' && req.method === 'POST') {
      let p = {};
      try { p = JSON.parse(body); } catch(_) {}
      const { lotId, lotUUID, cgUUID, taskId, taskUUID, confirmedQty = 1, unitCode = 'EA', finished = true } = p;
      if (!lotId || !lotUUID || !cgUUID || !taskId || !taskUUID) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Missing required fields: lotId, lotUUID, cgUUID, taskId, taskUUID' }));
        return;
      }
      callByD(CONFIRM_PATH, CONFIRM_ACTION, buildConfirmSOAP(lotId, lotUUID, cgUUID, taskId, taskUUID, confirmedQty, unitCode, finished), res);
      return;
    }

    res.writeHead(404); res.end('Endpoints: POST /sync  |  POST /confirm  |  GET /health');
  });

}).listen(PORT, () => {
  console.log('ByD Proxy running — port ' + PORT);
  console.log('Endpoints: /sync (query)  /confirm (maintain)  /health');
});
