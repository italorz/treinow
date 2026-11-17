import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function Disclosure({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className={`disclosure ${open ? "is-open" : ""}`}>
    <button type="button" id={`${id}-button`} className="disclosure-toggle" aria-expanded={open} aria-controls={`${id}-content`} onClick={() => setOpen(value => !value)}>
      <span>{title}</span>
      {count !== undefined && <span className="disclosure-count">{count}</span>}
      <ChevronDown size={18} aria-hidden="true" />
    </button>
    <div id={`${id}-content`} aria-labelledby={`${id}-button`} hidden={!open}>
      {open && <div className="disclosure-content">{children}</div>}
    </div>
  </section>;
}
