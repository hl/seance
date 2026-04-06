import { type FC, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  variant?: "danger";
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  // Measure menu height and adjust if it overflows the viewport bottom
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let adjustedTop = y;
    let adjustedLeft = x;

    if (y + rect.height > viewportHeight) {
      adjustedTop = y - rect.height;
    }
    if (x + rect.width > viewportWidth) {
      adjustedLeft = x - rect.width;
    }

    if (adjustedTop !== y || adjustedLeft !== x) {
      setPosition({ left: adjustedLeft, top: adjustedTop });
    }
  }, [x, y]);

  // Click-outside, Escape, and scroll listeners
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="z-50 border border-border bg-surface shadow-lg"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`block w-full cursor-pointer px-3 py-1.5 text-left text-sm ${
            item.variant === "danger"
              ? "text-red-500 hover:bg-red-100/50 dark:hover:bg-red-900/50"
              : "text-text hover:bg-interactive-hover"
          }`}
          onClick={() => {
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
};

export default ContextMenu;
