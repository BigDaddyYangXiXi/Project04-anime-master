const {withdrawalReceiptHash}=require('./withdrawal-receipt-hash');
// Caller owns a consistent snapshot or holds the request/payment locks before this read.
async function assertWithdrawalReceiptEvidence(connection,requestId,providerId,parts,config){
  if(!parts.length)return;
  const [receipts]=await connection.execute(`SELECT e.* FROM withdrawal_receipt_events e
    JOIN withdrawal_bank_payments p ON p.id=e.payment_id
    WHERE p.withdrawal_id=? AND e.resulting_status IN ('SUCCEEDED','FAILED')`,[requestId]);
  for(const part of parts){
    const matches=receipts.filter(e=>e.payment_id===part.id);
    if(!matches.length&&!['SUCCEEDED','FAILED'].includes(part.status))continue;
    const receipt=matches[0];
    if(matches.length!==1||receipt.resulting_status!==part.status||receipt.platform_mchid!==config.platformMchid
      ||(part.status==='SUCCEEDED'?(typeof receipt.bank_transaction_reference!=='string'||!receipt.bank_transaction_reference)
        :receipt.bank_transaction_reference!==null)
      ||withdrawalReceiptHash({requestId,paymentId:part.id,providerId,accountVersionId:part.account_version_id,
        amountFen:part.amountFen,operatorId:receipt.operator_id,status:part.status,
        evidenceReference:receipt.evidence_reference,bankTransactionReference:receipt.bank_transaction_reference},config)!==receipt.input_sha256){
      throw Error('WITHDRAWAL_RECEIPT_EVIDENCE_MISMATCH');
    }
  }
}
module.exports={assertWithdrawalReceiptEvidence};
