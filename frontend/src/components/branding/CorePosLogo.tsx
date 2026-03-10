import corePosLogoDark from "../../assets/branding/corepos-logo-dark.png";
import corePosLogoHorizontal from "../../assets/branding/corepos-logo-horizontal.png";
import corePosLogoLight from "../../assets/branding/corepos-logo-light.png";

type CorePosLogoProps = {
  variant?: "full" | "stacked" | "icon";
  size?: number | string;
  className?: string;
};

const assetByVariant = {
  full: corePosLogoHorizontal,
  stacked: corePosLogoLight,
  icon: corePosLogoDark,
} as const;

const CorePosLogo = ({
  variant = "full",
  size = 32,
  className,
}: CorePosLogoProps) => {
  const style =
    variant === "stacked"
      ? { width: size, height: "auto" }
      : { height: size, width: "auto" };

  return <img src={assetByVariant[variant]} alt="CorePOS" className={className} style={style} />;
};

export default CorePosLogo;
