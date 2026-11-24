import { createApp } from './app.js';
const app = createApp();
const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, '127.0.0.1', () => console.log(`LÁ: http://localhost:${port}/login`));
let renewal;
function runRenewal() {
  if (renewal) return;
  renewal = app.locals.renewBudgets()
    .catch(error=>console.error('[budgets] renewal_failed',error.code || 'UNKNOWN'))
    .finally(()=>{renewal=undefined;});
}
const renewalTimer = setInterval(runRenewal,60*60*1000).unref();
runRenewal();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(renewalTimer);
    server.close(async () => { await renewal; await app.locals.close(); process.exit(0); });
  });
}
