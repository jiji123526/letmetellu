interface ThemeLogoProps {
  alt: string;
  width: number;
  height: number;
  className?: string;
}

export function ThemeLogo({ alt, width, height, className }: ThemeLogoProps) {
  return (
    <span className={`theme-logo${className ? ` ${className}` : ""}`} style={{ width, height }}>
      <img
        src="/logo.svg"
        alt={alt}
        width={width}
        height={height}
        className="theme-logo-light"
      />
      <img
        src="/logo-white.svg"
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className="theme-logo-dark"
      />
    </span>
  );
}
