import {admin,responseTools,sha256}from '../_shared/common.ts';
Deno.serve(async req=>{const {json,early}=responseTools(req);if(early)return early;let path:string|undefined;const sb=admin();
 try{if(Number(req.headers.get('content-length')||0)>9*1024*1024)return json({error:'Máximo 8 MB.'},413);
 const form=await req.formData(),publicId=String(form.get('public_id')||''),token=String(form.get('upload_token')||''),file=form.get('file');
 if(!(file instanceof File)||!file.size||file.size>8388608||!/^[0-9a-f]{64}$/.test(token))return json({error:'Archivo o autorización de carga inválidos.'},400);
 const {data:order,error:oe}=await sb.rpc('catalog_receipt_target',{p_public_id:publicId,p_token:token});if(oe)throw oe;
 const bytes=new Uint8Array(await file.arrayBuffer());const png=bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10',jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
 const mime=png?'image/png':jpg?'image/jpeg':pdf?'application/pdf':null;if(!mime)return json({error:'Usa un PNG, JPEG o PDF real.'},400);
 const hash=await sha256(bytes),ext=png?'png':jpg?'jpg':'pdf';path=`${order.id}/${crypto.randomUUID()}.${ext}`;
 const {error:se}=await sb.storage.from('receipts-private').upload(path,bytes,{contentType:mime,upsert:false});if(se)throw se;
 const {data,error}=await sb.rpc('catalog_receipt_commit',{p_public_id:publicId,p_token:token,p_file:{path,name:file.name,size:file.size,hash,mime}});if(error)throw error;return json(data);
 }catch(e){if(path)await sb.storage.from('receipts-private').remove([path]);return json({error:e instanceof Error?e.message:(e as {message?:string})?.message||'No se pudo guardar el comprobante.'},400)}
});
