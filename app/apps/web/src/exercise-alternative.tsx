import { Check } from "lucide-react";
import { EquipmentIcon } from "./equipment";
import { ExerciseGuidance } from "./exercise-guidance";
import { ExerciseMedia } from "./narration";
import { ExerciseVideo } from "./video";

export function ExerciseAlternative({ exercise, active = false, selected = false, disabled = false, onChoose }: any) {
  return <ExerciseMedia><div className={`exercise-alternative ${exercise.familiar ? "is-familiar" : ""}`}>
    <div className="exercise-heading">
      <ExerciseVideo id={exercise.id} eager={false} className="reserve-video"/>
      <div className="exercise-heading-copy"><strong>{exercise.name}</strong><EquipmentIcon equipment={exercise.equipment} name={exercise.name}/>{exercise.familiar && <span className="familiar-note">Você já praticou este</span>}</div>
      {active && <button type="button" disabled={disabled} className={`check ${selected ? "selected" : ""}`} aria-pressed={selected} aria-label={`Concluir ${exercise.name}`} onClick={onChoose}>{selected && <Check size={18}/>}</button>}
    </div>
    <ExerciseGuidance id={exercise.id} guidance={exercise.guidance} executionGuide={exercise.executionGuide}/>
  </div></ExerciseMedia>;
}
