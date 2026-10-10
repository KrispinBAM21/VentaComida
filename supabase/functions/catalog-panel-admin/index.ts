import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origins=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.includes(origin)?origin:'','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.includes(origin))return reply({error:'Origen no permitido.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 try{
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return reply({error:'Inicia sesión.'},401);
  const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:userError}=await caller.auth.getUser();
  if(userError||!user.user)return reply({error:'Sesión inválida.'},401);
  const {data:access,error:accessError}=await caller.rpc('catalog_panel',{p_action:'access',p_payload:{}});
  if(accessError||access?.owner!==true)return reply({error:'Solo el propietario puede crear cuentas.'},403);
  const body=await req.json();
  if(body.action!=='create_user')return reply({error:'Acción desconocida.'},400);
  const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<10||password.length>128)return reply({error:'Correo o contraseña inválidos.'},400);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(error)return reply({error:error.message},400);
  return reply({id:data.user.id,email:data.user.email});
 }catch{return reply({error:'No se pudo procesar la solicitud.'},400)}
});
