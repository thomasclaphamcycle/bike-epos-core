type CorePosLogoProps = {
  variant?: "full" | "stacked" | "icon";
  size?: number | string;
  className?: string;
};

const assetByVariant = {
  full: "/branding/corepos-logo.svg",
  stacked: "/branding/corepos-logo-stacked.svg",
  icon: "/branding/corepos-icon.svg",
} as const;

const CorePosLogo = ({
  variant = "full",
  size = 32,
  className,
}: CorePosLogoProps) => (
  <img
    src={assetByVariant[variant]}
    alt="CorePOS"
    className={className}
    style={{ height: size, width: "auto" }}
  />
);

export default CorePosLogo;
