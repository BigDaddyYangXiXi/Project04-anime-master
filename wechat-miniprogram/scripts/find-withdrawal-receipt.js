// Restricted finance recovery read. An absent event does not prove a write or bank payment failed.
async function findWithdrawalReceipt(pool,input,config){
  if(!input||['eventId','requestId','paymentId'].some(k=>typeof input[k]!=='string'||!/^[a-f0-9]{32}$/.test(input[k]))
    ||typeof input.providerId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(input.providerId)
    ||['appid','platformMchid'].some(k=>typeof config?.[k]!=='string'||!config[k]))throw Error('WITHDRAWAL_RECEIPT_QUERY_INVALID');
  // One statement observes the immutable event and current payment in the same snapshot.
  const [[row]]=await pool.execute(`SELECT e.id AS eventId,e.payment_id AS paymentId,
    e.resulting_status AS recordedStatus,p.status AS status
    FROM withdrawal_receipt_events e
    JOIN withdrawal_bank_payments p ON p.id=e.payment_id
    JOIN withdrawal_requests r ON r.id=p.withdrawal_id
    WHERE e.id=? AND p.id=? AND r.id=? AND r.provider_id=? AND r.appid=?
      AND r.platform_mchid=? AND e.platform_mchid=?`,
    [input.eventId,input.paymentId,input.requestId,input.providerId,config.appid,config.platformMchid,config.platformMchid]);
  return row?{found:true,eventId:row.eventId,paymentId:row.paymentId,recordedStatus:row.recordedStatus,status:row.status}
    :{found:false,eventId:input.eventId};
}
module.exports={findWithdrawalReceipt};
