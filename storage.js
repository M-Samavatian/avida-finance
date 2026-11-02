/* Avida offline data adapter. All finance records live in this device's IndexedDB. */
const DB_NAME='avida-local-finance',DB_VERSION=1,STORES=['accounts','transactions','obligations'];
let connection;
function db(){if(connection)return connection;connection=new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{for(const s of STORES)if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return connection}
async function all(store){const d=await db();return new Promise((ok,fail)=>{const tx=d.transaction(store,'readonly'),q=tx.objectStore(store).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error)})}
async function write(ops){const d=await db();return new Promise((ok,fail)=>{const tx=d.transaction([...new Set(ops.map(x=>x.store))],'readwrite');for(const op of ops)tx.objectStore(op.store)[op.action||'put'](op.value);tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error)})}
const uid=()=>crypto.randomUUID(),created=()=>new Date().toISOString();
const num=n=>Number(n||0);
function amount(n,allowZero=false){if(!Number.isSafeInteger(num(n))||(allowZero?num(n)<0:num(n)<=0))throw Error('مبلغ معتبر نیست.');return num(n)}
function required(s,max=160){s=String(s||'').trim();if(!s||s.length>max)throw Error('عنوان معتبر نیست.');return s}
function validateDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s)))throw Error('تاریخ معتبر نیست.');return s}
const sortedTx=ts=>ts.sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at));
async function snapshot(){const [accounts,transactions,obligations]=await Promise.all(STORES.map(all));return {accounts,transactions,obligations}}
function accountBalance(a,ts){return num(a.opening_balance)+ts.filter(t=>t.account_id===a.id).reduce((s,t)=>s+num(t.amount)*(t.type==='income'||t.type==='transfer_in'?1:-1),0)}
async function localApi(path,opts={}){
 const method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):{},u=new URL(path,'https://offline.invalid'),parts=u.pathname.split('/').filter(Boolean),root=parts[0];
 if(root==='auth'){if(parts[1]==='me')return {user:{displayName:'حساب محلی'}};if(parts[1]==='logout')return {};if(parts[1]==='password')throw Error('رمز عبور در نسخه محلی ارائه نمی‌شود. برای حفاظت از اطلاعات از قفل گوشی استفاده کنید.');return {user:{displayName:'حساب محلی'}}}
 const data=await snapshot();
 if(root==='accounts'){
  if(method==='GET')return data.accounts.map(a=>({...a,balance:accountBalance(a,data.transactions)}));
  if(method==='POST'){const a={id:uid(),name:required(body.name,80),opening_balance:Number(body.openingBalance)};if(!Number.isSafeInteger(a.opening_balance))throw Error('موجودی اولیه معتبر نیست.');await write([{store:'accounts',value:a}]);return a}
 }
 if(root==='summary'){
  const ts=data.transactions.filter(t=>['income','expense'].includes(t.type)),month=(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`})();
  const income=ts.filter(t=>t.type==='income'&&t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0),expense=ts.filter(t=>t.type==='expense'&&t.date.startsWith(month)).reduce((s,t)=>s+t.amount,0);
  const allIncome=ts.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0),allExpense=ts.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  return {income,expense,allIncome,allExpense,net:allIncome-allExpense};
 }
 if(root==='transactions'){
  if(method==='GET'){let ts=sortedTx(data.transactions);const q=u.searchParams.get('search')?.trim().toLowerCase();if(q)ts=ts.filter(t=>(t.title+' '+t.category).toLowerCase().includes(q));if(u.searchParams.get('type'))ts=ts.filter(t=>t.type===u.searchParams.get('type'));if(u.searchParams.get('from'))ts=ts.filter(t=>t.date>=u.searchParams.get('from'));if(u.searchParams.get('to'))ts=ts.filter(t=>t.date<=u.searchParams.get('to'));return ts}
  if(method==='POST'){if(!['income','expense'].includes(body.type))throw Error('نوع تراکنش نامعتبر است.');if(body.accountId&&!data.accounts.some(a=>a.id===body.accountId))throw Error('حساب پیدا نشد.');const t={id:uid(),type:body.type,title:required(body.title),amount:amount(body.amount),date:validateDate(body.date),category:String(body.category||'عمومی').slice(0,80),method:String(body.method||'نقدی').slice(0,60),note:String(body.note||''),account_id:body.accountId||null,transfer_group:null,created_at:created()};await write([{store:'transactions',value:t}]);return t}
  const t=data.transactions.find(x=>x.id===parts[1]);if(!t)throw Error('تراکنش پیدا نشد.');if(t.transfer_group)throw Error('برای تغییر انتقال، از نسخه پشتیبان استفاده کنید.');
  if(method==='DELETE'){await write([{store:'transactions',action:'delete',value:t.id}]);return {ok:true}}
  if(method==='PUT'){const updated={...t,title:required(body.title),amount:amount(body.amount)};await write([{store:'transactions',value:updated}]);return updated}
 }
 if(root==='transfers'&&method==='POST'){
  if(body.fromAccountId===body.toAccountId)throw Error('حساب‌های مبدا و مقصد باید متفاوت باشند.');if(!data.accounts.some(a=>a.id===body.fromAccountId)||!data.accounts.some(a=>a.id===body.toAccountId))throw Error('دو حساب معتبر انتخاب کنید.');
  const value=amount(body.amount),date=validateDate(body.date),group=uid(),title=required(body.title||'انتقال وجه'),stamp=created();
  const common={title,amount:value,date,category:'انتقال',method:'انتقال',note:'',transfer_group:group,created_at:stamp};
  await write([{store:'transactions',value:{...common,id:uid(),type:'transfer_out',account_id:body.fromAccountId}},{store:'transactions',value:{...common,id:uid(),type:'transfer_in',account_id:body.toAccountId}}]);return {ok:true}
 }
 if(root==='obligations'){
  if(method==='GET')return data.obligations.sort((a,b)=>a.due_date.localeCompare(b.due_date));
  if(method==='POST'){if(!['debt','receivable'].includes(body.type))throw Error('نوع موعد نامعتبر است.');const o={id:uid(),type:body.type,title:required(body.title),amount:amount(body.amount),due_date:validateDate(body.dueDate),repeat_rule:body.repeatRule==='monthly'?'monthly':'once',reminder_days:Array.isArray(body.reminderDays)?body.reminderDays:[3],note:String(body.note||''),status:'pending',created_at:created(),settled_at:null};await write([{store:'obligations',value:o}]);return o}
  const o=data.obligations.find(x=>x.id===parts[1]);if(!o)throw Error('موعد پیدا نشد.');
  if(method==='DELETE'){await write([{store:'obligations',action:'delete',value:o.id}]);return {ok:true}}
  if(parts[2]==='settle'&&method==='POST'){
   if(o.status==='settled')throw Error('این موعد قبلاً تسویه شده.');
   await write([{store:'obligations',value:{...o,status:'settled',settled_at:created()}}]);return {ok:true};
  }
 }
 if(root==='notifications')return [];
 if(root==='backup'){
  if(method==='GET')return {format:'avida-local-backup',version:1,exportedAt:created(),...data};
  if(parts[1]==='restore'&&method==='POST'){
   if(body.format!=='avida-local-backup'||body.version!==1||!STORES.every(s=>Array.isArray(body[s])))throw Error('فرمت فایل پشتیبان معتبر نیست.');
   const seen=new Set();for(const s of STORES)for(const item of body[s]){if(!item||typeof item.id!=='string'||!item.id||seen.has(s+item.id))throw Error('داده پشتیبان نامعتبر است.');seen.add(s+item.id)}
   const ops=STORES.flatMap(s=>body[s].map(value=>({store:s,value})));if(ops.length)await write(ops);return {ok:true}
  }
 }
 throw Error('عملیات پشتیبانی نمی‌شود: '+path)
}
