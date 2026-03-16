type EmptyStateProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export const EmptyState = ({
  title,
  description,
  actions,
  className,
}: EmptyStateProps) => (
  <div className={["ui-empty-state", className ?? ""].filter(Boolean).join(" ")}>
    <strong className="ui-empty-state__title">{title}</strong>
    {description ? <div className="ui-empty-state__description">{description}</div> : null}
    {actions ? <div className="ui-empty-state__actions">{actions}</div> : null}
  </div>
);
