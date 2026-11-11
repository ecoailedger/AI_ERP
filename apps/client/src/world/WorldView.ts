/**
 * The world renderer: an isometric map drawn with PixiJS.
 * It draws what the scene package describes and reports what the pointer is over. It decides nothing.
 */
import type { BuildingId, RecordRef, WorldState } from '@ai-erp/domain';
import {
  buildFrame,
  buildSchedules,
  BUILDINGS,
  depthOf,
  DOCK,
  LOADING,
  MAP_SIZE,
  PORT_RADIUS,
  screenToTile,
  SETTLEMENT_ORIGIN,
  SETTLEMENT_SIZE,
  staffBuildings,
  STALLED_SLOTS,
  TILE_HEIGHT,
  TILE_WIDTH,
  tileToScreen,
  workerPose,
  YARD,
  type Layout,
  type Rect,
  type SceneFrame,
  type Staffing,
  type Tile,
  type WorkerSchedule,
  type WorkerTask,
} from '@ai-erp/scene';
import { Application, Container, Graphics, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import { Art, drawBuilding, type Tex } from './art';
import { hoursAndMinutes } from '../format';
import { mix, PALETTE, partyColour } from './palette';

export type PickTarget =
  | { kind: 'records'; refs: RecordRef[]; note: string | null }
  | { kind: 'building'; id: BuildingId }
  | { kind: 'task'; task: WorkerTask };

export interface HoverInfo {
  x: number;
  y: number;
  lines: string[];
}

export interface WorldCallbacks {
  onPick(target: PickTarget | null): void;
  onHover(info: HoverInfo | null): void;
  /** Called every frame with the seconds since the last one. */
  onTick(deltaSeconds: number): void;
  /** How far through the day it is, 0 to 1. */
  fraction(): number;
}

interface Drawable {
  key: string;
  tex: Tex;
  x: number;
  y: number;
  z: number;
  scale?: number;
  flip?: boolean;
  tint?: number;
  alpha?: number;
}

type LabelStyle = 'name' | 'place' | 'alert' | 'badge' | 'ground';

interface LabelSpec {
  key: string;
  text: string;
  x: number;
  y: number;
  style: LabelStyle;
}

interface Pickable {
  x: number;
  y: number;
  radius: number;
  z: number;
  target: PickTarget;
  lines: string[];
}

const STYLES: Record<LabelStyle, { text: TextStyleOptions; background: number | null }> = {
  name: { text: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xfdf7e6 }, background: 0x1f1a14 },
  place: { text: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 11, fontWeight: '600', fill: 0xf1ead6 }, background: 0x1f1a14 },
  alert: { text: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 12, fontWeight: '700', fill: 0xffffff }, background: PALETTE.late },
  badge: { text: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 11, fontWeight: '700', fill: 0x1f1a14 }, background: 0xfdf7e6 },
  ground: { text: { fontFamily: 'system-ui, Segoe UI, sans-serif', fontSize: 12, fontWeight: '700', fill: 0xfdf7e6 }, background: null },
};

/** How many late suppliers are named on the map when the camera is far out. */
const NAMED_LATE_PORTS = 8;

/** Workers are drawn once the camera is at least this close. */
const WORKER_ZOOM = 0.42;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const at = (tile: Tile): { x: number; y: number } => tileToScreen(tile.col, tile.row);

function diamond(g: Graphics, rect: Rect, colour: number, alpha = 1): void {
  const a = tileToScreen(rect.col, rect.row);
  const b = tileToScreen(rect.col + rect.w, rect.row);
  const c = tileToScreen(rect.col + rect.w, rect.row + rect.h);
  const d = tileToScreen(rect.col, rect.row + rect.h);
  g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill({ color: colour, alpha });
}

