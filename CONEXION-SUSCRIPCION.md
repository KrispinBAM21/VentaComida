# VentaComida conectada a la plataforma central

Esta plantilla usa la API y suscripciones de EntregaManiobras. No lleva otro token de Telegram ni un lector Gmail duplicado.

1. Instala primero la plataforma central: https://github.com/KrispinBAM21/EntregaManiobras/pull/1. Sigue platform/README.md para el único SQL nuevo, la función saas-platform y las actualizaciones de gmail-oauth y telegram-webhook.
2. En el panel central crea el negocio con identificador **venta-comida** y paga o confirma administrativamente su plan WEB. Si requiere validación automática contrata también BOT para esa cuenta.
3. Desde el panel web vincula/prueba la banca y Gmail; configura el negocio, su pin, WhatsApp, cuentas visibles, redes y productos. Telegram conserva el registro y los avisos.
4. Integra este PR y publica GitHub Pages desde la rama configurada. La página será https://krispinbam21.github.io/VentaComida/. El nombre del repositorio y el identificador del negocio son distintos: este repositorio apunta a venta-comida.
5. Para apuntar a otro negocio cambia solo PLATFORM_CONFIG.site en platform/web/config.js; ese negocio debe existir y tener WEB activo.

La marca y el catálogo se cargan desde el negocio, sin datos privados de otros sitios. El cliente genera su pedido y referencia antes de transferir, conserva el borrador, consulta el estado con el código privado y descarga su ticket. Los precios se recalculan en servidor y la entrega de esta plantilla usa distancia lineal.

El catálogo previo no se importa automáticamente a las tablas nuevas. Conserva su respaldo y crea los productos del negocio en el panel central. Este PR es una propuesta; no ejecuta SQL ni cambia funciones remotas.
