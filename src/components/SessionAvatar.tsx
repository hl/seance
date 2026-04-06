import { type FC } from "react";

/**
 * Deterministic SVG avatar derived from a session UUID.
 *
 * Maps UUID bytes to:
 * - Shape: circle, triangle, square, pentagon, hexagon, diamond (6 options)
 * - Fill color: from a curated palette of 16 visually distinct colors
 * - Rotation: subtle rotation for variety (0-30 degrees)
 *
 * Same UUID always produces the same visual. No backend needed.
 */

interface SessionAvatarProps {
  uuid: string;
  size?: number;
}

/**
 * Parse hex bytes from a UUID string.
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * We strip dashes and parse hex pairs.
 */
function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

// 16 visually distinct colors that work well on dark backgrounds (bg-neutral-950).
// Curated for vibrancy and mutual distinguishability.
const COLOR_PALETTE = [
  "#FF6B6B", // coral red
  "#4ECDC4", // teal
  "#45B7D1", // sky blue
  "#96CEB4", // sage green
  "#FFEAA7", // pale yellow
  "#DDA0DD", // plum
  "#98D8C8", // mint
  "#F7DC6F", // gold
  "#BB8FCE", // lavender
  "#85C1E9", // light blue
  "#F0B27A", // peach
  "#82E0AA", // emerald
  "#F1948A", // salmon
  "#AED6F1", // powder blue
  "#D7BDE2", // lilac
  "#A3E4D7", // aqua
] as const;

type ShapeType =
  | "circle"
  | "triangle"
  | "square"
  | "pentagon"
  | "hexagon"
  | "diamond";

const SHAPES: ShapeType[] = [
  "circle",
  "triangle",
  "square",
  "pentagon",
  "hexagon",
  "diamond",
];

/**
 * Generate SVG path data for regular polygons centered at (50, 50) with radius 35.
 */
function polygonPoints(sides: number, cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    // Start from top (-90 degrees)
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function renderShape(shape: ShapeType, color: string): React.JSX.Element {
  const cx = 50;
  const cy = 50;
  const r = 38;

  switch (shape) {
    case "circle":
      return <circle cx={cx} cy={cy} r={r} fill={color} />;
    case "triangle":
      return <polygon points={polygonPoints(3, cx, cy, r)} fill={color} />;
    case "square":
      return (
        <rect
          x={cx - r * 0.75}
          y={cy - r * 0.75}
          width={r * 1.5}
          height={r * 1.5}
          fill={color}
          rx={4}
        />
      );
    case "pentagon":
      return <polygon points={polygonPoints(5, cx, cy, r)} fill={color} />;
    case "hexagon":
      return <polygon points={polygonPoints(6, cx, cy, r)} fill={color} />;
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r * 0.7},${cy} ${cx},${cy + r} ${cx - r * 0.7},${cy}`}
          fill={color}
        />
      );
  }
}

const SessionAvatar: FC<SessionAvatarProps> = ({ uuid, size = 24 }) => {
  const bytes = uuidToBytes(uuid);

  // Derive visual properties from UUID bytes
  const shape = SHAPES[bytes[0] % SHAPES.length];
  const color = COLOR_PALETTE[bytes[1] % COLOR_PALETTE.length];
  const rotation = (bytes[2] % 31); // 0-30 degrees

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Avatar for session ${uuid}`}
      data-testid="session-avatar"
    >
      {/* Dark circular backdrop — branded constant for avatar legibility in both themes */}
      <circle cx={50} cy={50} r={50} fill="#0f0a14" />
      <g transform={`rotate(${rotation}, 50, 50)`}>
        {renderShape(shape, color)}
      </g>
    </svg>
  );
};

export default SessionAvatar;

// Exported for testing
export { uuidToBytes, COLOR_PALETTE, SHAPES };
