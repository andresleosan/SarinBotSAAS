"""Create three deterministic, printable A6 booking QR sample signs.

Requires reportlab, qrcode, pypdfium2, zxing-cpp, fonttools[woff], Pillow.
These tools are installed outside the product; no application dependency changes.
Run from any directory. See README.md for production/printing notes.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile

# Optional isolated authoring runtime used on the original Windows host.
RUNTIME = Path.home() / ".codex/tmp/sarin-qr-runtime-20261016"
if RUNTIME.exists():
    sys.path.insert(0, str(RUNTIME))

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont as FontToolsFont
from fontTools.varLib.instancer import instantiateVariableFont
import pypdfium2 as pdfium
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
import zxingcpp

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
DESTINATION = "https://example.com/reservar"
W, H = 105 * mm, 148 * mm
DPI = 300
INK = "#162344"
BLUE = "#315ff3"
MUTED = "#52617d"
CREAM = "#F5EFE3"
COPPER = "#985C3D"
QR_MM = 46


def setup_fonts(tmp: Path) -> dict[str, Path]:
    source = ROOT / "public/fonts/dm-sans-latin.woff2"
    paths = {}
    for name, weight in [("DM", 400), ("DMB", 700)]:
        font = FontToolsFont(source)
        if "fvar" in font:
            axis_limits = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
            axis_limits["wght"] = weight
            font = instantiateVariableFont(font, axis_limits, inplace=True)
        font.flavor = None
        path = tmp / f"{name}.ttf"
        font.save(path)
        pdfmetrics.registerFont(TTFont(name, str(path)))
        paths[name] = path
    serif = Path("C:/Windows/Fonts/georgia.ttf")
    serif_bold = Path("C:/Windows/Fonts/georgiab.ttf")
    pdfmetrics.registerFont(TTFont("Serif", str(serif)))
    pdfmetrics.registerFont(TTFont("SerifB", str(serif_bold)))
    return paths


def rect(c, x, y, width, height, color):
    """Rectangle measured in mm, with top-left origin."""
    c.setFillColor(HexColor(color))
    c.rect(x * mm, H - (y + height) * mm, width * mm, height * mm, fill=1, stroke=0)


def text(c, label, x, y, size=10, font="DM", color=INK, align="center"):
    c.setFillColor(HexColor(color))
    c.setFont(font, size)
    draw = {"left": c.drawString, "center": c.drawCentredString, "right": c.drawRightString}[align]
    draw(x * mm, H - y * mm, label)


def line(c, x1, y, x2, color, width=0.5):
    c.setStrokeColor(HexColor(color))
    c.setLineWidth(width)
    c.line(x1 * mm, H - y * mm, x2 * mm, H - y * mm)


def monogram(c, variant):
    if variant == "A":
        c.setFillColor(HexColor(BLUE))
        c.circle(52.5 * mm, H - 18.5 * mm, 8.5 * mm, stroke=0, fill=1)
        text(c, "BN", 52.5, 21.5, 17, "DMB", "#FFFFFF")
    elif variant == "B":
        c.setStrokeColor(HexColor("#D7C499"))
        c.setLineWidth(0.7)
        c.circle(52.5 * mm, H - 19 * mm, 8.8 * mm, stroke=1, fill=0)
        text(c, "BN", 52.5, 22, 18, "Serif", "#D7C499")
    else:
        c.setStrokeColor(HexColor(COPPER))
        c.setLineWidth(0.8)
        c.rect(8 * mm, H - 30 * mm, 17 * mm, 17 * mm, fill=0, stroke=1)
        text(c, "BN", 16.5, 24, 17, "Serif", COPPER)


def qr_matrix():
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=12, border=4)
    qr.add_data(DESTINATION)
    qr.make(fit=True)
    return qr.get_matrix()


MATRIX = qr_matrix()


def draw_qr(c, x=29.5, y=74, size=QR_MM):
    # Includes the complete standard four-module quiet zone. Every QR is pure
    # vector black on a solid white square, with no image scaling or overlay.
    rect(c, x, y, size, size, "#FFFFFF")
    cell = size * mm / len(MATRIX)
    c.setFillColor(HexColor("#000000"))
    for row, values in enumerate(MATRIX):
        for col, dark in enumerate(values):
            if dark:
                c.rect(x * mm + col * cell, H - y * mm - (row + 1) * cell,
                       cell, cell, stroke=0, fill=1)


def common_contacts(c, color=INK, secondary=MUTED):
    text(c, "+57 300 XXX XXXX", 52.5, 125.8, 9.5, "DMB", color)
    text(c, "Instagram · @tu.negocio", 52.5, 131.4, 8.3, "DM", color)
    text(c, "Reservas con Sarin", 52.5, 137, 7, "DM", secondary)
    text(c, "MUESTRA · QR de demostración", 52.5, 142, 6.3, "DMB", secondary)


def create_sign(variant, filename):
    path = OUT / filename
    c = canvas.Canvas(str(path), pagesize=(W, H), pageCompression=1)
    c.setTitle(f"Barbería Norte - Muestra de cartel QR {variant} - A6")
    c.setAuthor("Sarin - diseño de demostración")
    c.setSubject(f"Datos sintéticos. QR de demostración: {DESTINATION}. A6 105 x 148 mm.")
    c.setCreator("ReportLab / diseño vectorial determinista")
    if variant == "A":
        rect(c, 0, 0, 105, 148, "#FFFFFF")
        rect(c, 0, 0, 105, 2, BLUE)
        monogram(c, variant)
        text(c, "Barbería Norte", 52.5, 38, 22, "DMB")
        text(c, "Corte · barba · estilo", 52.5, 44.8, 9, color=MUTED)
        line(c, 40, 50, 65, "#E0E6F1", 0.6)
        text(c, "Escanea y agenda", 52.5, 60, 17, "DMB")
        text(c, "tu cita", 52.5, 67.5, 17, "DMB", BLUE)
        draw_qr(c)
        common_contacts(c)
    elif variant == "B":
        rect(c, 0, 0, 105, 148, INK)
        monogram(c, variant)
        text(c, "Barbería Norte", 52.5, 38.2, 22, "Serif", "#FFFFFF")
        text(c, "CORTE · BARBA · ESTILO", 52.5, 45, 7.5, "DM", "#D7C499")
        line(c, 43, 51, 62, "#D7C499", 0.6)
        text(c, "Escanea y agenda", 52.5, 61, 16.5, "DMB", "#FFFFFF")
        text(c, "tu cita", 52.5, 68, 16.5, "DMB", "#FFFFFF")
        draw_qr(c)
        common_contacts(c, "#FFFFFF", "#D7C499")
    else:
        rect(c, 0, 0, 105, 148, CREAM)
        monogram(c, variant)
        text(c, "Barbería", 31, 20.5, 19, "Serif", INK, "left")
        text(c, "Norte", 31, 29, 26, "SerifB", INK, "left")
        text(c, "Corte · barba · estilo", 8, 40, 8.5, "DM", COPPER, "left")
        line(c, 8, 45, 97, "#D9C9B8", 0.6)
        text(c, "Escanea y agenda", 52.5, 58, 16.5, "DMB", INK)
        text(c, "tu cita", 52.5, 65.5, 18, "Serif", COPPER)
        draw_qr(c, y=72.5)
        common_contacts(c, INK, COPPER)
    c.showPage()
    c.save()
    return path


def render_and_validate(pdf):
    doc = pdfium.PdfDocument(str(pdf))
    assert len(doc) == 1
    page = doc[0]
    width, height = page.get_size()
    assert abs(width - W) < 0.01 and abs(height - H) < 0.01
    text_content = page.get_textpage().get_text_range()
    for required in ("Barbería", "Norte", "Escanea y agenda", "tu cita", "+57 300 XXX XXXX", "@tu.negocio", "Reservas con Sarin", "MUESTRA", "demostración"):
        assert required in text_content, f"Missing text: {required} ({pdf.name})"
    image = page.render(scale=DPI / 72).to_pil().convert("RGB")
    png = pdf.with_suffix(".png")
    image.save(png, dpi=(DPI, DPI))
    decoded = zxingcpp.read_barcodes(image)
    assert len(decoded) == 1, f"Expected exactly one readable QR in {png.name}"
    assert decoded[0].text == DESTINATION, decoded[0].text
    return {"pdf": pdf.name, "preview": png.name, "size_mm": [105, 148],
            "preview_dpi": DPI, "preview_pixels": list(image.size),
            "qr_size_mm_including_quiet_zone": QR_MM, "quiet_zone_modules": 4,
            "qr_modules_including_quiet_zone": len(MATRIX),
            "qr_destination_decoded_from_preview": decoded[0].text,
            "text_and_accents_present": True}


def board(fonts):
    canvas_img = Image.new("RGB", (2100, 1300), "#EDF1F8")
    d = ImageDraw.Draw(canvas_img)
    regular = lambda n: ImageFont.truetype(str(fonts["DM"]), n)
    bold = lambda n: ImageFont.truetype(str(fonts["DMB"]), n)
    d.text((70, 45), "Tu negocio, listo para agendar", font=bold(50), fill=INK)
    d.text((72, 112), "Tres propuestas de cartel A6 · 105 × 148 mm · Negocio y datos de muestra", font=regular(25), fill=MUTED)
    specs = [("A · Agenda clara", "Blanco + azul · máxima legibilidad", "opcion-a-agenda-clara"),
             ("B · Norte nocturno", "Azul profundo · acabado refinado", "opcion-b-norte-nocturno"),
             ("C · Taller cálido", "Crema + cobre · identidad artesanal", "opcion-c-taller-calido")]
    for i, (title, subtitle, stem) in enumerate(specs):
        x = 70 + 670 * i
        d.text((x, 192), title, font=bold(30), fill=INK)
        d.text((x, 237), subtitle, font=regular(23), fill=MUTED)
        preview = Image.open(OUT / f"{stem}.png").convert("RGB")
        preview.thumbnail((575, 811), Image.Resampling.LANCZOS)
        px = x + (600 - preview.width) // 2
        py = 303
        d.rounded_rectangle((px + 10, py + 15, px + preview.width + 10, py + preview.height + 15), radius=4, fill="#D6DFED")
        canvas_img.paste(preview, (px, py))
    d.text((72, 1173), "QR reales de demostración: https://example.com/reservar", font=bold(26), fill=INK)
    d.text((72, 1219), "Para imprimir: usa el PDF individual al 100%. Para activar: sustituye el QR por la URL pública estable del negocio.", font=regular(23), fill=MUTED)
    canvas_img.save(OUT / "comparativa-tres-opciones.png")


def main():
    with tempfile.TemporaryDirectory(prefix="sarin-qr-fonts-") as tmp:
        fonts = setup_fonts(Path(tmp))
        results = []
        for variant, stem in [("A", "opcion-a-agenda-clara"), ("B", "opcion-b-norte-nocturno"), ("C", "opcion-c-taller-calido")]:
            pdf = create_sign(variant, f"{stem}.pdf")
            results.append(render_and_validate(pdf))
        board(fonts)
        (OUT / "verification.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
