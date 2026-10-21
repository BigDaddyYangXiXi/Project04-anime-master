const crypto = require('node:crypto');
exports.main = async event => {
  const token = process.env.TAX_PERMISSION_PROBE_TOKEN;
  if (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978' || !/^[a-f0-9]{64}$/.test(token || '')
    || !event || Object.keys(event).some(k=>k!=='token') || !/^[a-f0-9]{64}$/.test(event.token || '')
    || !crypto.timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(event.token,'hex'))) return {ok:false,code:'FORBIDDEN'};
  let connection;
  try {
    const config = JSON.parse(Buffer.from(process.env.PAYMENT_MYSQL_CONFIG_B64,'base64').toString('utf8'));
    if (config.user!=='am_payment' || config.database!=='cloudbase-d2g65rqbvee0bd978'
      || config.host!=='172.17.0.13' || config.port!==3306) throw Error();
    connection=await require('mysql2/promise').createConnection({host:config.host,port:config.port,user:config.user,password:config.password,
      database:config.database,multipleStatements:false,connectTimeout:5000});
    const [[actor]]=await connection.query('SELECT CURRENT_USER() AS actor');
    if(actor.actor!=='am_payment@172.17.0.0/255.255.240.0') throw Error();
    await connection.beginTransaction();
    const id=crypto.randomBytes(16).toString('hex');
    const insert=`INSERT INTO provider_tax_submissions(id,withholding_entity_id,appid,provider_id,encrypted_payload,notice_version,submitted_at)
      VALUES(?,'permission-probe','permission-probe','permission-probe','{"synthetic":true}','permission-probe',1)
      ON DUPLICATE KEY UPDATE id=id`;
    await connection.execute(insert,[id]); await connection.execute(insert,[id]);
    const [[row]]=await connection.execute('SELECT COUNT(*) AS n FROM provider_tax_submissions WHERE id=?',[id]);
    if(Number(row.n)!==1) throw Error();
    await connection.query('SELECT id FROM provider_tax_profile_versions LIMIT 0');
    const denials=[];
    for(const statement of [
      'UPDATE provider_tax_submissions SET encrypted_payload=encrypted_payload WHERE id=?',
      'DELETE FROM provider_tax_submissions WHERE id=?',
      'UPDATE provider_tax_profile_versions SET review_status=review_status WHERE id=?',
      'SELECT id FROM tax_assessment_drafts WHERE id=?',
      'SELECT id FROM provider_tax_profile_reviews WHERE id=?'
    ]) {
      try { await connection.execute(statement,[id]); denials.push(false); }
      catch(error) { if(!['ER_TABLEACCESS_DENIED_ERROR','ER_COLUMNACCESS_DENIED_ERROR'].includes(error.code)) throw Error(); denials.push(true); }
    }
    await connection.rollback();
    const [[remaining]]=await connection.execute('SELECT COUNT(*) AS n FROM provider_tax_submissions WHERE id=?',[id]);
    if(!denials.every(Boolean) || Number(remaining.n)!==0) throw Error();
    return {ok:true,actorMatched:true,insertAndIdempotentRetry:true,profileRead:true,
      privatePayloadUpdateDenied:true,deleteDenied:true,reviewUpdateDenied:true,otherTaxTablesDenied:true,rolledBack:true,remaining:0};
  } catch { return {ok:false,code:'PERMISSION_PROBE_FAILED'}; }
  finally { if(connection) { try { await connection.rollback(); } finally { await connection.end(); } } }
};
