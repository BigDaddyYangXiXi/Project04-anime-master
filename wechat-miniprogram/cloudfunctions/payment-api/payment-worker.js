const { timingSafeEqual } = require('node:crypto');
const requestContext = require('./request-context');

// Independent internal credential; never routed through mini-program actions.
async function reconcile(event, context, env, runtime, run) {
  try {
    let request = event;
    if (event?.Type === 'Timer') {
      if (event.TriggerName !== 'payment-reconcile-every-five-minutes'
        || typeof event.Time !== 'string' || !Number.isFinite(Date.parse(event.Time))
        || typeof event.Message !== 'string' || event.Message.length > 256
        || Object.keys(event).some(key => !['Type','TriggerName','Time','Message'].includes(key))) {
        return { ok:false, error:{ code:'PAYMENT_WORKER_FORBIDDEN' } };
      }
      try { request = JSON.parse(event.Message); } catch { return { ok:false, error:{ code:'PAYMENT_WORKER_FORBIDDEN' } }; }
    }
    const token = env.PAYMENT_QUERY_WORKER_TOKEN, supplied = request?.workerToken;
    const caller = requestContext(context) || {};
    if (env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978'
      || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
      || caller.WX_OPENID || caller.OPENID || !request || Array.isArray(request)
      || Object.keys(request).some(key => key !== 'workerToken')
      || !timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(supplied,'hex'))) {
      return { ok:false, error:{ code:'PAYMENT_WORKER_FORBIDDEN' } };
    }
    const { pool, config } = runtime();
    // executeClaimedQuery can otherwise close expired prepay sessions. This worker only queries.
    if (config.closeEnabled !== false) return { ok:false, error:{ code:'PAYMENT_WORKER_QUERY_ONLY_REQUIRED' } };
    return { ok:true, data:await run(pool,config) };
  } catch {
    return { ok:false, error:{ code:'PAYMENT_WORKER_FAILED' } };
  }
}

exports.runPaymentWorker = async (event, context, env, runtime, run) => {
  const result = await reconcile(event,context,env,runtime,run);
  if (event?.Type === 'Timer' && (!result.ok || result.data?.enabled !== true || result.data.failed > 0)) {
    throw new Error('PAYMENT_WORKER_SCHEDULE_FAILED');
  }
  return result;
};
