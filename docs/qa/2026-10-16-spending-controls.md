# Controles de gasto de Sarin — 16 de octubre de 2026

Estado: inventario de solo lectura y dos alertas de presupuesto creadas por el operador desde la sesión del propietario. El presupuesto solicitado es **USD 15 al mes para Sarin**; la cuenta Cloudflare también contiene otros proyectos. No se amplió el OAuth de Wrangler ni se cambiaron planes en esta tarea.

## Evidencia observada

Workers Paid está activo, según la inspección autenticada del dashboard realizada por el operador. También existen suscripciones R2 Paid, Images/Stream Basic y Teams Free; no atribuir a Sarin el servicio Images/Stream de otro proyecto. El correo del propietario se verificó en la interfaz y no se copia a este documento.

El 16 de octubre, aproximadamente a las **11:54 UTC**, Billable Usage mostró el ciclo **22 de septiembre–21 de octubre**, consumo observado hasta el 16 de octubre, **USD 0 de usage cost** y **USD 0 de proyección de consumo**. La vista excluye tarifas base/recurrentes: esos ceros no significan una factura Cloudflare total de USD 0 ni un coste total de Sarin de USD 0. El importe facturado definitivo y su separación por proyecto siguen requiriendo revisión al cierre del ciclo.

El OAuth de Wrangler tiene nueve scopes y permite `account:read`, pero las seis lecturas siguientes devolvieron HTTP 403, código `10000`: tipos de alertas, políticas, destinos elegibles, información de consumo facturable, consumo facturable V1 y consumo V2. Esto impide confirmar mediante ese token las alertas existentes, sus destinatarios y el importe facturado. No se ampliaron permisos. Un 403 no significa que no existan alertas ni que el consumo sea cero.

La consulta GraphQL `containersUsageAdaptiveGroups`, filtrada por la aplicación Sarin `a032778c-ce3d-4673-b65a-4bf13fa3e02c`, sí respondió sin errores. Ventana solicitada: `2026-10-01T00:00:00Z`–`2026-10-16T11:48:59.204Z`, un grupo agregado:

| Métrica Sarin | Valor observado |
| --- | ---: |
| CPU | 98,73 segundos |
| Memoria asignada | 1,165283 GiB-horas |
| Disco asignado | 4,661132 GB-horas |
| Salida de red | 13.788.399 bytes |

Estas métricas incluyen el entorno de ejecución del contenedor y sirven para estimar costes; pueden llegar con retraso. El valor bruto de CPU, memoria y disco observado, antes de franquicias, es aproximadamente **USD 0,01364**. No es un importe de factura. Estas cantidades cabrían en las franquicias mensuales de Containers si otros usos de la cuenta no las hubieran consumido. La vista Billable Usage posterior mostró USD 0 de consumo, con las exclusiones indicadas arriba; separar los otros proyectos y cotejar la factura final. [Métricas facturables de Containers](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-container-metrics/).

## Precios y margen de USD 15

Configuración local revisada: un contenedor `basic`, máximo una instancia, suspensión después de dos minutos, WhatsApp y retención desactivados. El cron configurado no despierta la instancia con ambos flags desactivados. Una vista o monitor que consulte continuamente la salud sí puede mantener actividad; cerrar los sondeos al terminar una comprobación.

