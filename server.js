const https = require('https');
const http  = require('http');
const PORT  = process.env.PORT || 3000;

const BYD_HOST       = 'my433447.businessbydesign.cloud.sap';
const BYD_USER       = '_DEV';
const BYD_PASS       = 'Welcome123';
const QUERY_PATH     = '/sap/bc/srt/scs/sap/queryproductionlotisiin?sap-vhost=my433447.businessbydesign.cloud.sap';
const QUERY_ACTION   = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';
const CONFIRM_PATH   = '/sap/bc/srt/scs/sap/manageproductionlotsin?sap-vhost=my433447.businessbydesign.cloud.sap';
const CONFIRM_ACTION = 'http://sap.com/xi/A1S/Global/ManageProductionLotsIn/MaintainBundle_V1Request';

function callByD(path, soapAction, soapBody) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${BYD_USER}:${BYD_PASS}`).toString('base64');
    const options = {
      hostname: BYD_HOST, path, method: 'POST',
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
        console.log(`[ByD] HTTP ${proxyRes.statusCode} | ${path.includes('manage')?'CONFIRM':'QUERY'}`);
        resolve({ status: proxyRes.statusCode, xml });
      });
    });
    req.on('error', err => reject(err));
    req.write(soapBody);
    req.end();
  });
}

function sendResponse(res, status, xml) {
  res.writeHead(status, { 'Content-Type':'text/xml', 'Access-Control-Allow-Origin':'*' });
  res.end(xml);
}

function sendError(res, status, msg) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify({ error: msg }));
}

// ── QUERY SOAP ────────────────────────────────────────────────────────────
function buildQuerySOAP(count, dateFrom, dateTo) {
  const fromPart = dateFrom ? `
        <ns2:SelectionByProductionLotCreationDateTime>
          <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
          <ns2:IntervalBoundaryTypeCode>1</ns2:IntervalBoundaryTypeCode>
          <ns2:LowerBoundaryDateTime>${dateFrom}T00:00:00Z</ns2:LowerBoundaryDateTime>
        </ns2:SelectionByProductionLotCreationDateTime>` : '';
  const toPart = dateTo ? `
        <ns2:SelectionByProductionLotCreationDateTime>
          <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
          <ns2:IntervalBoundaryTypeCode>2</ns2:IntervalBoundaryTypeCode>
          <ns2:UpperBoundaryDateTime>${dateTo}T23:59:59Z</ns2:UpperBoundaryDateTime>
        </ns2:SelectionByProductionLotCreationDateTime>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://sap.com/xi/SAPGlobal20/Global"
  xmlns:ns2="http://sap.com/xi/A1S/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <ns1:ProductionLotByElementsQuery_sync>
      <ns2:ProductionLotSelectionByElements>
        <ns2:SelectionByProductionLotStatusCode>
          <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
          <ns2:IntervalBoundaryTypeCode>1</ns2:IntervalBoundaryTypeCode>
          <ns2:LifeCycleStatusCode>1</ns2:LifeCycleStatusCode>
        </ns2:SelectionByProductionLotStatusCode>
        <ns2:SelectionByProductionLotStatusCode>
          <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
          <ns2:IntervalBoundaryTypeCode>1</ns2:IntervalBoundaryTypeCode>
          <ns2:LifeCycleStatusCode>2</ns2:LifeCycleStatusCode>
        </ns2:SelectionByProductionLotStatusCode>
        <ns2:SelectionByProductionLotStatusCode>
          <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
          <ns2:IntervalBoundaryTypeCode>1</ns2:IntervalBoundaryTypeCode>
          <ns2:LifeCycleStatusCode>3</ns2:LifeCycleStatusCode>
        </ns2:SelectionByProductionLotStatusCode>
        ${fromPart}
        ${toPart}
      </ns2:ProductionLotSelectionByElements>
      <ns2:ProcessingConditions>
        <ns2:QueryHitsMaximumNumberValue>${count}</ns2:QueryHitsMaximumNumberValue>
        <ns2:QueryHitsUnlimitedIndicator>false</ns2:QueryHitsUnlimitedIndicator>
      </ns2:ProcessingConditions>
    </ns1:ProductionLotByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── CONFIRM SOAP — Step 1: Update MaterialOutput confirmed quantity ─────────
