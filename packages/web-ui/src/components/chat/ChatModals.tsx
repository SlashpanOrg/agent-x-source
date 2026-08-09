import React from 'react';
import {
  SessionSearchModal,
  CheckpointDrawer,
} from '../ChatEnhancements';
import StepCapModal from '../StepCapModal';
import { CrewProfileDialog } from '../crew/CrewProfileDialog';
import {
  ClearSessionDialog,
} from './ChatDialogs';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';
import { chat, agent } from '../../api';
import { getCrewAccent } from '../../styles/crew-theme';
import {
  useChatSessionIdentityContext,
  useChatModalContext,
  useChatSessionSettersContext,
  useChatNavigationHandlersContext,
} from './ChatSessionProvider';

export const ChatModals = React.memo(function ChatModals() {
  const { currentSessionId } = useChatSessionIdentityContext();
  const {
    searchOpen, checkpointsOpen,
    crewDossierOpen, crewDossierCrew, stepCapPrompt,
    clearSessionModalOpen, clearSessionBusy,
    deleteSessionPending, deleteSessionBusy,
  } = useChatModalContext();
  const {
    navigate, setSearchOpen, setCheckpointsOpen,
    setMessages, setTokenUsed, setTokenInput, setTokenOutput,
    setStreaming, setCrewDossierOpen, setCrewDossierCrew,
    setStepCapPrompt,
    setClearSessionModalOpen,
    setDeleteSessionPending,
  } = useChatSessionSettersContext();
  const { handleArchiveSession, handleDeleteSessionContent, handleConfirmDeleteSession } = useChatNavigationHandlersContext();

  return (
    <>
      <SessionSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPickSession={(sid) => { navigate(`/console/chat/${sid}`); }}
      />
      <CheckpointDrawer
        open={checkpointsOpen}
        onClose={() => setCheckpointsOpen(false)}
        sessionId={currentSessionId}
        onRestored={async () => {
          try {
            const h = await chat.history();
            const visible = h.filter(m => m.role !== 'system');
            setMessages(visible.map(m => ({ ...m, streaming: false })));
            const totalUsed = visible.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenUsed(totalUsed);
            const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenInput(inputEst);
            setTokenOutput(outputEst);
          } catch { /* ignore */ }
        }}
      />
      <CrewProfileDialog
        open={crewDossierOpen}
        crew={crewDossierCrew}
        imported={false}
        accentColor={crewDossierCrew
          ? getCrewAccent(undefined, crewDossierCrew.callsign)
          : undefined}
        onClose={() => { setCrewDossierOpen(false); setCrewDossierCrew(null); }}
      />
      <StepCapModal
        open={!!stepCapPrompt}
        currentSteps={stepCapPrompt?.currentSteps ?? 25}
        maxSteps={stepCapPrompt?.maxSteps ?? 25}
        onContinue={() => {
          agent.respondToStepCap(true).catch(() => {});
          setStepCapPrompt(null);
        }}
        onStop={() => {
          agent.respondToStepCap(false).catch(() => {});
          setStepCapPrompt(null);
          setStreaming(false);
        }}
      />
      <ClearSessionDialog
        open={clearSessionModalOpen}
        busy={clearSessionBusy}
        onClose={() => setClearSessionModalOpen(false)}
        onArchive={() => { void handleArchiveSession(); }}
        onDelete={() => { void handleDeleteSessionContent(); }}
      />
      <ConfirmDeleteDialog
        open={Boolean(deleteSessionPending)}
        busy={deleteSessionBusy}
        title={deleteSessionPending?.isGroupChat ? 'DELETE GROUP CHAT' : 'DELETE PRIVATE CHAT'}
        description="Permanently delete"
        itemName={deleteSessionPending?.title}
        onClose={() => setDeleteSessionPending(null)}
        onConfirm={() => { void handleConfirmDeleteSession(); }}
      />
    </>
  );
});
