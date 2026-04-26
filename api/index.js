const { Redis } = require('@upstash/redis');
const { MB } = require('../dist');

const redis = Redis.fromEnv();

const BANK='MB';
const STK=process.env.MB_STK;
const USERNAME=process.env.MB_USERNAME;
const PASSWORD=process.env.MB_PASSWORD;

let mb=null;
let lastLogin=0;

async function initMB(){
if(!mb || Date.now()-lastLogin>300000){
mb=new MB({
username:USERNAME,
password:PASSWORD
});
await mb.login();
lastLogin=Date.now();
}
}

function formatDate(d){
return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}

function normalizeText(text=''){
return text
.toLowerCase()
.replace(/\s+/g,'')
.replace(/[^a-z0-9]/g,'');
}

async function getHistory(){
await initMB();
const balance=await mb.getBalance();
const acc=balance?.balances?.[0]?.number;
if(!acc) return [];

const today=new Date();
const from=new Date();
from.setDate(today.getDate()-3);

return await mb.getTransactionsHistory({
accountNumber:acc,
fromDate:formatDate(from),
toDate:formatDate(today)
}) || [];
}

async function createOrder(note,amount){
await redis.set(`order:${note}`,{
note,
amount,
status:'pending',
createdAt:Date.now()
});

await redis.sadd('orders',note);
}

async function getOrder(note){
return await redis.get(`order:${note}`);
}

async function updatePaid(note){
const order=await getOrder(note);
if(!order) return;

order.status='paid';
await redis.set(`order:${note}`,order);
}

async function getAllOrders(){
const ids=await redis.smembers('orders') || [];
if(!ids.length) return [];

const rows=[];
for(const id of ids){
const item=await redis.get(`order:${id}`);
if(item) rows.push(item);
}
return rows;
}

module.exports=async(req,res)=>{

const pathname=req.url.split('?')[0];

if(pathname==='/api'){

if(req.query.nap===undefined){
return res.status(400).json({
error:'Dùng /api?nap=30000'
});
}

const amount=Number(req.query.nap);

if(!Number.isFinite(amount)||amount<=0){
return res.status(400).json({
error:'nap không hợp lệ'
});
}

const note='nap'+Date.now();

const qr=`https://img.vietqr.io/image/${BANK}-${STK}-compact2.png?amount=${amount}&addInfo=${note}`;

await createOrder(note,amount);

return res.json({
qr,
note,
amount
});
}

if(pathname==='/api/order'){

const all=await getAllOrders();
const pending=all.filter(x=>x.status==='pending').length;
const paidOrders=all.filter(x=>x.status==='paid');

const revenue=paidOrders.reduce(
(a,b)=>a+b.amount,
0
);

return res.json({
all_orders:all.length,
pending_orders:pending,
completed_orders:paidOrders.length,
revenue,
data:all
});
}

if(pathname==='/check'){

const note=req.query.note;

if(!note){
return res.json({status:'missing_note'});
}

const payment=await getOrder(note);

if(!payment){
return res.json({status:'not_found'});
}

if(payment.status==='paid'){
return res.json({status:'paid'});
}

try{

const history=await getHistory();

const found=history.find(tx=>{
const desc=normalizeText(tx.transactionDesc);
return desc.includes(normalizeText(note));
});

if(found){
await updatePaid(note);
return res.json({status:'paid'});
}

return res.json({status:'pending'});

}catch(e){
return res.json({
status:'error',
message:e.message
});
}
}

res.status(404).json({
error:'Not found'
});

}
