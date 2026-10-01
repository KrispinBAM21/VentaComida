import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status=200){
  return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
}
function hex(buf:ArrayBuffer){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function telegram(text:string, orderId:string){
  if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return;
  const reply_markup={inline_keyboard:[[
    {text:"APROBAR",callback_data:`approve:${orderId}`},
    {text:"RECHAZAR",callback_data:`reject:${orderId}`}
  ],[{text:"VER DATOS",callback_data:`view:${orderId}`}]]};
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:TELEGRAM_ADMIN_CHAT_ID,text,reply_markup})
  });
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Método no permitido"},405);
  try{
    const form=await req.formData();
    const publicId=String(form.get("public_id")||"").trim();
    const file=form.get("file");
    if(!publicId || !(file instanceof File)) return json({error:"Faltan public_id o archivo"},400);
    if(!["image/png","image/jpeg","application/pdf"].includes(file.type)) return json({error:"Formato no permitido"},400);
    if(file.size>8*1024*1024) return json({error:"Archivo mayor a 8 MB"},400);

    const {data:order,error:oe}=await admin.from("orders")
      .select("id,public_id,folio,customer_name,total,expected_amount,payment_status")
      .eq("public_id",publicId).single();
    if(oe || !order) return json({error:"Orden no encontrada"},404);

    const bytes=await file.arrayBuffer();
    const fileHash=hex(await crypto.subtle.digest("SHA-256",bytes));
    const {data:dupes}=await admin.from("receipts").select("id,order_id").eq("file_hash",fileHash).limit(5);
    const duplicate=Array.isArray(dupes) && dupes.length>0;

    const ext=file.type==="image/png"?"png":file.type==="image/jpeg"?"jpg":"pdf";
    const path=`${order.id}/${crypto.randomUUID()}.${ext}`;
    const {error:upErr}=await admin.storage.from("receipts-private").upload(path,new Uint8Array(bytes),{contentType:file.type,upsert:false});
    if(upErr) throw upErr;

    const {data:receipt,error:riErr}=await admin.from("receipts").insert({
      order_id:order.id,file_path:path,original_name:file.name,mime_type:file.type,file_size:file.size,
      file_hash:fileHash,raw_analysis:{duplicate_hash:duplicate,analysis_status:"PENDING"}
    }).select().single();
    if(riErr) throw riErr;

    const nextStatus=duplicate?"PENDING_REVIEW":"PENDING_REVIEW";
    await admin.from("orders").update({payment_status:nextStatus}).eq("id",order.id);
    await admin.from("order_events").insert({
      order_id:order.id,event_type:"RECEIPT_UPLOADED",old_status:order.payment_status,new_status:nextStatus,source:"WEB",
      metadata:{receipt_id:receipt.id,duplicate_hash:duplicate}
    });

    await telegram(
      `Nueva orden\n\nOrden: ${order.public_id}\nMonto esperado: $${Number(order.expected_amount??order.total).toFixed(2)} MXN\nEstado: REVISIÓN${duplicate?"\nPosible comprobante duplicado":""}`,
      order.id
    );

    return json({ok:true,receipt_id:receipt.id,payment_status:nextStatus,duplicate_hash:duplicate});
  }catch(e){
    console.error(e);
    return json({error:e instanceof Error?e.message:"Error interno"},500);
  }
});