function outline(g: Graphics, rect: Rect, colour: number, width: number): void {
  const a = tileToScreen(rect.col, rect.row);
  const b = tileToScreen(rect.col + rect.w, rect.row);
  const c = tileToScreen(rect.col + rect.w, rect.row + rect.h);
  const d = tileToScreen(rect.col, rect.row + rect.h);
  g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).stroke({ color: colour, width, alpha: 0.9 });
}

/** Keeps one sprite per key alive between frames, so nothing is rebuilt that has not changed. */
class SpritePool {
  private readonly sprites = new Map<string, { sprite: Sprite; seen: number }>();
  private generation = 0;

  constructor(private readonly parent: Container) {}

  sync(drawables: readonly Drawable[]): void {
    this.generation += 1;
    for (const drawable of drawables) {
      let entry = this.sprites.get(drawable.key);
      if (!entry) {
        entry = { sprite: new Sprite(), seen: 0 };
        this.sprites.set(drawable.key, entry);
        this.parent.addChild(entry.sprite);
      }
      const { sprite } = entry;
      entry.seen = this.generation;
      if (sprite.texture !== drawable.tex.texture) sprite.texture = drawable.tex.texture;
      sprite.anchor.set(drawable.tex.ax, drawable.tex.ay);
      sprite.position.set(drawable.x, drawable.y);
      const scale = drawable.scale ?? 1;
      sprite.scale.set(drawable.flip ? -scale : scale, scale);
      sprite.tint = drawable.tint ?? 0xffffff;
      sprite.alpha = drawable.alpha ?? 1;
      sprite.zIndex = drawable.z;
    }
    for (const [key, entry] of this.sprites) {
      if (entry.seen === this.generation) continue;
      entry.sprite.destroy();
      this.sprites.delete(key);
    }
  }
}

/** Text labels that stay the same size on screen however far the camera is zoomed. */
class LabelPool {
  private readonly labels = new Map<string, { box: Container; text: Text; plate: Graphics; shown: string; style: LabelStyle; seen: number }>();
  private generation = 0;

  constructor(private readonly parent: Container) {}

  sync(specs: readonly LabelSpec[], zoom: number): void {
    this.generation += 1;
    for (const spec of specs) {
      let entry = this.labels.get(spec.key);
      if (!entry) {
        const box = new Container();
        const plate = new Graphics();
        const text = new Text({ text: '', style: STYLES[spec.style].text });
        text.resolution = 2;
        text.anchor.set(0.5, 0.5);
        box.addChild(plate, text);
        this.parent.addChild(box);
        entry = { box, text, plate, shown: '', style: spec.style, seen: 0 };
        this.labels.set(spec.key, entry);
      }
      entry.seen = this.generation;
      if (entry.shown !== spec.text || entry.style !== spec.style) {
        const style = STYLES[spec.style];
        entry.text.style = style.text;
        entry.text.text = spec.text;
        entry.plate.clear();
        if (style.background !== null) {
          const w = entry.text.width + 12;
          const h = entry.text.height + 5;
          entry.plate.roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: style.background, alpha: spec.style === 'place' ? 0.72 : 0.92 });
        }
        entry.shown = spec.text;
        entry.style = spec.style;
      }
      entry.box.position.set(spec.x, spec.y);
      entry.box.scale.set(1 / zoom);
    }
    for (const [key, entry] of this.labels) {
      if (entry.seen === this.generation) continue;
      entry.box.destroy({ children: true });
      this.labels.delete(key);
    }
  }
}

export class WorldView {
  private readonly app = new Application();
  private readonly camera = new Container();
  private readonly ground = new Graphics();
  private readonly objects = new Container();
  private readonly labelLayer = new Container();
  private art: Art | null = null;
  private sprites: SpritePool | null = null;
  private labels: LabelPool | null = null;

  private layout: Layout | null = null;
  private world: WorldState | null = null;
  private frame: SceneFrame | null = null;
  private frameFraction = -1;
  private staffing: Staffing[] = [];
  private schedules: WorkerSchedule[] = [];
  private pickables: Pickable[] = [];
  private workSeconds = 0;

