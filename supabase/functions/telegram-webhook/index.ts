import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
const ADMIN_CHAT_ID=Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")||"";
const ADMIN_USER_ID=Deno.env.get("TELEGRAM_ADMIN_USER_ID")||"";
const WEBHOOK_SECRET=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);

async function api(method:string,payload:unknown){
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
}
Deno.serve(async req=>{
  if(req.method!=="POST") return new Response("ok");
  if(WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==WEBHOOK_SECRET) return new Response("forbidden",{status:403});
  const u=await req.json();
  const cb=u.callback_query;
  if(!cb) return new Response("ok");
  if(String(cb.message?.chat?.id)!==String(ADMIN_CHAT_ID)) return new Response("forbidden",{status:403});
  if(ADMIN_USER_ID && String(cb.from?.id)!==String(ADMIN_USER_ID)) return new Response("forbidden",{status:403});

  const raw=String(cb.data||"");
  const [action,orderId]=raw.split(":");
  if(!["approve","reject","view"].includes(action) || !/^[0-9a-f-]{36}$/i.test(orderId||"")) return new Response("bad request",{status:400});
  const {data:o}=await admin.from("orders").select("id,public_id,customer_name,total,expected_amount,payment_status").eq("id",orderId).single();
  if(!o) return new Response("not found",{status:404});

  if(action==="view"){
    await api("answerCallbackQuery",{callback_query_id:cb.id,text:`${o.public_id} - $${Number(o.expected_amount??o.total).toFixed(2)} MXN`,show_alert:true});
    return new Response("ok");
  }
  const next=action==="approve"?"APPROVED":"REJECTED";
  await admin.from("orders").update({
    payment_status:next,
    approved_at:next==="APPROVED"?new Date().toISOString():null,
    rejected_at:next==="REJECTED"?new Date().toISOString():null,
    rejection_reason:next==="REJECTED"?"Rechazado desde Telegram":null
  }).eq("id",orderId);
  await admin.from("order_events").insert({order_id:orderId,event_type:next==="APPROVED"?"PAYMENT_APPROVED":"PAYMENT_REJECTED",old_status:o.payment_status,new_status:next,source:"TELEGRAM_ADMIN",metadata:{telegram_user_id:cb.from?.id}});
  await api("answerCallbackQuery",{callback_query_id:cb.id,text:next==="APPROVED"?"Pago aprobado":"Pago rechazado"});
  await api("editMessageReplyMarkup",{chat_id:cb.message.chat.id,message_id:cb.message.message_id,reply_markup:{inline_keyboard:[]}});
  return new Response("ok");
});
