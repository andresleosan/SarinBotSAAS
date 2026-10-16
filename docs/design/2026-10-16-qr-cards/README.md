# Carteles QR para mostrador - propuestas de impresión

Tres propuestas de muestra para colocar en un portacartel acrílico A6. La marca principal es el negocio; Sarin aparece como firma secundaria. No se modificó código ni configuración del producto.

## Opciones

| Opción | PDF listo a tamaño A6 | Vista previa PNG | Dirección |
| --- | --- | --- | --- |
| A · elegida | `opcion-a-agenda-clara.pdf` | `opcion-a-agenda-clara.png` | Blanco, tinta y azul `#315ff3`; plantilla del primer piloto. |
| B · referencia | `opcion-b-norte-nocturno.pdf` | `opcion-b-norte-nocturno.png` | Azul `#162344`, blanco y acento dorado suave; presencia más refinada. |
| C · referencia | `opcion-c-taller-calido.pdf` | `opcion-c-taller-calido.png` | Crema y cobre, marca asimétrica y tipografía serif; tono artesanal. |

`comparativa-tres-opciones.png` muestra las tres juntas. Es una lámina de revisión, no el archivo para imprimir.

El propietario eligió **A / Agenda clara** con «usemos la A» para el primer piloto. La app generará esta plantilla con el logo y los datos de cada negocio, sin selector de estilos antes de lanzar. **B y C se conservan como referencias**; sus archivos no cambian. La elección de A no activa el QR de muestra ni incorpora los datos sintéticos al producto.

## Tamaño y preparación

- Cada PDF tiene **una página de 105 × 148 mm**, orientación vertical, tamaño final A6. Imprimir al **100 % / tamaño real**; desactivar «Ajustar a página». Confirmar que el portacartel admite A6: un soporte de 10 × 15 cm tiene medidas diferentes.
- Textos y códigos QR son vectoriales. Fuentes incrustadas mediante subconjuntos: DM Sans del repositorio; Georgia para B y C. Las vistas previas son de **300 ppp**, 1241 × 1749 px.
- La información esencial queda dentro de un margen de al menos **5 mm**. Los fondos y la franja azul de A llegan al borde; no son información esencial.
- Archivos al corte, **sin sangrado ni marcas de corte**. Para papel de escritorio o portacartel, imprimir a tamaño real sobre una hoja mayor y recortar a 105 × 148 mm. Para imprenta comercial que exija sangrado, preparar una versión con 3 mm de fondo adicional por lado conservando el corte A6; no ampliar ni estirar este diseño para simularlo.
- Colores RGB. Para una tirada profesional, la imprenta debe convertir con su perfil y hacer una prueba física. El «dorado» y «cobre» son colores planos impresos, no tintas metálicas.
- En un soporte acrílico, probar la lectura con la iluminación real para comprobar reflejos. Una prueba física con cámara de móvil queda pendiente; la comprobación automatizada se describe más abajo.

## Datos de demostración

El negocio **Barbería Norte**, el monograma **BN**, el teléfono **+57 300 XXX XXXX** y el usuario **@tu.negocio** son datos sintéticos. El monograma es un diseño de muestra, no el logotipo de una empresa real.

**Destino exacto de los tres códigos QR: `https://example.com/reservar`.** Es una URL de demostración; no abre reservas de Sarin ni pertenece a un negocio activo. Cada cartel dice «MUESTRA · QR de demostración». No utilizar los artes como material comercial activo.

Para producción se necesitan el nombre y logotipo reales, teléfono y redes confirmados, y una **URL pública estable de reservas del negocio**. Generar de nuevo el QR con esa URL y validarlo desde el PDF final. No enlazar un entorno local, una vista de administración, una sesión de usuario o una URL temporal. Retirar la leyenda de muestra solo después de validar el enlace real.

## Comprobaciones realizadas

- Tres PDFs abiertos y renderizados con PDFium a 300 ppp; una página A6 en cada archivo.
- Cada render se inspeccionó visualmente, incluida la jerarquía de marca, contactos y texto de demostración. Sin recortes, solapamientos ni glifos vacíos en los artes finales y en la lámina.
- Texto extraído: nombre con acento, llamada a agendar, teléfono, usuario social, firma de Sarin y leyenda de muestra presentes.
- **ZXing-C++ decodificó cada QR a partir de su PNG renderizado** y devolvió exactamente `https://example.com/reservar`.
- QR negro puro sobre blanco, sin logotipo superpuesto, corrección de error M y zona libre estándar de cuatro módulos en los cuatro lados.
- Cuadrado total del QR: **46 × 46 mm**, incluida la zona libre. Símbolo negro y blanco útil: **36,05 × 36,05 mm** (29 módulos; matriz total de 37). Supera 35 mm incluso sin contar la zona libre.
- Evidencia legible por máquina: `verification.json`.

## Regeneración

`generate.py` contiene los tres diseños y la validación. Usa Python con `reportlab`, `qrcode`, `pypdfium2`, `zxing-cpp`, `fonttools`, `brotli` y `Pillow`. En el host original las herramientas se instalaron solo en `C:/Users/USER/.codex/tmp/sarin-qr-runtime-20261016`, fuera del repositorio. No se alteraron dependencias ni lockfiles de Sarin.

Ejecutar desde el repositorio:

```powershell
python docs/design/2026-10-16-qr-cards/generate.py
```

El script toma DM Sans de `public/fonts/dm-sans-latin.woff2` y Georgia de las fuentes del sistema Windows. Las fuentes convertidas temporalmente se eliminan al finalizar. Los PDFs contienen sus propios subconjuntos, por lo que no requieren esas fuentes para verlos o imprimirlos.
