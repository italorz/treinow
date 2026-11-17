import { NarrationPlayer } from "./narration";

export type ExecutionGuide = {
  execucao: string[]; evitarLesoes: string[];
  cargaExcessiva: { normal: string; alerta: string[]; pare: string };
  narracao: string; disclaimer: string; hasNarration: boolean;
};

type Guidance = {
  description: string;
  steps: string[];
  commonMistake: string;
  attention: string;
  sensation: string;
  stop: string;
  targetMuscles: string[];
};

export function ExerciseGuidance({ guidance, executionGuide, id }: { guidance?: Guidance; executionGuide?: ExecutionGuide | null; id: string }) {
  if (executionGuide) return <div className="exercise-guidance">
    {executionGuide.hasNarration && <NarrationPlayer key={id} id={id} text={executionGuide.narracao}/>}
    <h4>Como executar</h4>
    <ol>{executionGuide.execucao.map((step, i) => <li key={i}>{step}</li>)}</ol>
    <h4>Como evitar lesões</h4>
    <ul>{executionGuide.evitarLesoes.map((step, i) => <li key={i}>{step}</li>)}</ul>
    <h4>Sinais de carga excessiva</h4>
    <p><strong>Normal:</strong> {executionGuide.cargaExcessiva.normal}</p>
    <strong>Alerta:</strong><ul>{executionGuide.cargaExcessiva.alerta.map((step, i) => <li key={i}>{step}</li>)}</ul>
    <p className="guidance-stop"><strong>Quando parar:</strong> {executionGuide.cargaExcessiva.pare}</p>
    <p className="muted">{executionGuide.disclaimer}</p>
  </div>;
  if (!guidance) return null;
  return <div className="exercise-guidance">
    <p className="guidance-description">{guidance.description}</p>
    <details>
      <summary>Como executar</summary>
      <div className="guidance-content">
        <ol>{guidance.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <p><strong>Observe:</strong> {guidance.commonMistake}</p>
        <p><strong>Atenção:</strong> {guidance.attention}</p>
        {!!guidance.targetMuscles.length && <p><strong>Foco muscular:</strong> {guidance.targetMuscles.join(", ")}.</p>}
        <p className="guidance-sensation">{guidance.sensation}</p>
        <p className="guidance-stop">{guidance.stop}</p>
      </div>
    </details>
  </div>;
}
