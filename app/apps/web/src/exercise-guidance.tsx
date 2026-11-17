import { NarrationPlayer } from "./narration";
import { spokenScript } from "./speech";
import { Disclosure } from "./disclosure";

export type ExecutionGuide = {
  execucao: string[]; evitarLesoes: string[];
  cargaExcessiva: { normal: string; alerta: string[]; pare: string };
  narracao: string; disclaimer: string; hasNarration: boolean;
};

export type Guidance = {
  description: string;
  steps: string[];
  commonMistake: string;
  attention: string;
  sensation: string;
  stop: string;
  targetMuscles: string[];
};

export function ExerciseGuidance({ guidance, executionGuide, id }: { guidance?: Guidance; executionGuide?: ExecutionGuide | null; id: string }) {
  // Editorial review instructions are not exercise instructions for the student.
  if (executionGuide?.execucao.some(step => /antes de publicar|confirme a demonstra[çc][ãa]o/i.test(step))) executionGuide = null;
  const text = spokenScript(executionGuide, guidance);
  if (executionGuide) return <div className="exercise-guidance">
    <Disclosure title="Como executar">
      {text && <NarrationPlayer key={id} text={text} compact/>}
      <ol>{executionGuide.execucao.map((step, i) => <li key={i}>{step}</li>)}</ol>
    </Disclosure>
    <Disclosure title="Cuidados e sinais de alerta">
      <ul>{executionGuide.evitarLesoes.map((step, i) => <li key={i}>{step}</li>)}</ul>
      <p><strong>Sensação esperada:</strong> {executionGuide.cargaExcessiva.normal}</p>
      <ul>{executionGuide.cargaExcessiva.alerta.map((step, i) => <li key={i}>{step}</li>)}</ul>
      <p className="guidance-stop"><strong>Quando parar:</strong> {executionGuide.cargaExcessiva.pare}</p>
      <p className="muted">{executionGuide.disclaimer}</p>
    </Disclosure>
  </div>;
  if (!guidance) return null;
  return <div className="exercise-guidance">
    <Disclosure title="Como executar">
      {text && <NarrationPlayer key={id} text={text} compact/>}
      <p className="guidance-description">{guidance.description}</p>
      <ol>{guidance.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </Disclosure>
    <Disclosure title="Cuidados e sinais de alerta">
      <p><strong>Observe:</strong> {guidance.commonMistake}</p>
      <p><strong>Atenção:</strong> {guidance.attention}</p>
      {!!guidance.targetMuscles.length && <p><strong>Foco muscular:</strong> {guidance.targetMuscles.join(", ")}.</p>}
      <p className="guidance-sensation">{guidance.sensation}</p>
      <p className="guidance-stop">{guidance.stop}</p>
    </Disclosure>
  </div>;
}
