import { TILE_HEIGHT, TILE_WIDTH, tileToScreen } from '@ai-erp/scene';
import { Application, Graphics } from 'pixi.js';
import { useEffect, useRef } from 'react';

const GRID = 12;

/** Draws a small placeholder iso grid. The real renderer arrives in milestone 1.4. */
export function WorldCanvas() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const app = new Application();
    let ready = false;
    let cancelled = false;

    void app.init({ resizeTo: window, background: '#1b2a1f', antialias: true }).then(() => {
      ready = true;
      if (cancelled) {
        app.destroy(true);
        return;
      }
      element.appendChild(app.canvas);

      const grid = new Graphics();
      const halfW = TILE_WIDTH / 2;
      const halfH = TILE_HEIGHT / 2;
      for (let col = 0; col < GRID; col++) {
        for (let row = 0; row < GRID; row++) {
          const { x, y } = tileToScreen(col, row);
          grid
            .poly([x, y, x + halfW, y + halfH, x, y + TILE_HEIGHT, x - halfW, y + halfH])
            .fill((col + row) % 2 === 0 ? '#3f6b3a' : '#487a42')
            .stroke({ color: '#2c4a2b', width: 1 });
        }
      }
      app.stage.addChild(grid);

      const centre = () => {
        grid.x = app.screen.width / 2;
        grid.y = (app.screen.height - GRID * TILE_HEIGHT) / 2;
      };
      centre();
      app.renderer.on('resize', centre);
    });

    return () => {
      cancelled = true;
      if (ready) app.destroy(true);
    };
  }, []);

  return <div className="world" ref={host} />;
}
