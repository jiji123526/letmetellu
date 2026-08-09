interface CloseIconProps {
  size?: string | number;
}

export function CloseIcon({ size = "var(--bubble-font-size, 15px)" }: CloseIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      style={{ width: size, height: size, display: "block" }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </svg>
  );
}
