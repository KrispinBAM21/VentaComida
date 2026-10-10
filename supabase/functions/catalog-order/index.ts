import {admin,responseTools,sha256} from '../_shared/common.ts';
Deno.serve(async req=>{const {json,early}=responseTools(req);if(early)return early;
 try{const length=Number(req.headers.get('content-length')||0);if(length>30000)return json({error:'Solicitud demasiado grande.'},413);const text=await req.text();if(text.length>30000)return json({error:'Solicitud demasiado grande.'},413);const body=JSON.parse(text),sb=admin();
 const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
 const key=await sha256(new TextEncoder().encode('order:'+ip));const {data:allowed,error:limitError}=await sb.rpc('catalog_order_limit',{p_key:key});if(limitError)throw limitError;if(!allowed)return json({error:'Espera unos segundos antes de crear otro pedido.'},429);
 const delivery={...body.delivery,distance_km:0};
 if(delivery.type==='delivery'){const {data:settings,error}=await sb.from('catalog_settings').select('data').eq('id',1).single();if(error)throw error;const origin=settings.data.origin;
 const lat=Number(delivery.lat),lng=Number(delivery.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||!Number.isFinite(Number(origin?.lat))||!Number.isFinite(Number(origin?.lng)))return json({error:'Coordenadas inválidas.'},400);
 const service=Deno.env.get('ROUTING_URL')||'https://router.project-osrm.org/route/v1/driving';const u=new URL(service);if(u.protocol!=='https:')throw Error('ROUTING_URL debe usar HTTPS.');u.pathname=u.pathname.replace(/\/$/,'')+`/${Number(origin.lng)},${Number(origin.lat)};${lng},${lat}`;u.search='overview=false';
 const result=await fetch(u,{signal:AbortSignal.timeout(12000)});if(!result.ok)throw Error('El servicio de rutas no respondió.');const route=await result.json();if(route.code!=='Ok'||!Number.isFinite(route.routes?.[0]?.distance)||route.routes[0].distance<=0)throw Error('No se encontró una ruta válida.');delivery.distance_km=Math.round(route.routes[0].distance/10)/100;
 }
 const {data,error}=await sb.rpc('submit_order',{p_customer:{...body.customer,request_id:body.request_id||crypto.randomUUID()},p_delivery:delivery,p_payment_title:body.payment_title,p_items:body.items});if(error)throw error;return json({order:data});
 }catch(e){return json({error:e instanceof Error?e.message:(e as {message?:string})?.message||'No se pudo registrar el pedido.'},400)}
});
