import { Disclosure } from "./disclosure";

export function WorkoutPreparation({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return <section className="workout-preparation" aria-label="Preparação do treino">
    <Disclosure title="Antes de começar">
      {notes.map(note => <p key={note}>{note}</p>)}
    </Disclosure>
  </section>;
}
