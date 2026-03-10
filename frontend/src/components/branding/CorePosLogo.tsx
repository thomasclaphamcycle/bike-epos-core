type CorePosLogoProps = {
  variant?: "full" | "stacked" | "icon";
  theme?: "dark" | "light";
  size?: number | string;
  className?: string;
};

const colorsByTheme = {
  dark: {
    shell: "#0B1F33",
    blue: "#2E7CF6",
    orange: "#FF7A18",
    text: "#F8FAFC",
    subtext: "#D1D5DB",
  },
  light: {
    shell: "#0B1F33",
    blue: "#2E7CF6",
    orange: "#FF7A18",
    text: "#111827",
    subtext: "#4B5563",
  },
} as const;

const widthByVariant = {
  full: 188,
  stacked: 132,
  icon: 44,
} as const;

const BrandMark = ({ shell, blue, orange }: { shell: string; blue: string; orange: string }) => (
  <g>
    <rect x="4" y="4" width="44" height="44" rx="14" fill={shell} />
    <path
      d="M17 17.5C17 15.015 19.015 13 21.5 13H31.5V19H23C20.791 19 19 20.791 19 23V29C19 31.209 20.791 33 23 33H31.5V39H21.5C19.015 39 17 36.985 17 34.5V17.5Z"
      fill={blue}
    />
    <rect x="29.5" y="17" width="8.5" height="22" rx="4.25" fill={orange} />
  </g>
);

export const CorePosLogo = ({
  variant = "full",
  theme = "dark",
  size,
  className,
}: CorePosLogoProps) => {
  const palette = colorsByTheme[theme];
  const width = typeof size === "number" || typeof size === "string" ? size : widthByVariant[variant];

  if (variant === "icon") {
    return (
      <svg
        className={className}
        width={width}
        viewBox="0 0 52 52"
        fill="none"
        role="img"
        aria-label="CorePOS"
      >
        <BrandMark shell={palette.shell} blue={palette.blue} orange={palette.orange} />
      </svg>
    );
  }

  if (variant === "stacked") {
    return (
      <svg
        className={className}
        width={width}
        viewBox="0 0 132 110"
        fill="none"
        role="img"
        aria-label="CorePOS"
      >
        <g transform="translate(40 0)">
          <BrandMark shell={palette.shell} blue={palette.blue} orange={palette.orange} />
        </g>
        <text
          x="66"
          y="76"
          textAnchor="middle"
          fontFamily="Manrope, 'Segoe UI', sans-serif"
          fontSize="28"
          fontWeight="800"
          letterSpacing="-0.04em"
          fill={palette.text}
        >
          Core<tspan fill={palette.orange}>POS</tspan>
        </text>
        <text
          x="66"
          y="98"
          textAnchor="middle"
          fontFamily="Manrope, 'Segoe UI', sans-serif"
          fontSize="10"
          fontWeight="700"
          letterSpacing="0.16em"
          fill={palette.subtext}
        >
          RETAIL AND WORKSHOP OPERATIONS
        </text>
      </svg>
    );
  }

  return (
    <svg
      className={className}
      width={width}
      viewBox="0 0 188 52"
      fill="none"
      role="img"
      aria-label="CorePOS"
    >
      <BrandMark shell={palette.shell} blue={palette.blue} orange={palette.orange} />
      <text
        x="60"
        y="31"
        fontFamily="Manrope, 'Segoe UI', sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="-0.04em"
        fill={palette.text}
      >
        Core<tspan fill={palette.orange}>POS</tspan>
      </text>
    </svg>
  );
};
