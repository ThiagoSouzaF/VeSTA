// Usage tracking: last Claude rate-limit windows + per-day, per-provider token/cost totals.
const emptyUsage=()=>({rateLimit:{fiveHour:null,sevenDay:null,updatedAt:null},daily:{}});
const dayKey=(t=Date.now())=>{const d=new Date(t),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
function ensure(usage){if(!usage.rateLimit)usage.rateLimit={fiveHour:null,sevenDay:null,updatedAt:null};if(!usage.daily)usage.daily={};return usage;}
function recordRateLimit(usage,ev,now=Date.now()){
  ensure(usage);let changed=false;
  for(const k of ['fiveHour','sevenDay'])if(ev[k]){usage.rateLimit[k]={...usage.rateLimit[k],...ev[k]};changed=true;}
  if(changed)usage.rateLimit.updatedAt=now;return changed;
}
function recordCost(usage,ev,now=Date.now()){
  ensure(usage);const day=usage.daily[dayKey(now)]||(usage.daily[dayKey(now)]={});
  const p=day[ev.provider]||(day[ev.provider]={inputTokens:0,outputTokens:0,cacheTokens:0,costUsd:0,turns:0});
  p.inputTokens+=ev.inputTokens||0;p.outputTokens+=ev.outputTokens||0;p.cacheTokens+=ev.cacheTokens||0;p.costUsd+=ev.costUsd||0;p.turns+=1;
  // keep ~120 days
  const keys=Object.keys(usage.daily).sort();while(keys.length>120)delete usage.daily[keys.shift()];
  return p;
}
// Shape returned by the `usage` IPC method: {rateLimit, today:{[provider]:totals}, days:[{date,providers:{...}}] (newest first, last 7 days with data)}
function summary(usage,now=Date.now()){
  ensure(usage);const dates=Object.keys(usage.daily).sort().reverse();
  return {now,rateLimit:usage.rateLimit,today:usage.daily[dayKey(now)]||{},days:dates.slice(0,7).map(date=>({date,providers:usage.daily[date]}))};
}
module.exports={emptyUsage,dayKey,recordRateLimit,recordCost,summary};