// Per docs scenario 2/4: use ActionCode="02" + MaterialOutputUUID + ConfirmedQuantity
function buildMaterialOutputSOAP(lotId, lotUUID, cgUUID, materialOutputs) {
  const moLines = materialOutputs.map(mo => `
      <MaterialOutput ActionCode="02">
        <MaterialOutputUUID>${mo.uuid}</MaterialOutputUUID>
        <ConfirmedQuantity unitCode="${mo.unitCode}">${mo.confirmedQty}</ConfirmedQuantity>
        <ConfirmationFinished>true</ConfirmationFinished>
      </MaterialOutput>`).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<n0:ProductionLotsBundleMaintainRequest_sync_V1 xmlns:n0="http://sap.com/xi/SAPGlobal20/Global">
  <BasicMessageHeader/>
  <ProductionLot>
    <ProductionLotID>${lotId}</ProductionLotID>
    <ProductionLotUUID>${lotUUID}</ProductionLotUUID>
    <ConfirmationGroup>
      <ConfirmationGroupUUID>${cgUUID}</ConfirmationGroupUUID>
      ${moLines}
    </ConfirmationGroup>
  </ProductionLot>
</n0:ProductionLotsBundleMaintainRequest_sync_V1>`;
}

// ── CONFIRM SOAP — Step 2: Finish the task ────────────────────────────────
// Per docs scenario 9: ONLY ProductionTask with ProducionTaskUUID + ExecutionDateTime
// + ConfirmationCompletedRequiredIndicator. NO MaterialInput/Output in same request.
function buildFinishTaskSOAP(lotId, lotUUID, cgUUID, taskId, taskUUID) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '.0000000Z');
  return `<?xml version="1.0" encoding="utf-8"?>
<n0:ProductionLotsBundleMaintainRequest_sync_V1 xmlns:n0="http://sap.com/xi/SAPGlobal20/Global">
  <BasicMessageHeader/>
  <ProductionLot>
    <ProductionLotID>${lotId}</ProductionLotID>
    <ProductionLotUUID>${lotUUID}</ProductionLotUUID>
    <ConfirmationGroup>
      <ConfirmationGroupUUID>${cgUUID}</ConfirmationGroupUUID>
      <ProductionTask>
        <ProductionTaskID>${taskId}</ProductionTaskID>
        <ProducionTaskUUID>${taskUUID}</ProducionTaskUUID>
        <ExecutionDateTime>${now}</ExecutionDateTime>
        <ConfirmationCompletedRequiredIndicator>true</ConfirmationCompletedRequiredIndicator>
      </ProductionTask>
    </ConfirmationGroup>
  </ProductionLot>
</n0:ProductionLotsBundleMaintainRequest_sync_V1>`;
}

// ── HTTP Server ────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', host: BYD_HOST, user: BYD_USER }));
    return;
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {

    // ── /sync ──────────────────────────────────────────────────────────────
    if (req.url === '/sync' && req.method === 'POST') {
      let count = 100, dateFrom = '', dateTo = '';
      try { const p = JSON.parse(body); count=p.count||100; dateFrom=p.dateFrom||''; dateTo=p.dateTo||''; } catch(_) {}
      console.log(`SYNC count=${count}`);
      try {
        const r = await callByD(QUERY_PATH, QUERY_ACTION, buildQuerySOAP(count, dateFrom, dateTo));
        // Log first ProducionTaskUUID found to verify parsing
        const match = r.xml.match(/<ProducionTaskUUID>([^<]+)<\/ProducionTaskUUID>/);
        console.log('Sample ProducionTaskUUID from response:', match ? match[1] : 'NOT FOUND');
        sendResponse(res, r.status, r.xml);
      } catch(e) { sendError(res, 502, e.message); }
      return;
    }

    // ── /confirm ───────────────────────────────────────────────────────────
    // Per SAP docs: finish task and update quantities MUST be separate requests
    // Step 1: If materialOutputs provided → update confirmed quantities
    // Step 2: Finish the task (ONLY ProductionTask node, no materials)
    if (req.url === '/confirm' && req.method === 'POST') {
      let p = {};
      try { p = JSON.parse(body); } catch(_) {}
      const { lotId, lotUUID, cgUUID, taskId, taskUUID, materialOutputs=[] } = p;

      console.log(`CONFIRM lotId=${lotId} taskId=${taskId} taskUUID=${taskUUID} moCount=${materialOutputs.length}`);

      if (!lotId || !lotUUID || !cgUUID || !taskId || !taskUUID) {
        sendError(res, 400, 'Missing: lotId, lotUUID, cgUUID, taskId, taskUUID');
        return;
      }

      try {
        let step1Result = null;

        // Step 1: Update MaterialOutput quantities (if any)
        if (materialOutputs.length > 0) {
          console.log('Step 1: Updating MaterialOutput quantities...');
          const soap1 = buildMaterialOutputSOAP(lotId, lotUUID, cgUUID, materialOutputs);
          console.log('SOAP Step1:\n', soap1);
          step1Result = await callByD(CONFIRM_PATH, CONFIRM_ACTION, soap1);
          console.log('Step 1 response:', step1Result.xml.substring(0, 500));
        }

        // Step 2: Finish the task
        console.log('Step 2: Finishing task...');
        const soap2 = buildFinishTaskSOAP(lotId, lotUUID, cgUUID, taskId, taskUUID);
        console.log('SOAP Step2:\n', soap2);
        const step2Result = await callByD(CONFIRM_PATH, CONFIRM_ACTION, soap2);
        console.log('Step 2 response:', step2Result.xml.substring(0, 500));

        // Return step2 response (the finish task result)
        sendResponse(res, step2Result.status, step2Result.xml);

      } catch(e) {
        console.error('Confirm error:', e.message);
        sendError(res, 502, e.message);
      }
      return;
    }

    res.writeHead(404); res.end('POST /sync | POST /confirm | GET /health');
  });

}).listen(PORT, () => {
  console.log(`✅ ByD Proxy running — port ${PORT}`);
  console.log(`   Correct: finish task in separate request from material updates`);
});
