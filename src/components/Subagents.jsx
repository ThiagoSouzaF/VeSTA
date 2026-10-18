import { SubagentCard } from './SubagentCard';
export function Subagents({ subagents }) {
  return subagents?.length ? (
    <div className="subagents">
      {subagents.map((s) => (
        <SubagentCard s={s} key={s.toolUseId} />
      ))}
    </div>
  ) : null;
}
