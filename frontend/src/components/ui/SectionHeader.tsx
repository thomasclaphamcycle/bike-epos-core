type SectionHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export const SectionHeader = ({
  title,
  description,
  eyebrow,
  actions,
  className,
}: SectionHeaderProps) => (
  <div className={["ui-section-header", className ?? ""].filter(Boolean).join(" ")}>
    <div className="ui-section-header__copy">
      {eyebrow ? <p className="ui-section-eyebrow">{eyebrow}</p> : null}
      <h2 className="ui-section-title">{title}</h2>
      {description ? <p className="ui-section-description">{description}</p> : null}
    </div>
    {actions ? <div className="ui-section-header__actions">{actions}</div> : null}
  </div>
);
