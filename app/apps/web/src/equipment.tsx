import { Dumbbell } from "lucide-react";
import { domainLabel } from "./i18n";

export function EquipmentIcon({ equipment, name = "" }: { equipment: string; name?: string }) {
  const bench = /banco|bench/i.test(name) || equipment === "banco";
  const bar = equipment === "barra";
  const body = equipment === "peso_corporal";
  return <span className="equipment-label" title={domainLabel(equipment)}>
    {bar ? <span className="bar-icon" aria-hidden>━</span> : !body && equipment !== "banco" ? <Dumbbell size={15}/> : null}
    {bench && <span className="bench-icon" aria-hidden>▰</span>}
    {body && !bench && <span className="body-icon" aria-hidden>◇</span>}
    <span>{domainLabel(equipment)}</span>
  </span>;
}
