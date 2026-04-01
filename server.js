const https = require('https');
const http  = require('http');
const PORT  = process.env.PORT || 3000;

const BYD_HOST = 'my433447.businessbydesign.cloud.sap';
const BYD_USER = '_DEV';
const BYD_PASS = 'Welcome123';

const QUERY_PATH     = '/sap/bc/srt/scs/sap/queryproductionlotisiin?sap-vhost=my433447.businessbydesign.cloud.sap';
const QUERY_ACTION   = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';
const CONFIRM_PATH   = '/sap/bc/srt/scs/sap/manageproductionlotsin?sap-vhost=my433447.businessbydesign.cloud.sap';
const CONFIRM_ACTION = 'http://sap.com/xi/A1S/Global/ManageProductionLotsIn/MaintainBundle_V1Request';

function callByD(path, soapAction, soapBody, res) {
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
      console.log(`[${path.includes('manage')?'CONFIRM':'QUERY'}] HTTP ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, { 'Content-Type':'text/xml', 'Access-Control-Allow-Origin':'*' });
      res.end(xml);
    });
  });
  req.on('error', err => {
    console.error('ByD error:', err.message);
    res.writeHead(502, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ error: err.message }));
  });
  req.write(soapBody);
  req.end();
}

// ── CORRECT SOAP structure from WSDL:
// ProductionLotByElementsQuery_sync
//   ProductionLotSelectionByElements  ← all filters go INSIDE this wrapper
//     SelectionByProductionLotStatusCode (one per status)
//     SelectionByProductionLotDates (optional)
//   ProcessingConditions              ← count goes INSIDE this wrapper
//     QueryHitsMaximumNumberValue
//     QueryHitsUnlimitedIndicator
function buildQuerySOAP(count, dateFrom, dateTo) {
  const fromPart = dateFrom
    ? `<ns2:SelectionByProductionLotCreationDateTime>
        <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
        <ns2:IntervalBoundaryTypeCode>1</ns2:IntervalBoundaryTypeCode>
        <ns2:LowerBoundaryDateTime>${dateFrom}T00:00:00Z</ns2:LowerBoundaryDateTime>
       </ns2:SelectionByProductionLotCreationDateTime>` : '';

  const toPart = dateTo
    ? `<ns2:SelectionByProductionLotCreationDateTime>
        <ns2:InclusionExclusionCode>I</ns2:InclusionExclusionCode>
        <ns2:IntervalBoundaryTypeCode>2</ns2:IntervalBoundaryTypeCode>
        <ns2:UpperBoundaryDateTime>${dateTo}T23:59:59Z</ns2:UpperBoundaryDateTime>
       </ns2:SelectionByProductionLotCreationDateTime>` : '';

  // Include only: 1=In Preparation, 2=Released, 3=In Process
  // Exclude: 4=Completed, 5=Cancelled, 6=Closed
  const statusFilter = `
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
    </ns2:SelectionByProductionLotStatusCode>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://sap.com/xi/SAPGlobal20/Global"
  xmlns:ns2="http://sap.com/xi/A1S/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <ns1:ProductionLotByElementsQuery_sync>
      <ns2:ProductionLotSelectionByElements>
        ${statusFilter}
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

function buildConfirmSOAP(lotId, lotUUID, cgUUID, taskId, taskUUID, rpUUID, rpID, confirmedQty, unitCode, finished) {
  const msgId = 'MSG-' + Date.now();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  // Include ReportingPointUUID if available - SAP needs it to find the right reporting point
  const rpUUIDLine  = rpUUID ? `<ns2:ReportingPointUUID>${rpUUID}</ns2:ReportingPointUUID>` : '';
  const rpIDLine    = rpID   ? `<ns2:ReportingPointID>${rpID}</ns2:ReportingPointID>`       : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://sap.com/xi/SAPGlobal20/Global"
  xmlns:ns2="http://sap.com/xi/A1S/Global"
  xmlns:ns3="http://sap.com/xi/AP/Common/GDT">
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
            <ns2:ExecutionDateTime>${now}</ns2:ExecutionDateTime>
            <ns2:ConfirmationCompletedRequiredIndicator>${finished ? 'true' : 'false'}</ns2:ConfirmationCompletedRequiredIndicator>
          </ns2:ProductionTask>
          <ns2:ReportingPoint>
            ${rpUUIDLine}
            ${rpIDLine}
            <ns2:ConfirmedQuantity unitCode="${unitCode}">${confirmedQty}</ns2:ConfirmedQuantity>
            <ns2:ConfirmationFinishedIndicator>${finished ? 'true' : 'false'}</ns2:ConfirmationFinishedIndicator>
          </ns2:ReportingPoint>
        </ns2:ConfirmationGroup>
      </ns2:ProductionLot>
    </ns1:ProductionLotsBundleMaintainRequest_sync_V1>
  </soapenv:Body>
</soapenv:Envelope>`;
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', host: BYD_HOST, user: BYD_USER, endpoints: ['/sync', '/confirm'] }));
    return;
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {

    if (req.url === '/sync' && req.method === 'POST') {
      let count = 100, dateFrom = '', dateTo = '';
      try { const p = JSON.parse(body); count = p.count||100; dateFrom = p.dateFrom||''; dateTo = p.dateTo||''; } catch(_) {}
      console.log(`SYNC → count=${count} from=${dateFrom||'any'} to=${dateTo||'any'}`);
      callByD(QUERY_PATH, QUERY_ACTION, buildQuerySOAP(count, dateFrom, dateTo), res);
      return;
    }

    if (req.url === '/confirm' && req.method === 'POST') {
      let p = {};
      try { p = JSON.parse(body); } catch(_) {}
      const { lotId, lotUUID, cgUUID, taskId, taskUUID, rpUUID='', rpID='', confirmedQty=1, unitCode='EA', finished=true } = p;
      console.log(`CONFIRM → lotId=${lotId} taskId=${taskId} rpUUID=${rpUUID||'none'} qty=${confirmedQty} ${unitCode}`);
      if (!lotId || !lotUUID || !cgUUID || !taskId || !taskUUID) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Missing: lotId, lotUUID, cgUUID, taskId, taskUUID', received: p }));
        return;
      }
      callByD(CONFIRM_PATH, CONFIRM_ACTION, buildConfirmSOAP(lotId, lotUUID, cgUUID, taskId, taskUUID, rpUUID, rpID, confirmedQty, unitCode, finished), res);
      return;
    }

    res.writeHead(404); res.end('POST /sync | POST /confirm | GET /health');
  });

}).listen(PORT, () => {
  console.log(`✅ ByD Proxy running — port ${PORT}`);
  console.log(`   Fixed: correct SOAP structure, QueryHitsMaximumNumberValue, status filter`);
});
