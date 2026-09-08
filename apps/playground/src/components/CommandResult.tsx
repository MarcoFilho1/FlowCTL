import type { CommandProcessingResult } from "@flowctl/control-plane";

export interface CommandResultProps {
  result: CommandProcessingResult | null;
}

export function CommandResult({ result }: CommandResultProps) {
  return (
    <section className="command-result">
      <h2>Last Result</h2>
      {result === null ? (
        <p className="empty-state">No command dispatched.</p>
      ) : result.ok ? (
        <p role="status">
          Accepted
          {result.events.length > 0
            ? `: ${result.events.map((event) => event.type).join(", ")}`
            : "."}
        </p>
      ) : (
        <p role="alert">Rejected: {result.code}</p>
      )}
    </section>
  );
}
