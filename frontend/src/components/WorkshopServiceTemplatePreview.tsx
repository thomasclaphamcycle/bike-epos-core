import type { ReactNode } from "react";
import {
  type WorkshopServiceTemplate,
  formatWorkshopTemplateMoney,
} from "../features/workshop/serviceTemplates";

type WorkshopServiceTemplatePreviewProps = {
  template: WorkshopServiceTemplate;
  selectedOptionalLineIds: string[];
  onToggleOptionalLine?: (lineId: string) => void;
  actions?: ReactNode;
  emptyOptionalLabel?: string;
};

export const WorkshopServiceTemplatePreview = ({
  template,
  selectedOptionalLineIds,
  onToggleOptionalLine,
  actions,
  emptyOptionalLabel = "All optional part suggestions are currently included.",
}: WorkshopServiceTemplatePreviewProps) => {
  const totalPence = template.lines.reduce((sum, line) => {
    if (line.isOptional && !selectedOptionalLineIds.includes(line.id)) {
      return sum;
    }
    return sum + line.lineTotalPence;
  }, 0);

  return (
    <div className="workshop-template-preview">
      <div className="workshop-template-preview-header">
        <div>
          <strong>{template.name}</strong>
          <div className="table-secondary">
            {[template.category, template.defaultDurationMinutes ? `${template.defaultDurationMinutes} min` : null]
              .filter(Boolean)
              .join(" · ") || "Workshop service template"}
          </div>
        </div>
        <div className="table-secondary">
          {template.lineCount} line{template.lineCount === 1 ? "" : "s"} · {formatWorkshopTemplateMoney(totalPence)}
        </div>
      </div>

      {template.description ? (
        <p className="muted-text">{template.description}</p>
      ) : null}

      <div className="workshop-template-line-list">
        {template.lines.map((line) => {
          const isSelected = !line.isOptional || selectedOptionalLineIds.includes(line.id);
          return (
            <label
              key={line.id}
              className={`workshop-template-line${line.isOptional && !isSelected ? " workshop-template-line-muted" : ""}`}
            >
              <div className="workshop-template-line-main">
                {line.isOptional ? (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleOptionalLine?.(line.id)}
                    disabled={!onToggleOptionalLine}
                  />
                ) : (
                  <span className="status-badge">{line.type}</span>
                )}
                <div>
                  <strong>{line.description}</strong>
                  <div className="table-secondary">
                    {line.type}
                    {line.hasInventoryLink && line.variantSku ? ` · ${line.variantSku}` : ""}
                    {line.isOptional ? " · Optional part suggestion" : ""}
                  </div>
                </div>
              </div>
              <div className="table-secondary">
                {line.qty} × {formatWorkshopTemplateMoney(line.resolvedUnitPricePence)} = {formatWorkshopTemplateMoney(line.lineTotalPence)}
              </div>
            </label>
          );
        })}
      </div>

      {template.lines.every((line) => !line.isOptional || selectedOptionalLineIds.includes(line.id)) ? (
        <div className="table-secondary">{emptyOptionalLabel}</div>
      ) : null}

      {actions ? <div className="actions-inline">{actions}</div> : null}
    </div>
  );
};
