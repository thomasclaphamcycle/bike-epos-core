type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export const PageHeader = ({
  title,
  description,
  eyebrow,
  meta,
  actions,
  className,
}: PageHeaderProps) => (
  <div className={["ui-page-header", className ?? ""].filter(Boolean).join(" ")}>
    <div className="ui-page-header__copy">
      {eyebrow ? <p className="ui-page-eyebrow">{eyebrow}</p> : null}
      <h1 className="ui-page-title">{title}</h1>
      {description ? <p className="ui-page-description">{description}</p> : null}
      {meta ? <div className="ui-page-meta">{meta}</div> : null}
    </div>
    {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
  </div>
);
