export function WorkoutPreparation({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return <section className="workout-preparation" aria-label="Preparação do treino">
    <h3>Antes de começar</h3>
    {notes.map(note => <p key={note}>{note}</p>)}
  </section>;
}
