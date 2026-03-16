type SurfaceCardProps = React.HTMLAttributes<HTMLElement> & {
  className?: string;
  tone?: "default" | "soft";
  as?: "section" | "div";
};

export const SurfaceCard = ({
  children,
  className,
  tone = "default",
  as = "section",
  ...rest
}: SurfaceCardProps) => {
  const Component = as;
  const classes = [
    "card",
    "ui-surface-card",
    tone === "soft" ? "ui-surface-card--soft" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return <Component className={classes} {...rest}>{children}</Component>;
};