El plan Workers Paid cuesta USD 5 mensuales. Containers `basic` dispone de 0,25 vCPU, 1 GiB de memoria y 4 GB de disco. Incluye 25 GiB-h de memoria, 375 minutos de vCPU y 200 GB-h de disco; los excesos cuestan respectivamente USD 0,0000025/GiB-s, 0,000020/vCPU-s y 0,00000007/GB-s. Memoria/disco siguen la capacidad asignada durante la actividad; CPU sigue el uso efectivo. [Precios oficiales de Containers](https://developers.cloudflare.com/containers/platform/pricing/).

| Escenario de 30 días | Estimación USD |
| --- | ---: |
| Cuota de Workers + memoria/disco de `basic` activo todo el mes | 11,93 |
| Lo anterior y toda su CPU de 0,25 vCPU ocupada continuamente | 24,44 |

Los cálculos asignan conservadoramente los USD 5 completos a Sarin y suponen disponibles las franquicias. No incluyen impuestos, excesos de Workers/Durable Objects/D1/R2/red ni otros proyectos. La suspensión puede reducir el consumo. **Una réplica y dos minutos de suspensión no garantizan un máximo de USD 15.**

D1 Paid incluye 25.000 millones de filas leídas, 50 millones escritas y 5 GB al mes; después cobra USD 0,001/millón leído, USD 1/millón escrito y USD 0,75/GB-mes. [D1](https://developers.cloudflare.com/d1/platform/pricing/). R2 Standard incluye 10 GB-mes, un millón de operaciones A y diez millones B; después USD 0,015/GB-mes, USD 4,50/millón A y USD 0,36/millón B; salida directa gratuita. [R2](https://developers.cloudflare.com/r2/pricing/). El Worker y sus Durable Objects tienen medición propia. [Workers](https://developers.cloudflare.com/workers/platform/pricing/).

## Alertas guardadas en el dashboard

Usar [Billing oficial](https://dash.cloudflare.com/?to=/:account/billing), seleccionar la cuenta y entrar en **Billable Usage → Budget alerts**. La otra entrada nativa es [Notifications](https://dash.cloudflare.com/?to=/:account/notifications). Para esta cuenta, el acceso directo es [Notifications de la cuenta](https://dash.cloudflare.com/05fb22c155667de064b55c4e287b21d8/notifications).

Se usó **Budget Alert**, que controla dólares de consumo acumulado de toda la cuenta. El operador confirmó **tres alertas** en Budget Alerts: conservó **LedgerHarbour R2**, preexistente, con umbral de **USD 1**, y creó las dos siguientes. No se modificó la alerta del otro proyecto. Ambas alertas Sarin también se verificaron en Notifications: producto **Billing**, evento **Billing budget alert**, método **Email**, estado **Enabled**. [Alertas guardadas](2026-10-16-spending-alerts-live.png) y [activación en Notifications](2026-10-16-spending-alerts-enabled.png).

| Campo | Advertencia | Revisión urgente |
| --- | --- | --- |
| Nombre | Sarin — aviso de consumo USD 5 | Sarin — aviso urgente USD 8 |
| ID | `e4e74ab493ff4ad3bc1c50792b212631` | `5a149e6ff30e483c97863fa7d12a8838` |
| Umbral de consumo medido | USD 5 | USD 8 |
| Estado confirmado | Enabled en Notifications | Enabled en Notifications |
| Destinatario | Un receptor: propietario predeterminado verificado en UI | Un receptor: el mismo propietario |

Los umbrales dejan margen respecto de los USD 15 si se imputan USD 5 de cuota a Sarin. En una cuenta compartida pueden dispararse por otros proyectos; no presentan una contabilidad aislada de Sarin. El receptor, los umbrales y la activación se confirmaron en la interfaz; la API continúa sin autorización. La edición de la alerta de USD 5 confirmó nombre/descripción, umbral 5, un correo predeterminado y ausencia de filtros de producto: la alerta es de cuenta completa. Billable Usage mostraba nueve productos y todavía no mostraba Containers; no se ha demostrado mediante un cargo facturado que su consumo dispare esta alerta. Tampoco se ha verificado la entrega de correo.

Las alertas consideran consumo acumulado del ciclo de facturación, excluyen cuotas recurrentes y no son una predicción del total mensual. Se procesan diariamente y pueden avisar al día siguiente de superar el umbral. Avisan una vez por ciclo y **no detienen ni limitan el consumo**. [Funcionamiento](https://developers.cloudflare.com/billing/manage/budget-alerts/) y [condiciones actuales de evaluación](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/).

## Verificación y límites operativos

La activación en Notifications está confirmada. Observar la aparición de Containers en el consumo facturable y la entrega de una notificación cuando corresponda, sin registrar correos completos ni tokens. Los nombres, umbrales y un receptor por alerta ya se confirmaron en Budget Alerts. Revisar diariamente al inicio el ciclo vigente, coste por producto y proyección de Sarin. La factura sigue siendo la referencia final.

Si Sarin amenaza con superar USD 15, aplicar la decisión operativa revisada de mantenimiento y comprobar que la instancia no recibe tráfico y queda inactiva; conservar datos, secretos y los recursos de otros proyectos. Este procedimiento manual tampoco constituye un corte automático exacto. No se instaló un mecanismo de corte financiero en esta tarea.

La API publicada de políticas ofrece `GET/POST /accounts/{account_id}/alerting/v3/policies`, y `available_alerts` describe los tipos y filtros permitidos en la cuenta. La lectura requiere un permiso admitido de Notifications/Account Settings; la escritura requiere Notifications Write o Account Settings Write. El OAuth actual devolvió 403, por lo que no se preparó un payload suponiendo un enum o filtros de Budget Alert no descubiertos. La sesión UI autorizada permite continuar sin ampliar ese OAuth. [Lectura de políticas](https://developers.cloudflare.com/api/resources/alerting/subresources/policies/methods/list/) y [tipos disponibles](https://developers.cloudflare.com/api/resources/alerting/subresources/available_alerts/methods/list/).

## DeepSeek: saldo y alerta independientes

El operador revisó DeepSeek Usage: **USD 4,13 de saldo antes de las pruebas**. Es saldo disponible, no gasto acumulado; no representa el saldo posterior a esas pruebas. La alerta de saldo estaba desactivada al comenzar.

Se activó únicamente el aviso en **USD**, con umbral de **USD 2**. Después de guardar y volver a abrir, la interfaz mostró **Balance alert enabled**, USD activado con valor 2 y CNY desactivado con valor 1 conservado. El destinatario es el correo registrado en el proveedor; no se copia a este informe. [Evidencia de la alerta DeepSeek](2026-10-16-deepseek-balance-alert.png).

La alerta avisa sobre saldo restante; **no limita el gasto ni garantiza un hard cap**. La entrega del correo no se probó. No se activó recarga automática, no se compró saldo ni se cambió el plan, y no se extrajeron claves API para configurar el aviso.

Los cargos de DeepSeek se deben registrar por separado de Cloudflare: sus alertas de cuenta no los incluyen. El presupuesto de USD 15 de este informe corresponde a Cloudflare para Sarin. El cambio comercial Ollama primero y DeepSeek después se coordina aparte; esta revisión documenta sus controles de gasto y no modifica la selección de proveedores.
