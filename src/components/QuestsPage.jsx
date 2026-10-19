import { memo, useCallback, useMemo, useState } from 'react';
import { MascotPanel } from './Mascot';
import { Plus, Swords } from 'lucide-react';
import { ProviderIcon } from './ProviderIcon';
import { NewQuestModal } from './quests/NewQuestModal';
import { ProgressBar, QuestDetail, StatusBadge } from './quests/QuestDetail';
import { progress, runningQuests } from '../lib/quests';
import { formatDate } from '../lib/format';
import { Chapter } from './Chapter';

// A row of the list. Memoized on the quest's revision: snapshots that did not touch it do not re-render it.
const QuestRow = memo(
  function QuestRow({ quest, projectName, onOpen }) {
    const p = progress(quest);
    return (
      <button className={'quest-row ' + quest.status} data-quest={quest.id} onClick={() => onOpen(quest.id)}>
        <div className="quest-row-main">
          <strong>{quest.title}</strong>
          <span>
            {projectName || 'Espaço pessoal'} · {formatDate(quest.updatedAt)}
          </span>
        </div>
        <div className="quest-row-ais" title="IAs envolvidas">
          {p.providers.map((id) => (
            <ProviderIcon id={id} small key={id} />
          ))}
        </div>
        <div className="quest-row-progress">
          <ProgressBar p={p} />
          <small>
            {p.done}/{p.total} etapas{p.running ? ' · ' + p.running + ' rodando' : ''}
            {p.errors ? ' · ' + p.errors + ' com problema' : ''}
          </small>
        </div>
        <StatusBadge status={quest.status} />
      </button>
    );
  },
  (a, b) =>
    a.quest.id === b.quest.id &&
    a.quest.updatedAt === b.quest.updatedAt &&
    a.quest.status === b.quest.status &&
    a.projectName === b.projectName &&
    a.onOpen === b.onOpen
);

// Takes only quests and projects (not the whole state): streamed text deltas never re-render this screen.
export const QuestsPage = memo(function QuestsPage({
  quests,
  projects,
  integrations,
  call,
  setData,
  onOpenChat,
  notify,
}) {
  const [selected, setSelected] = useState(null),
    [creating, setCreating] = useState(false);
  const projectName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const quest = quests.find((q) => q.id === selected);
  const onAct = useCallback(
    async (method, id, stepId, extra) => {
      const next = await call(method, { id, stepId, ...extra });
      setData(next);
      return next;
    },
    [call, setData]
  );
  const onBack = useCallback(() => setSelected(null), []);
  const create = async (input) => {
    const next = await call('createQuest', input);
    setData(next);
    setCreating(false);
    setSelected(next.quests[0].id);
  };
  const running = runningQuests(quests);
  if (quest)
    return (
      <QuestDetail
        quest={quest}
        projects={projects}
        integrations={integrations}
        onBack={onBack}
        onOpenChat={onOpenChat}
        call={call}
        onAct={onAct}
        notify={notify}
      />
    );
  return (
    <div className="content-page quests-page">
      <div className="page-heading">
        <div>
          <Chapter n={3} title="QUESTS" />
          <h1>Dê uma quest às suas IAs.</h1>
          <p>
            Um objetivo, várias IAs: elas dividem o trabalho em etapas, passam o bastão uma para a outra e você
            acompanha tudo num quadro.
          </p>
        </div>
        <button className="primary-button" data-action="new-quest" onClick={() => setCreating(true)}>
          <Plus size={15} />
          Nova quest
        </button>
      </div>
      {quests.length > 0 && (
        <p className="quest-count" role="status">
          {quests.length} {quests.length === 1 ? 'quest' : 'quests'}
          {running ? ' · ' + running + (running === 1 ? ' rodando agora' : ' rodando agora') : ''}
        </p>
      )}
      <div className="quest-list">
        {quests.map((q) => (
          <QuestRow key={q.id} quest={q} projectName={projectName[q.projectId]} onOpen={setSelected} />
        ))}
        {!quests.length && (
          <div className="activity-empty">
            <MascotPanel calm className="compact" text="Que tal a primeira missão? Eu cuido do quadro." />
            <Swords size={22} />
            <strong>Nenhuma quest ainda.</strong>
            <span>Clique em Nova quest e descreva o que precisa ficar pronto.</span>
          </div>
        )}
      </div>
      {creating && (
        <NewQuestModal
          projects={projects}
          integrations={integrations}
          onClose={() => setCreating(false)}
          onCreate={create}
        />
      )}
    </div>
  );
});
