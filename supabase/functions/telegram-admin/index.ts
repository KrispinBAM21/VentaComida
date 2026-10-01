import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")!;
const ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const BOT=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
const CHAT=Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")||"";
const SECRET=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
const PUBLIC_SITE_URL=(Deno.env.get("PUBLIC_SITE_URL")||"").replace(/\/$/,"");

function json(v:unknown,status=200){return new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json"}})}
async function tg(method:string,payload:unknown={}){const r=await fetch(`https://api.telegram.org/bot${BOT}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});return r.json()}

Deno.serve(async req=>{
  const auth=req.headers.get("Authorization")||"";
  const client=createClient(URL,ANON,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await client.auth.getUser();
  if(!user) return json({error:"No autorizado"},401);
  const {data:isAdmin,error}=await client.rpc("is_catalog_admin");
  if(error||isAdmin!==true) return json({error:"Sin permisos"},403);
  const {action}=await req.json().catch(()=>({action:"status"}));
  if(!BOT||!CHAT) return json({error:"Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_ADMIN_CHAT_ID en secretos de Edge Functions"},400);
  if(action==="status"){const me=await tg("getMe");const wh=await tg("getWebhookInfo");return json({ok:true,bot:me.result?.username||null,webhook:wh.result?.url||null});}
  if(action==="test"){return json(await tg("sendMessage",{chat_id:CHAT,text:"VentaComida: conexión administrativa de Telegram correcta."}));}
  if(action==="set_webhook"){
    if(!PUBLIC_SITE_URL||!SECRET)return json({error:"Faltan PUBLIC_SITE_URL o TELEGRAM_WEBHOOK_SECRET"},400);
    const url=`${URL}/functions/v1/telegram-webhook`;
    return json(await tg("setWebhook",{url,secret_token:SECRET,allowed_updates:["callback_query","message"]}));
  }
  return json({error:"Acción no válida"},400);
});