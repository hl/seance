import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SessionAvatar, {
  uuidToBytes,
  COLOR_PALETTE,
  SHAPES,
} from "../SessionAvatar";

describe("SessionAvatar", () => {
  const TEST_UUID_1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const TEST_UUID_2 = "11111111-2222-3333-4444-555555555555";
  const TEST_UUID_3 = "deadbeef-cafe-babe-face-123456789abc";

  describe("uuidToBytes", () => {
    it("converts a UUID string to an array of bytes", () => {
      const bytes = uuidToBytes(TEST_UUID_1);
      // UUID has 32 hex chars = 16 bytes
      expect(bytes).toHaveLength(16);
      // First byte: 0xa1 = 161
      expect(bytes[0]).toBe(0xa1);
      // Second byte: 0xb2 = 178
      expect(bytes[1]).toBe(0xb2);
    });
  });

  describe("rendering", () => {
    it("renders an SVG element", () => {
      const { container } = render(<SessionAvatar uuid={TEST_UUID_1} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
    });

    it("renders with the correct default size", () => {
      const { container } = render(<SessionAvatar uuid={TEST_UUID_1} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe("24");
      expect(svg?.getAttribute("height")).toBe("24");
    });

    it("renders with a custom size", () => {
      const { container } = render(
        <SessionAvatar uuid={TEST_UUID_1} size={48} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe("48");
      expect(svg?.getAttribute("height")).toBe("48");
    });

    it("has the data-testid attribute", () => {
      const { getByTestId } = render(<SessionAvatar uuid={TEST_UUID_1} />);
      expect(getByTestId("session-avatar")).toBeDefined();
    });
  });

  describe("determinism", () => {
    it("same UUID always produces the same SVG output", () => {
      const { container: container1 } = render(
        <SessionAvatar uuid={TEST_UUID_1} />
      );
      const { container: container2 } = render(
        <SessionAvatar uuid={TEST_UUID_1} />
      );
      expect(container1.innerHTML).toBe(container2.innerHTML);
    });

    it("same UUID with same size produces identical output", () => {
      const { container: container1 } = render(
        <SessionAvatar uuid={TEST_UUID_2} size={32} />
      );
      const { container: container2 } = render(
        <SessionAvatar uuid={TEST_UUID_2} size={32} />
      );
      expect(container1.innerHTML).toBe(container2.innerHTML);
    });
  });

  describe("visual variety", () => {
    it("different UUIDs produce different shapes or colors", () => {
      const bytes1 = uuidToBytes(TEST_UUID_1);
      const bytes2 = uuidToBytes(TEST_UUID_2);
      const bytes3 = uuidToBytes(TEST_UUID_3);

      const shape1 = SHAPES[bytes1[0] % SHAPES.length];
      const shape2 = SHAPES[bytes2[0] % SHAPES.length];
      const shape3 = SHAPES[bytes3[0] % SHAPES.length];

      const color1 = COLOR_PALETTE[bytes1[1] % COLOR_PALETTE.length];
      const color2 = COLOR_PALETTE[bytes2[1] % COLOR_PALETTE.length];
      const color3 = COLOR_PALETTE[bytes3[1] % COLOR_PALETTE.length];

      // At least some of the shapes or colors should differ among 3 distinct UUIDs
      const shapesAllSame =
        shape1 === shape2 && shape2 === shape3;
      const colorsAllSame =
        color1 === color2 && color2 === color3;

      expect(shapesAllSame && colorsAllSame).toBe(false);
    });

    it("different UUIDs produce different SVG output", () => {
      const { container: container1 } = render(
        <SessionAvatar uuid={TEST_UUID_1} />
      );
      const { container: container2 } = render(
        <SessionAvatar uuid={TEST_UUID_2} />
      );
      expect(container1.innerHTML).not.toBe(container2.innerHTML);
    });
  });

  describe("shape derivation", () => {
    it("maps first byte to one of 6 shapes", () => {
      const bytes = uuidToBytes(TEST_UUID_1);
      const shapeIndex = bytes[0] % SHAPES.length;
      expect(shapeIndex).toBeGreaterThanOrEqual(0);
      expect(shapeIndex).toBeLessThan(6);
    });

    it("maps second byte to one of 16 colors", () => {
      const bytes = uuidToBytes(TEST_UUID_1);
      const colorIndex = bytes[1] % COLOR_PALETTE.length;
      expect(colorIndex).toBeGreaterThanOrEqual(0);
      expect(colorIndex).toBeLessThan(16);
    });

    it("derives rotation from third byte between 0 and 30", () => {
      const bytes = uuidToBytes(TEST_UUID_1);
      const rotation = bytes[2] % 31;
      expect(rotation).toBeGreaterThanOrEqual(0);
      expect(rotation).toBeLessThanOrEqual(30);
    });
  });
});
