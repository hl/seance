import { type FC } from "react";

/**
 * Deterministic SVG avatar derived from a session UUID.
 *
 * Layers (bottom to top):
 * 1. Dark circular backdrop
 * 2. Subtle ring or orbital accent
 * 3. Primary shape (one of 6) with fill color
 * 4. Inner detail shape (smaller, contrasting) for depth
 *
 * Uses 7 UUID bytes for: primary shape, primary color, rotation,
 * accent color, inner shape, ring style, and inner rotation.
 *
 * Same UUID always produces the same visual. No backend needed.
 */

interface SessionAvatarProps {
  uuid: string;
  size?: number;
}

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

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

function polygonPoints(sides: number, cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function renderShape(
  shape: ShapeType,
  color: string,
  cx: number,
  cy: number,
  r: number,
  opacity = 1,
): React.JSX.Element {
  const props = { fill: color, opacity };
  switch (shape) {
    case "circle":
      return <circle cx={cx} cy={cy} r={r} {...props} />;
    case "triangle":
      return <polygon points={polygonPoints(3, cx, cy, r)} {...props} />;
    case "square": {
      const half = r * 0.75;
      return (
        <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2} rx={4} {...props} />
      );
    }
    case "pentagon":
      return <polygon points={polygonPoints(5, cx, cy, r)} {...props} />;
    case "hexagon":
      return <polygon points={polygonPoints(6, cx, cy, r)} {...props} />;
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r * 0.7},${cy} ${cx},${cy + r} ${cx - r * 0.7},${cy}`}
          {...props}
        />
      );
  }
}

type RingStyle = "dotted" | "dashed" | "solid" | "double";
const RING_STYLES: RingStyle[] = ["dotted", "dashed", "solid", "double"];

function renderRing(
  style: RingStyle,
  color: string,
  rotation: number,
): React.JSX.Element {
  const cx = 50;
  const cy = 50;
  const ringColor = color;
  const opacity = 0.35;

  switch (style) {
    case "dotted": {
      // 8 small dots arranged in a ring
      const dots: React.JSX.Element[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + (rotation * Math.PI) / 180;
        const x = cx + 44 * Math.cos(angle);
        const y = cy + 44 * Math.sin(angle);
        dots.push(
          <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={2.5} fill={ringColor} opacity={opacity} />,
        );
      }
      return <g>{dots}</g>;
    }
    case "dashed":
      return (
        <circle
          cx={cx} cy={cy} r={44}
          fill="none" stroke={ringColor} strokeWidth={2}
          strokeDasharray="8 6" opacity={opacity}
          transform={`rotate(${rotation}, ${cx}, ${cy})`}
        />
      );
    case "solid":
      return (
        <circle
          cx={cx} cy={cy} r={44}
          fill="none" stroke={ringColor} strokeWidth={1.5}
          opacity={opacity}
        />
      );
    case "double":
      return (
        <g opacity={opacity}>
          <circle cx={cx} cy={cy} r={44} fill="none" stroke={ringColor} strokeWidth={1} />
          <circle cx={cx} cy={cy} r={47} fill="none" stroke={ringColor} strokeWidth={0.7} />
        </g>
      );
  }
}

const SessionAvatar: FC<SessionAvatarProps> = ({ uuid, size = 24 }) => {
  const bytes = uuidToBytes(uuid);

  // Derive visual properties from UUID bytes
  const primaryShape = SHAPES[bytes[0] % SHAPES.length];
  const primaryColor = COLOR_PALETTE[bytes[1] % COLOR_PALETTE.length];
  const rotation = bytes[2] % 31;
  const accentColor = COLOR_PALETTE[(bytes[3] + 5) % COLOR_PALETTE.length]; // offset to avoid matching primary
  const innerShape = SHAPES[(bytes[4] + 3) % SHAPES.length]; // offset to differ from primary
  const ringStyle = RING_STYLES[bytes[5] % RING_STYLES.length];
  const innerRotation = bytes[6] % 60;

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
      {/* Dark circular backdrop */}
      <circle cx={50} cy={50} r={50} fill="#0f0a14" />

      {/* Ring accent */}
      {renderRing(ringStyle, accentColor, rotation * 3)}

      {/* Primary shape */}
      <g transform={`rotate(${rotation}, 50, 50)`}>
        {renderShape(primaryShape, primaryColor, 50, 50, 32)}
      </g>

      {/* Inner detail shape — smaller, offset rotation, semi-transparent accent */}
      <g transform={`rotate(${innerRotation}, 50, 50)`}>
        {renderShape(innerShape, accentColor, 50, 50, 14, 0.6)}
      </g>
    </svg>
  );
};

export default SessionAvatar;

// Exported for testing
export { uuidToBytes, COLOR_PALETTE, SHAPES };
