import { Vec2, Point } from './webgpu_rendering';
import { Deeptable } from '../Deeptable';
import { Tile } from '../tile';

export class ShallowTable {
  private points: Point[] = [];
  private deeptable: Deeptable;
  private bounds: { min: Vec2; max: Vec2 } | null = null;

  constructor(deeptable: Deeptable) {
    this.deeptable = deeptable;
  }

  /**
   * Collects all points from the deeptable and calculates bounds
   */
  async collectPoints(): Promise<Point[]> {
    await this.deeptable.ready;
    this.points = [];

    // First pass: collect points and calculate bounds
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    this.deeptable.visit((tile: Tile) => {
      if (!tile.hasLoadedColumn('x') || !tile.hasLoadedColumn('y')) {
        return;
      }

      for (const row of tile.record_batch) {
        const x = row.x as number;
        const y = row.y as number;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);

        const point: Point = {
          position: new Vec2(x, y),
        };
        this.points.push(point);
      }
    });

    this.bounds = {
      min: new Vec2(minX, minY),
      max: new Vec2(maxX, maxY),
    };

    return this.points;
  }

  /**
   * Gets the bounds of all points
   */
  getBounds(): { min: Vec2; max: Vec2 } {
    if (!this.bounds) {
      throw new Error('Must call collectPoints first');
    }
    return this.bounds;
  }

  /**
   * Normalizes a single coordinate to NDC space (-1 to 1)
   */
  private normalizeCoordinate(value: number, min: number, max: number): number {
    // Convert to 0-1 range first
    const normalized = (value - min) / (max - min);
    // Convert to -1 to 1 range
    return normalized * 2 - 1;
  }

  /**
   * Gets all points as a Float32Array normalized to NDC coordinates
   * Returns array in format: [x1,y1,x2,y2,...] where each coordinate
   * is in the range -1 to 1 with (0,0) at center screen
   */
  getNormalizedPointsArray(): Float32Array {
    const array = new Float32Array(this.points.length * 2);
    console.log('Bounds:', this.bounds);

    this.points.forEach((point, i) => {
      const x = this.normalizeCoordinate(
        point.position.x,
        this.bounds!.min.x,
        this.bounds!.max.x,
      );
      const y = this.normalizeCoordinate(
        point.position.y,
        this.bounds!.min.y,
        this.bounds!.max.y,
      );

      array[i * 2] = x;
      array[i * 2 + 1] = y;
    });

    return array;
  }
}
