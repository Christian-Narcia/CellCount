/**
 * roiParser.js — ImageJ .roi binary parser (pure, DOM-free, testable).
 *
 * ImageJ ROIs have no native browser support, so we parse the binary format by
 * hand. All multi-byte fields are BIG-ENDIAN. Byte layout (per the project todo):
 *
 *   0-3    magic "Iout"  (0x49 0x6F 0x75 0x74) — validated first
 *   4-5    version            (uint16)
 *   6      ROI type           (uint8: 0=polygon,1=rect,2=oval,7=freehand, …)
 *   8-9    top                (int16, bounding box)
 *   10-11  left               (int16)
 *   12-13  bottom             (int16)
 *   14-15  right              (int16)
 *   16-17  n coordinates      (uint16)
 *   36-39  rotation (degrees) (float32, FLOAT_PARAM_1 — 0/NaN = none)
 *   64..   X coords           (n × int16, relative to `left`)
 *   64+2n  Y coords           (n × int16, relative to `top`)
 *
 * Absolute pixel coords: x = left + x_rel, y = top + y_rel.
 *
 * The parser always returns an ABSOLUTE polygon (closed area) so the rasteriser
 * can treat every supported type uniformly: polygon/freehand/traced use their
 * coordinate array; rectangle and oval are derived from the bounding box (the
 * oval is sampled into a fine polygon).
 */

const MAGIC = [0x49, 0x6f, 0x75, 0x74]; // "Iout"

// ImageJ ROI type codes.
const TYPE = Object.freeze({
  POLYGON: 0,
  RECT: 1,
  OVAL: 2,
  FREELINE: 4,
  POLYLINE: 5,
  FREEHAND: 7,
  TRACED: 8,
});

/** Human-readable name for a type code (for UI/status). */
export function roiTypeName(type) {
  return (
    {
      0: 'polygon',
      1: 'rectangle',
      2: 'oval',
      4: 'freeline',
      5: 'polyline',
      7: 'freehand',
      8: 'traced',
    }[type] || `type ${type}`
  );
}

/**
 * Parse an ImageJ .roi ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {{ type:number, version:number, bbox:{top:number,left:number,bottom:number,right:number}, n:number, rotation:number, polygon:Array<[number,number]> }}
 * @throws if the magic is missing or the type is unsupported
 */
export function parseRoi(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 64) throw new Error('File too small to be an ImageJ ROI.');
  for (let i = 0; i < 4; i++) {
    if (view.getUint8(i) !== MAGIC[i]) {
      throw new Error('Not an ImageJ .roi file (missing "Iout" magic).');
    }
  }

  const version = view.getUint16(4);
  const type = view.getUint8(6);
  const top = view.getInt16(8);
  const left = view.getInt16(10);
  const bottom = view.getInt16(12);
  const right = view.getInt16(14);
  const n = view.getUint16(16);
  // Rotation angle in degrees — ImageJ stores it as a big-endian float at offset
  // 36 (FLOAT_PARAM_1). 0 or NaN means the ROI is not rotated. We surface this so
  // the UI can display it; the user can adjust it further (see ui/roiControls.js).
  const rotationRaw = view.getFloat32(36);
  const rotation = Number.isFinite(rotationRaw) ? rotationRaw : 0;
  const bbox = { top, left, bottom, right };

  let polygon;
  if (type === TYPE.RECT) {
    polygon = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ];
  } else if (type === TYPE.OVAL) {
    polygon = ellipsePolygon(left, top, right, bottom, 96);
  } else if (
    n >= 3 &&
    (type === TYPE.POLYGON || type === TYPE.FREEHAND || type === TYPE.TRACED || type === TYPE.POLYLINE || type === TYPE.FREELINE)
  ) {
    const xBase = 64;
    const yBase = 64 + n * 2;
    polygon = [];
    for (let i = 0; i < n; i++) {
      const xr = view.getInt16(xBase + i * 2);
      const yr = view.getInt16(yBase + i * 2);
      polygon.push([left + xr, top + yr]);
    }
  } else {
    throw new Error(
      `Unsupported ROI type (${roiTypeName(type)}). Supported: polygon, freehand, rectangle, oval.`
    );
  }

  return { type, version, bbox, n, rotation, polygon };
}

/** Sample an axis-aligned ellipse (inscribed in the bbox) into `segments` points. */
function ellipsePolygon(left, top, right, bottom, segments) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
