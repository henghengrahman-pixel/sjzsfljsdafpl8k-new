import ExcelJS from 'exceljs';

export function parseDateRange(from,to){
  const rx=/^\d{4}-\d{2}-\d{2}$/;
  if(!rx.test(from||'') || !rx.test(to||'')) throw new Error('DATE_INVALID');
  return {from,to};
}
export async function getSummary(db,{from,to}){
  const q=await db.query(`
    SELECT agent_username AS operator_key, MAX(agent_alias) AS operator,
      COALESCE(SUM(amount) FILTER (WHERE action='Deposit' AND status='ACCEPT'),0)::bigint AS deposit,
      COALESCE(SUM(amount) FILTER (WHERE action='Withdraw' AND status='ACCEPT'),0)::bigint AS withdraw,
      COALESCE(SUM(amount) FILTER (WHERE status='REJECT'),0)::bigint AS reject,
      COUNT(*)::int AS count
    FROM transactions
    WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
    GROUP BY agent_username
    ORDER BY agent_username ASC`,[from,to]);
  return q.rows.map(r=>({...r,deposit:Number(r.deposit),withdraw:Number(r.withdraw),reject:Number(r.reject)}));
}
export async function getDetail(db,{from,to,operator=null}){
  const params=[from,to]; let extra='';
  if(operator){params.push(operator);extra=' AND agent_username=$3';}
  const q=await db.query(`SELECT id,created_at,player_userid,action,from_bank,to_bank,amount,status,agent_alias AS operator,agent_username AS operator_key,verified,upstream_message
    FROM transactions WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day') ${extra}
    ORDER BY created_at DESC,id DESC`,params);
  return q.rows.map(r=>({...r,amount:Number(r.amount)}));
}
function styleHeader(row){row.font={bold:true};row.alignment={vertical:'middle',horizontal:'center'};}
export async function workbookForReport(db,{from,to,operator=null,mode='detail'}){
  const wb=new ExcelJS.Workbook(); wb.creator='AGENT MASTER 8008'; wb.created=new Date();
  if(mode==='summary'){
    const ws=wb.addWorksheet('Summary');
    ws.addRow([`Laporan ALL GAMES (${from} / ${to})`]); ws.mergeCells('A1:E1'); styleHeader(ws.getRow(1));
    ws.addRow(['No','OPERATOR','DEPOSIT','WITHDRAW','REJECT']); styleHeader(ws.getRow(2));
    const rows=await getSummary(db,{from,to});
    rows.forEach((r,i)=>ws.addRow([i+1,r.operator,r.deposit,r.withdraw,r.reject]));
    ws.columns=[{width:8},{width:28},{width:18},{width:18},{width:18}];
    ['C','D','E'].forEach(c=>ws.getColumn(c).numFmt='#,##0');
  } else {
    const ws=wb.addWorksheet('Detail');
    ws.addRow([`Laporan ALL GAMES (${from} / ${to})${operator?` & USER : ${operator}`:''}`]); ws.mergeCells('A1:I1'); styleHeader(ws.getRow(1));
    ws.addRow(['No','Tanggal Terima','User','Action','Dari Bank','Tujuan Bank','Jumlah','Status','Operator']); styleHeader(ws.getRow(2));
    const rows=await getDetail(db,{from,to,operator});
    rows.forEach((r,i)=>ws.addRow([i+1,new Date(r.created_at),r.player_userid,r.action,r.from_bank||'-',r.to_bank||'-',r.amount,r.status,r.operator]));
    ws.getColumn(2).numFmt='dd-mm-yyyy hh:mm:ss'; ws.getColumn(7).numFmt='#,##0';
    ws.columns=[{width:7},{width:22},{width:22},{width:14},{width:24},{width:24},{width:16},{width:13},{width:24}];
  }
  return wb;
}
