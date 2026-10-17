# Buscar próxima fecha disponible

Autorización: «ok vamos paso a paso, implementando probando y publicando, y pasamos al otro». Este es el primer incremento; publicar y verificar antes de implementar el siguiente.

## Entorno

- Cliente sintético de `demo-sarin-bot`, emuladores oficiales en loopback.
- Preview compilada local en `127.0.0.1:3041`; ninguna credencial ni escritura de prueba en producción.
- Fixture única con día actual cerrado, día siguiente con cupos, dos profesionales y servicio que no cabe en la jornada.
- Baseline focal: 44 pruebas aprobadas en disponibilidad, calendario estructurado, rutas y ciclo de vida.

## Controles de navegador

1. Entrar con Google emulado y abrir la ficha sintética con permisos sintéticos preconfigurados.
2. Elegir servicio y profesional; comprobar que no aparece la búsqueda siguiente antes de consultar.
3. Consultar el día cerrado: estado sin horarios y acceso «Buscar próxima fecha disponible».
4. Activar con teclado: observar carga, primera fecha futura con horarios y día actualizado.
5. Mantener servicio/profesional, precio y duración; no elegir una hora automáticamente.
6. Elegir una hora manualmente; conservar el recorrido de propuesta/confirmación sin ejecutarlo en esta prueba.
7. Cambiar servicio, profesional o día: limpiar resultados anteriores y no lanzar una búsqueda automática.
8. Seleccionar servicio que no cabe en ninguna jornada; consultar y buscar: mostrar intervalo máximo de catorce días sin confundirlo con un error.
9. Distinguir error de red/servidor de un intervalo correcto vacío (complementado por pruebas de hook/API).
10. Revisar 320×740, 390×844 y escritorio: sin desbordamiento, controles de al menos 44 px y foco visible.
11. Auditar red: solo consultas explícitas de disponibilidad; sin inferencia, propuestas ni confirmaciones automáticas.
12. Limpiar únicamente documentos de la fixture propia, preservar decisiones compartidas y detener procesos propios.

## Publicación

Congelar revisión probada, construir imagen normal de producción, verificar humo aislado y reversión al release anterior. Mantener una instancia; activar mantenimiento, drenar cola, sustituir imagen y verificar instancia efectiva antes de reabrir. Registrar HTTP, sesión administrativa y límites observados del navegador. La autorización ya cubre esta publicación; no se pide de nuevo.
