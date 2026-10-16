export interface AppointmentImageDetails {
  businessName: string;
  serviceName: string;
  resourceName?: string;
  startAt: number;
  endAt: number;
  generatedAt: number;
}

const imageError = "No pudimos generar la imagen. Inténtalo de nuevo.";
const dateFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Draw only the reminder's public fields. No HTML, remote images or uploads. */
export async function createAppointmentImage(details: AppointmentImageDetails): Promise<Blob> {
  if (![details.startAt, details.endAt, details.generatedAt].every(Number.isFinite) || details.endAt <= details.startAt) throw new Error(imageError);
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(imageError);
  const family = getComputedStyle(document.body).fontFamily || "Arial, sans-serif";
  const padding = 76, contentWidth = canvas.width - padding * 2;
  type Line = { text: string; y: number; size: number; weight: number; color: string };
  const lines: Line[] = [];
  const dividers: number[] = [];
  let y = 64;
  function add(text: string, size: number, weight: number, color: string, gap: number, maxLines = 4) {
    context!.font = `${weight} ${size}px ${family}`;
    const value = Array.from(text.replace(/\s+/gu, " ").trim()).slice(0, 240).join("");
    const wrapped: string[] = [];
    let line = "";
    for (const word of value.split(" ")) {
      if (context!.measureText(line ? `${line} ${word}` : word).width <= contentWidth) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) { wrapped.push(line); line = ""; }
      for (const { segment } of new Intl.Segmenter("es", { granularity: "grapheme" }).segment(word)) {
        if (line && context!.measureText(line + segment).width > contentWidth) { wrapped.push(line); line = ""; }
        line += segment;
      }
    }
    if (line) wrapped.push(line);
    const visible = wrapped.slice(0, maxLines);
    if (wrapped.length > maxLines) {
      let last = visible.at(-1) || "";
      while (last && context!.measureText(`${last}…`).width > contentWidth) last = Array.from(last).slice(0, -1).join("");
      visible[maxLines - 1] = `${last}…`;
    }
    for (const text of visible) { lines.push({ text, y, size, weight, color }); y += size * 1.3; }
    y += gap;
  }
  function divider() { dividers.push(y); y += 40; }

  add("sarinbot", 34, 700, "#315ff3", 42);
  add("Cita confirmada", 60, 700, "#162344", 20);
  add(details.businessName, 52, 600, "#315ff3", 34);
  divider();
  add("SERVICIO", 27, 600, "#52617d", 8);
  add(details.serviceName, 44, 600, "#162344", 34);
  add("FECHA", 27, 600, "#52617d", 8);
  add(dateFormat.format(details.startAt), 44, 600, "#162344", 34);
  add("HORA · COLOMBIA", 27, 600, "#52617d", 8);
  add(`${timeFormat.format(details.startAt)}–${timeFormat.format(details.endAt)}`, 68, 700, "#162344", 34);
  if (details.resourceName) {
    add("PROFESIONAL O ESTACIÓN", 27, 600, "#52617d", 8);
    add(details.resourceName, 40, 600, "#162344", 34);
  }
  divider();
  add("Consulta Mis citas para ver cambios o cancelaciones.", 30, 400, "#52617d", 18);
  add(`Generada el ${dateFormat.format(details.generatedAt)} a las ${timeFormat.format(details.generatedAt)} (Colombia).`, 26, 400, "#52617d", 0);

  canvas.height = Math.ceil(y + 64);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#315ff3";
  context.fillRect(0, 0, canvas.width, 12);
  context.strokeStyle = "#e0e6f1";
  context.lineWidth = 2;
  for (const lineY of dividers) {
    context.beginPath(); context.moveTo(padding, lineY); context.lineTo(canvas.width - padding, lineY); context.stroke();
  }
  context.textBaseline = "top";
  for (const line of lines) {
    context.font = `${line.weight} ${line.size}px ${family}`;
    context.fillStyle = line.color;
    context.fillText(line.text, padding, line.y);
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(imageError)), "image/png"));
}
