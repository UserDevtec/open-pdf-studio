# Clean Vector Render Engine — From Scratch

## Doel

Vervang de huidige 4-path render architectuur door één unified render loop gebaseerd op Open2D Studio's patroon: vast canvas op viewport grootte, transform matrix voor zoom/pan, continuous RAF loop met dirty flag. Resultaat: 100+ fps zoom/pan zonder debounce, CSS-hacks, of canvas resizing.

## Wat wordt verwijderd

Alle bestaande zoom/render logica in deze bestanden wordt vervangen:

- **`js/pdf/renderer.js`**: De hele `renderPage()` functie wordt herschreven. De 4 render paths (vector, Rust bitmap, PDF.js, continuous) worden vervangen door 1 unified path.
- **`js/ui/setup/navigation-events.js`**: De hele `setupWheelZoom()` wordt herschreven. De 3 zoom strategieën (CSS-scale + vector debounce, CSS-scale + bitmap debounce, page nav) worden vervangen door 1 pure data update.

## Wat blijft

- `open-pdf-render` Rust crate (draw command extractie via `extract_draw_commands`)
- `js/pdf/vector-renderer.js` (command playback functie `renderVectorPage`)
- PDF.js (tekst selectie, zoeken, form fields, annotatie parsing)
- `js/annotations/rendering.js` (annotatie overlay)
- `pdf-lib` (PDF opslaan)

## Architectuur

### Viewport State

```javascript
// Eén object dat de hele view bepaalt — geen doc.scale, geen CSS hacks
const viewport = {
  zoom: 1.0,        // Zoom factor (0.1 tot 10.0)
  offsetX: 0,       // Pixel offset in screen space
  offsetY: 0,       // Pixel offset in screen space
  pageW: 0,         // PDF pagina breedte in punten
  pageH: 0,         // PDF pagina hoogte in punten
  dirty: true,      // Trigger voor re-render
};
```

### Canvas Setup

```javascript
// Canvas = viewport grootte, VERANDERT NOOIT bij zoom/pan
const canvas = document.getElementById('pdf-canvas');
canvas.width = container.clientWidth;
canvas.height = container.clientHeight;
// Resize ALLEEN bij window resize event
window.addEventListener('resize', () => {
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  viewport.dirty = true;
});
```

### Render Functie

```javascript
function render() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  // Viewport transform: zoom + pan
  ctx.setTransform(
    viewport.zoom, 0,
    0, viewport.zoom,
    viewport.offsetX, viewport.offsetY
  );

  // PDF Y-flip (origin bottom-left → top-left)
  ctx.transform(1, 0, 0, -1, 0, viewport.pageH);

  // Witte achtergrond in PDF-space
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.pageW, viewport.pageH);

  // Speel vector draw commands af
  renderVectorPage(ctx, commands);

  ctx.restore();

  // Annotatie overlay (apart canvas, zelfde viewport transform)
  renderAnnotations(viewport);
}
```

### Render Loop

```javascript
function tick() {
  if (viewport.dirty) {
    viewport.dirty = false;
    render();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

### Zoom Handler

```javascript
canvas.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return; // Alleen zoom met Ctrl
  e.preventDefault();

  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(0.1, Math.min(10, viewport.zoom * factor));

  // Zoom naar cursor positie (wereld-coördinaat onder muis blijft vast)
  const wx = (e.offsetX - viewport.offsetX) / viewport.zoom;
  const wy = (e.offsetY - viewport.offsetY) / viewport.zoom;
  viewport.offsetX = e.offsetX - wx * newZoom;
  viewport.offsetY = e.offsetY - wy * newZoom;
  viewport.zoom = newZoom;
  viewport.dirty = true;
});
```

### Pan Handler

```javascript
let isPanning = false, panStartX = 0, panStartY = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1 || (e.button === 0 && state.currentTool === 'hand')) {
    isPanning = true;
    panStartX = e.clientX - viewport.offsetX;
    panStartY = e.clientY - viewport.offsetY;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!isPanning) return;
  viewport.offsetX = e.clientX - panStartX;
  viewport.offsetY = e.clientY - panStartY;
  viewport.dirty = true;
});

canvas.addEventListener('pointerup', () => { isPanning = false; });
```

## Bestanden

| Bestand | Actie | Beschrijving |
|---------|-------|-------------|
| `js/pdf/pdf-viewport.js` | **NIEUW** | Viewport state + render loop + zoom/pan handlers |
| `js/pdf/renderer.js` | **HERSCHRIJF** | Simpele wrapper: laad commands via Rust, start render loop |
| `js/ui/setup/navigation-events.js` | **VEREENVOUDIG** | Verwijder alle zoom logica, delegeer aan pdf-viewport.js |
| `js/pdf/vector-renderer.js` | **BEHOUD** | renderVectorPage() command playback — ongewijzigd |
| `js/annotations/rendering.js` | **KLEINE WIJZIGING** | Gebruik viewport transform i.p.v. doc.scale |

## Hoe PDF.js erbij past

PDF.js wordt NIET gebruikt voor rendering. Het wordt alleen gebruikt voor:
1. **Document laden**: `pdfDoc = await pdfjsLib.getDocument(bytes).promise`
2. **Tekst extractie**: `page.getTextContent()` voor zoeken en selectie
3. **Formulier velden**: Form layer rendering
4. **Annotatie parsing**: `page.getAnnotations()` bij het laden

De text/link/form layers worden EENMALIG aangemaakt bij het openen van een pagina, NIET bij elke zoom. Ze worden gepositioneerd via CSS transform die synchroon loopt met de viewport.

## Hoe Rust erbij past

Bij het openen van een PDF:
1. `invoke('analyze_page_type', { path, pageIndex })` → "vector" of "tile"
2. Als "vector": `invoke('extract_draw_commands', { path, pageIndex })` → binary commands
3. Commands worden gecached in `vector-renderer.js`
4. Render loop speelt commands af via Canvas2D — geen Rust meer nodig per frame

Bij "tile" pages (foto-PDF's): fallback naar PDF.js `page.render()` — EENMALIG, resultaat wordt als achtergrondbitmap op het canvas getekend.

## Wat er NIET meer is

- `doc.scale` als zoom mechanisme
- CSS `width`/`height` manipulatie voor zoom
- `_zoomBaseScale` tracking
- Debounce timers voor zoom
- Canvas resizing bij zoom
- `renderPageOffscreen()`
- Temp file IPC voor bitmap data
- `_skipBitmapRender` flag
- Meerdere render paths

## Performance Targets

| Actie | Target |
|-------|--------|
| Zoom (wheel event → pixels op scherm) | < 10ms (1 frame) |
| Pan (pointer move → pixels op scherm) | < 10ms (1 frame) |
| Canvas geheugen | Vast ~4MB (viewport grootte) |
| Eerste render na PDF open | < 200ms (command extractie + eerste frame) |
| Frame rate bij continu zoomen | 60+ fps |
