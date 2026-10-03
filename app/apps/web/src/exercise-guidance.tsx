type Guidance = {
  description: string;
  steps: string[];
  commonMistake: string;
  attention: string;
  sensation: string;
  stop: string;
  targetMuscles: string[];
};

export function ExerciseGuidance({ guidance }: { guidance?: Guidance }) {
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