  private zoom = 0.3;
  private minZoom = 0.15;
  private flight: { x: number; y: number; zoom: number } | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private ready = false;
  private destroyed = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: WorldCallbacks,
  ) {}

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      background: PALETTE.void,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.ready = true;
    this.host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.camera.addChild(this.ground, this.objects, this.labelLayer);
    this.app.stage.addChild(this.camera);
    this.art = new Art(this.app.renderer);
    this.sprites = new SpritePool(this.objects);
    this.labels = new LabelPool(this.labelLayer);
    this.bindInput();
    this.fitWorld();
    this.app.ticker.add((ticker) => this.update(ticker.deltaMS / 1000));
    if (this.layout) this.drawStatic(this.layout);
  }

  destroy(): void {
    this.destroyed = true;
    for (const undo of this.cleanup) undo();
    if (this.ready) this.app.destroy(true, { children: true });
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
    if (this.ready) this.drawStatic(layout);
  }

  setWorld(world: WorldState): void {
    this.world = world;
    this.frame = null;
    if (!this.layout) return;
    this.staffing = staffBuildings(this.layout, world);
    this.schedules = buildSchedules(this.staffing);
  }

  /** Glides the camera to a tile, zooming in close enough to see what is there. */
  flyTo(tile: Tile, zoom = Math.max(this.zoom, 0.85)): void {
    const point = at(tile);
    this.flight = { x: point.x, y: point.y, zoom };
  }

  // ---- Camera

  private fitWorld(): void {
    const { width, height } = this.app.screen;
    // Fit the outer ring of ports, leaving room for the HUD at the top and bottom.
    const reach = (PORT_RADIUS + 5) * Math.SQRT2;
    const fit = Math.min(width / (reach * TILE_WIDTH), (height - 190) / (reach * TILE_HEIGHT)) * 0.94;
    this.minZoom = clamp(fit * 0.8, 0.08, 0.5);
    this.zoom = clamp(fit, this.minZoom, 2.4);
    const centre = tileToScreen(MAP_SIZE / 2, MAP_SIZE / 2);
    this.camera.scale.set(this.zoom);
    this.camera.position.set(width / 2 - centre.x * this.zoom, height / 2 + 10 - centre.y * this.zoom);
  }

  private zoomAt(screenX: number, screenY: number, factor: number): void {
    const next = clamp(this.zoom * factor, this.minZoom, 2.4);
    const worldX = (screenX - this.camera.x) / this.zoom;
    const worldY = (screenY - this.camera.y) / this.zoom;
    this.zoom = next;
    this.camera.scale.set(next);
    this.camera.position.set(screenX - worldX * next, screenY - worldY * next);
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
    };
    const local = (event: MouseEvent): { x: number; y: number } => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    listen(canvas, 'wheel', (event) => {
      event.preventDefault();
      this.flight = null;
      const point = local(event);
      this.zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.0015));
    }, { passive: false });

    listen(canvas, 'pointerdown', (event) => {
      this.drag = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });

    listen(canvas, 'pointermove', (event) => {
      if (this.drag) {
        const dx = event.clientX - this.drag.x;
        const dy = event.clientY - this.drag.y;
        if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
        this.drag = { x: event.clientX, y: event.clientY, moved: true };
        this.flight = null;
        this.camera.position.set(this.camera.x + dx, this.camera.y + dy);
        this.callbacks.onHover(null);
        return;
      }
      const point = local(event);
      const hit = this.pick(point.x, point.y);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      this.callbacks.onHover(hit ? { x: event.clientX, y: event.clientY, lines: hit.lines } : null);
    });

    listen(canvas, 'pointerup', (event) => {
      const drag = this.drag;
      this.drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!drag || drag.moved) return;
      const point = local(event);
      this.callbacks.onPick(this.pick(point.x, point.y)?.target ?? null);
    });

    listen(canvas, 'pointerleave', () => this.callbacks.onHover(null));
  }

  /** The topmost thing under a screen point. */
  private pick(screenX: number, screenY: number): Pickable | null {
    const x = (screenX - this.camera.x) / this.zoom;
    const y = (screenY - this.camera.y) / this.zoom;
    let best: Pickable | null = null;
    for (const candidate of this.pickables) {
      if (Math.hypot(candidate.x - x, candidate.y - y) > candidate.radius) continue;
      if (!best || candidate.z > best.z) best = candidate;
    }
    if (best) return best;

    const tile = screenToTile(x, y);
    for (const place of Object.values(BUILDINGS)) {
      const { rect } = place;
      // The walls stand above the footprint, so allow for their height.
      const lifted = screenToTile(x, y + place.height * 0.6);
      const inside = (t: Tile): boolean => t.col >= rect.col && t.col < rect.col + rect.w && t.row >= rect.row && t.row < rect.row + rect.h;
      if (!inside(tile) && !inside(lifted)) continue;
      const staff = this.staffing.find((entry) => entry.building === place.id);
      const queue = this.world?.buildings.find((building) => building.id === place.id)?.queue.length ?? 0;
      return {
        x,
        y,
        radius: 0,
        z: 0,
        target: { kind: 'building', id: place.id },
        lines: [
          place.label,
          `${queue} ${queue === 1 ? 'job' : 'jobs'}, ${staff?.workers ?? 0} at work`,
          ...(staff && staff.backlog > 0 ? [`${staff.backlog} more than it can handle`] : []),
        ],
      };
    }
    return null;
  }

  // ---- Static world: drawn once

  private drawStatic(layout: Layout): void {
    const g = this.ground;
    g.clear();
    const whole: Rect = { col: 0, row: 0, w: MAP_SIZE, h: MAP_SIZE };
    diamond(g, { col: -1.5, row: -1.5, w: MAP_SIZE + 3, h: MAP_SIZE + 3 }, 0x2a3b2c);
    diamond(g, whole, PALETTE.grass);
    // Broad patches of lighter and darker ground. Tone only: nothing here stands for anything.
    for (let i = 0; i < 90; i++) {
      const col = ((i * 37.7) % (MAP_SIZE - 14)) + 1;
      const row = ((i * 61.3) % (MAP_SIZE - 14)) + 1;
      const size = 5 + ((i * 7) % 9);
      diamond(g, { col, row, w: size, h: size * 0.8 }, i % 2 === 0 ? PALETTE.grassLight : PALETTE.grassDark, 0.5);
    }

    for (const key of layout.roadTiles) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      diamond(g, { col: col - 0.03, row: row - 0.03, w: 1.06, h: 1.06 }, PALETTE.road);
    }
    for (const slot of STALLED_SLOTS) diamond(g, { col: slot.col - 0.03, row: slot.row - 0.03, w: 1.06, h: 1.06 }, PALETTE.layby);

    const site: Rect = { col: SETTLEMENT_ORIGIN, row: SETTLEMENT_ORIGIN, w: SETTLEMENT_SIZE, h: SETTLEMENT_SIZE };
    diamond(g, { col: site.col - 0.4, row: site.row - 0.4, w: site.w + 0.8, h: site.h + 0.8 }, PALETTE.roadEdge);
    diamond(g, site, PALETTE.perimeter);
    diamond(g, { col: site.col + 1, row: site.row + 1, w: site.w - 2, h: site.h - 2 }, PALETTE.paving);
    for (let i = 2; i < SETTLEMENT_SIZE - 1; i += 2) {
      const a = tileToScreen(site.col + i, site.row + 1);
      const b = tileToScreen(site.col + i, site.row + site.h - 1);
      const c = tileToScreen(site.col + 1, site.row + i);
      const d = tileToScreen(site.col + site.w - 1, site.row + i);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).moveTo(c.x, c.y).lineTo(d.x, d.y).stroke({ color: PALETTE.pavingLine, width: 1, alpha: 0.45 });
    }
    diamond(g, YARD, PALETTE.yard);
    for (const plot of layout.plots) {
      diamond(g, plot.rect, PALETTE.plot);
      outline(g, plot.rect, PALETTE.plotLine, 2);
    }
    for (const bay of [DOCK, LOADING]) {
      diamond(g, bay, PALETTE.dock);
      outline(g, bay, PALETTE.dockLine, 2.5);
    }

    // Buildings stand in the object layer so workers and vehicles pass in front of and behind them.
    for (const child of this.objects.children.filter((candidate) => candidate.label === 'building')) child.destroy();
    for (const place of Object.values(BUILDINGS)) {
      const building = new Graphics();
      building.label = 'building';
      drawBuilding(building, place);
      building.zIndex = depthOf(place.rect.col + place.rect.w, place.rect.row + place.rect.h) - 0.6;
      this.objects.addChild(building);
    }
  }

  // ---- Every frame

  private update(deltaSeconds: number): void {
    this.callbacks.onTick(deltaSeconds);
    this.workSeconds += deltaSeconds;
    this.fly(deltaSeconds);
    const { layout, world, art, sprites, labels } = this;
    if (!layout || !world || !art || !sprites || !labels) return;

    const fraction = this.callbacks.fraction();
    if (!this.frame || fraction !== this.frameFraction) {
      this.frame = buildFrame(layout, world, fraction);
      this.frameFraction = fraction;
    }
    const { drawables, specs, pickables } = this.compose(layout, world, this.frame, art);
    sprites.sync(drawables);
    labels.sync(specs, this.zoom);
    this.pickables = pickables;
  }

  private fly(deltaSeconds: number): void {
    if (!this.flight) return;
    const { width, height } = this.app.screen;
    const ease = 1 - Math.exp(-deltaSeconds * 5);
    this.zoom += (this.flight.zoom - this.zoom) * ease;
    const targetX = width / 2 - this.flight.x * this.zoom;
    const targetY = height / 2 - this.flight.y * this.zoom;
    this.camera.scale.set(this.zoom);
    this.camera.position.set(this.camera.x + (targetX - this.camera.x) * ease, this.camera.y + (targetY - this.camera.y) * ease);
    if (Math.abs(targetX - this.camera.x) < 0.5 && Math.abs(targetY - this.camera.y) < 0.5 && Math.abs(this.flight.zoom - this.zoom) < 0.005) {
      this.flight = null;
    }
  }

  /** Turns the scene description into sprites, labels and things the pointer can hit. */
  private compose(layout: Layout, world: WorldState, frame: SceneFrame, art: Art): { drawables: Drawable[]; specs: LabelSpec[]; pickables: Pickable[] } {
    const drawables: Drawable[] = [];
    const specs: LabelSpec[] = [];
    const pickables: Pickable[] = [];
    const zoom = this.zoom;
    // Small things are drawn larger when the camera is far out, so they can still be seen.
    const boost = clamp(0.6 / zoom, 1, 3);
    const close = zoom >= 0.5;

    // Suppliers
    const portState = new Map(frame.ports.map((port) => [port.key, port]));
    // From far out, only the worst offenders are named. The rest show their late count alone.
    const named = new Set(
      [...frame.ports]
        .filter((port) => port.lateCount > 0)
        .sort((a, b) => b.lateCount - a.lateCount || b.worstDaysLate - a.worstDaysLate)
        .slice(0, NAMED_LATE_PORTS)
        .map((port) => port.key),
    );
    for (const port of layout.ports) {
      const sprite = portState.get(port.key);
      if (!sprite) continue;
      // A depot shared by small suppliers is drawn in a plain colour: it belongs to none of them.
      const colour = sprite.supplierId !== null ? partyColour(sprite.supplierId) : 0x9a968a;
      const centre = at({ col: port.tile.col + 0.5, row: port.tile.row + 0.5 });
      const z = depthOf(port.tile.col + 3, port.tile.row + 3);
      drawables.push({ key: `port:${port.key}`, tex: art.port(colour, sprite.containers), ...centre, z });
      if (sprite.fogged) drawables.push({ key: `fog:port:${port.key}`, tex: art.fog(), x: centre.x, y: centre.y - 20, z: z + 0.2, scale: 1.5 });
      pickables.push({
        ...centre,
        y: centre.y - 14,
        radius: 92,
        z: 1,
        target: {
          kind: 'records',
          refs: port.supplierIds.map((id) => ({ type: 'supplier' as const, id })),
          note: sprite.fogged ? sprite.fogReason : port.shared ? sprite.label : null,
        },
        lines: sprite.fogged ? [sprite.label, sprite.fogReason] : [sprite.label],
      });
      if (sprite.lateCount > 0) {
        specs.push({
          key: `port:${port.key}`,
          text: close || named.has(port.key) ? `${port.name}: ${sprite.lateCount} late` : String(sprite.lateCount),
          x: centre.x,
          y: centre.y - 96 - 14 / zoom,
          style: 'alert',
        });
      } else if (close) {
        specs.push({ key: `port:${port.key}`, text: port.name, x: centre.x, y: centre.y - 96 - 12 / zoom, style: 'place' });
      }
    }

    // Customers
    const villageState = new Map(frame.villages.map((village) => [village.customerId, village]));
    for (const village of layout.villages) {
      const sprite = villageState.get(village.customerId);
      if (!sprite) continue;
      const centre = at({ col: village.tile.col + 0.5, row: village.tile.row + 0.5 });
      const status = sprite.onStop ? 'onStop' : sprite.overLimit ? 'overLimit' : 'ok';
      drawables.push({
        key: `village:${village.customerId}`,
        tex: art.village(partyColour(village.customerId, 0.42), sprite.houses, status),
        ...centre,
        z: depthOf(village.tile.col + 2.8, village.tile.row + 2.8),
      });
      pickables.push({
        ...centre,
        radius: 80,
        z: 1,
        target: { kind: 'records', refs: [{ type: 'customer', id: village.customerId }], note: null },
        lines: [sprite.label],
      });
      if (sprite.onStop) {
        specs.push({ key: `village:${village.customerId}`, text: `${village.name}: on stop`, x: centre.x, y: centre.y - 64 - 14 / zoom, style: 'alert' });
      } else if (zoom >= 0.62) {
        specs.push({ key: `village:${village.customerId}`, text: village.name, x: centre.x, y: centre.y - 64 - 12 / zoom, style: 'place' });
      }
    }
    for (const hamlet of layout.hamlets) {
      const sprite = frame.hamlets[hamlet.index];
      if (!sprite || sprite.customerCount === 0) continue;
      const centre = at({ col: hamlet.tile.col + 0.5, row: hamlet.tile.row + 0.5 });
      drawables.push({
        key: `hamlet:${hamlet.index}`,
        tex: art.hamlet(sprite.houses, sprite.onStopCount > 0),
        ...centre,
        z: depthOf(hamlet.tile.col + 2.3, hamlet.tile.row + 2.3),
      });
      pickables.push({
        ...centre,
        radius: 62,
        z: 1,
        target: { kind: 'records', refs: hamlet.customerIds.map((id) => ({ type: 'customer' as const, id })), note: sprite.label },
        lines: [sprite.label],
      });
      if (zoom >= 0.62) specs.push({ key: `hamlet:${hamlet.index}`, text: `${sprite.customerCount} small customers`, x: centre.x, y: centre.y - 48 - 12 / zoom, style: 'place' });
    }

    // Stock
    const pileState = new Map(frame.piles.map((pile) => [pile.categoryId, pile]));
    for (const plot of layout.plots) {
      const pile = pileState.get(plot.categoryId);
      if (!pile) continue;
      const corner = at(plot.rect);
      const centre = at({ col: plot.rect.col + 1, row: plot.rect.row + 1 });
      const z = depthOf(plot.rect.col + 2, plot.rect.row + 2) - 0.4;
      if (pile.crates > 0) {
        drawables.push({ key: `pile:${plot.categoryId}`, tex: art.pile(pile.crates, pile.ageBand, partyColour(plot.categoryId, 0.48)), ...corner, z });
      }
      if (pile.fogged) drawables.push({ key: `fog:${plot.categoryId}`, tex: art.fog(), x: centre.x, y: centre.y - 12, z: z + 0.2 });
      pickables.push({
        x: centre.x,
        y: centre.y - 12,
        radius: 58,
        z: 2,
        target: { kind: 'records', refs: [{ type: 'category', id: plot.categoryId }], note: pile.fogged ? pile.fogReason : null },
        lines: pile.fogged ? [pile.label, pile.fogReason] : [pile.label],
      });
      if (pile.fogged) {
        specs.push({ key: `pile:${plot.categoryId}`, text: `${plot.name}: untrusted`, x: centre.x, y: centre.y - 64 - 12 / zoom, style: 'alert' });
      } else if (zoom >= 1) {
        specs.push({ key: `pile:${plot.categoryId}`, text: plot.name, x: centre.x, y: centre.y + 40, style: 'place' });
      }
    }

    for (const pallet of frame.pallets) {
      const point = at(pallet);
      drawables.push({ key: pallet.key, tex: art.pallet(pallet.stale), ...point, z: depthOf(pallet.col, pallet.row) });
      pickables.push({ x: point.x, y: point.y - 8, radius: 16, z: 3, target: { kind: 'records', refs: [pallet.ref], note: null }, lines: [pallet.label] });
    }

    // Vehicles
    let stalledCount = 0;
    for (const vehicle of frame.vehicles) {
      const point = at(vehicle);
      let tex: Tex;
      if (vehicle.kind === 'lorry') tex = art.lorry(vehicle.heading, partyColour(vehicle.partyId));
      else if (vehicle.kind === 'van') tex = art.van(vehicle.heading, partyColour(vehicle.partyId, 0.42));
      else if (vehicle.kind === 'cart') tex = art.cart();
      else tex = art.letter();

      let tint = 0xffffff;
      let alpha = 1;
      if (vehicle.state === 'stalled') {
        stalledCount += 1;
        // The longer it has been late, the deeper the red.
        tint = mix(0xffc9bd, 0xe0452e, clamp(vehicle.daysLate / 21, 0, 1));
      } else if (vehicle.state === 'waiting') {
        tint = 0xa9a9a9;
        alpha = 0.85;
      } else if (vehicle.state === 'parked') {
        tint = 0xffb3a3;
      }
      const scale = vehicle.kind === 'cart' || vehicle.kind === 'letter' ? boost * 1.15 : boost;
      drawables.push({ key: vehicle.key, tex, ...point, z: depthOf(vehicle.col, vehicle.row) + 0.1, scale, tint, alpha });
      pickables.push({
        x: point.x,
        y: point.y - 8 * scale,
        radius: 20 * scale,
        z: 4,
        target: { kind: 'records', refs: vehicle.refs, note: vehicle.label },
        lines: [vehicle.label],
      });
      if (vehicle.refs.length > 1 && vehicle.kind !== 'cart' && vehicle.kind !== 'letter') {
        specs.push({ key: `count:${vehicle.key}`, text: String(vehicle.refs.length), x: point.x + 14 * scale, y: point.y - 22 * scale, style: 'badge' });
      }
      if (vehicle.state === 'parked' || (vehicle.state === 'waiting' && vehicle.late)) {
        drawables.push({ key: `mark:${vehicle.key}`, tex: art.marker(PALETTE.late), x: point.x, y: point.y - 24 * scale, z: depthOf(vehicle.col, vehicle.row) + 0.2, scale: 1 / zoom / 1.6 });
      }
    }
    const firstSlot = STALLED_SLOTS[0];
    if (firstSlot) {
      const anchor = at({ col: firstSlot.col + 0.5, row: firstSlot.row - 1.2 });
      const total = stalledCount + frame.stalledOverflow;
      specs.push({
        key: 'stalled',
        text: total > 0 ? `${total} late ${total === 1 ? 'lorry' : 'lorries'}` : 'No late lorries',
        x: anchor.x,
        y: anchor.y - 10 / zoom,
        style: total > 0 ? 'alert' : 'place',
      });
    }

    // Buildings, their workers and their backlog
    for (const place of Object.values(BUILDINGS)) {
      const staff = this.staffing.find((entry) => entry.building === place.id);
      const queue = world.buildings.find((building) => building.id === place.id)?.queue.length ?? 0;
      const roof = at({ col: place.rect.col + place.rect.w / 2, row: place.rect.row + place.rect.h / 2 });
      specs.push({
        key: `building:${place.id}`,
        // Workers are too small to draw from far out, so the label carries the headcount instead.
        text: zoom >= WORKER_ZOOM || !staff || staff.workers === 0 ? `${place.label}  ${queue}` : `${place.label}  ${queue} jobs, ${staff.workers} at work`,
        x: roof.x,
        y: roof.y - place.height - 30 - 12 / zoom,
        style: 'name',
      });
      if (staff && staff.backlog > 0) {
        const point = at({ col: place.backlog.col + 0.5, row: place.backlog.row + 0.5 });
        const tier = staff.backlog > 40 ? 3 : staff.backlog > 10 ? 2 : 1;
        drawables.push({ key: `backlog:${place.id}`, tex: art.backlog(tier), ...point, z: depthOf(place.backlog.col + 0.5, place.backlog.row + 0.5), scale: clamp(boost, 1, 1.8) });
        specs.push({ key: `backlog:${place.id}`, text: `${staff.backlog} waiting`, x: point.x, y: point.y - 52 - 10 / zoom, style: 'alert' });
        pickables.push({
          x: point.x,
          y: point.y - 12,
          radius: 22,
          z: 3,
          target: { kind: 'building', id: place.id },
          lines: [`${place.label}: ${staff.backlog} jobs more than it can handle`],
        });
      }
    }

    if (zoom >= WORKER_ZOOM) {
      const personById = new Map(world.people.map((person) => [person.id, person]));
      for (const schedule of this.schedules) {
        const pose = workerPose(schedule, this.workSeconds);
        const person = pose.personId === null ? undefined : personById.get(pose.personId);
        const point = at(pose);
        const step: 0 | 1 = pose.stride < 0.5 ? 0 : 1;
        const scale = clamp(0.9 / zoom, 1, 1.7);
        drawables.push({
          key: `worker:${pose.key}`,
          tex: art.worker(pose.building, pose.phase, step),
          x: point.x,
          y: point.y - (pose.phase === 'work' ? 0 : step),
          z: depthOf(pose.col, pose.row) + 0.05,
          scale,
          flip: pose.facing < 0,
        });
        pickables.push({
          x: point.x,
          y: point.y - 11 * scale,
          radius: 13 * scale,
          z: 5,
          // An avatar that is a person opens that person. A pool worker opens the job it is on.
          target: person
            ? { kind: 'records', refs: [{ type: 'person', id: person.id }], note: `On this now: ${pose.task.label}` }
            : { kind: 'task', task: pose.task },
          lines: person
            ? [
                person.name,
                pose.task.label,
                `${hoursAndMinutes(person.minutes)} of work today, in a ${hoursAndMinutes(person.capacityMinutes)} day`,
              ]
            : [pose.task.label, pose.task.detail],
        });
        if (person?.overCapacity) {
          drawables.push({ key: `over:${pose.key}`, tex: art.marker(PALETTE.late), x: point.x, y: point.y - 26 * scale, z: depthOf(pose.col, pose.row) + 0.06, scale: 0.55 * scale });
        }
      }
    }

    return { drawables, specs, pickables };
  }
}
