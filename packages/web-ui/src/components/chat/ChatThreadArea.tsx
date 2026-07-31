import React, { useCallback } from 'react';
import Box from '@mui/material/Box';
import { ScrollToBottomPill } from '../ChatEnhancements';
import { ChatThreadView } from './ChatThreadView';
import { ToolEnableBanner } from './ToolEnableBanner';
import {
  useChatMessagesContext,
  useChatPromptsContext,
  useChatSessionSettersContext,
  useChatThreadHandlersContext,
  useChatNavigationHandlersContext,
} from './ChatSessionProvider';

export const ChatThreadArea = React.memo(function ChatThreadArea() {
  // Message thread values — re-renders on stream chunks (needed for messages, streaming, etc.).
  const {
    sessionRestoring, messages, streaming,
    loadingOlderMessages, hasOlderMessages, loadingSteps,
    freezeMessageLayout, initialScrollDone, pendingFeedbackMessageId, feedbackSubmitting,
    currentStep, turnActivity, showJumpPill,
  } = useChatMessagesContext();
  // Prompts — re-render only when a permission/tool prompt appears/dismisses.
  const { toolEnablePrompt } = useChatPromptsContext();
  // Stable dispatch values — refs, handlers, setters.
  const {
    messagesContainerRef, bottomRef,
    setToolEnablePrompt, setShowJumpPill,
    jumpSuppressScrollTopRef,
    loadOlderMessages, resetToLatestMessages,
  } = useChatSessionSettersContext();
  // Thread handlers.
  const {
    handleResend, handleQuestionnaireRespond, handleQuestionnaireCancel,
    handleCrewRosterPickerSubmit, handleCrewRosterPickerSkip,
    handleViewCrewDossier, handleViewCrewByCallsign, handleTurnFeedback, handleSaveMarkdown,
  } = useChatThreadHandlersContext();
  // Navigation handlers.
  const { openChildSession } = useChatNavigationHandlersContext();

  // Stable callbacks so React.memo on leaf components (ToolEnableBanner, ScrollToBottomPill) is effective.
  const handleToolEnableRespond = useCallback(() => setToolEnablePrompt(null), [setToolEnablePrompt]);
  const handleScrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) jumpSuppressScrollTopRef.current = el.scrollTop;
    setShowJumpPill(false);
    void resetToLatestMessages();
  }, [messagesContainerRef, jumpSuppressScrollTopRef, setShowJumpPill, resetToLatestMessages]);
  const handleLoadOlder = useCallback(() => {
    void loadOlderMessages();
  }, [loadOlderMessages]);

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 2,
          py: 1.5,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
        ref={messagesContainerRef}
      >
        <ChatThreadView
          messagesContainerRef={messagesContainerRef}
          sessionRestoring={sessionRestoring}
          messages={messages}
          streaming={streaming}
          loadingOlderMessages={loadingOlderMessages}
          hasOlderMessages={hasOlderMessages}
          onLoadOlderMessages={handleLoadOlder}
          loadingSteps={loadingSteps}
          freezeMessageLayout={freezeMessageLayout || loadingOlderMessages || sessionRestoring || !initialScrollDone}
          pendingFeedbackMessageId={sessionRestoring ? null : pendingFeedbackMessageId}
          feedbackSubmitting={feedbackSubmitting}
          turnActivityStage={currentStep ?? turnActivity?.stage}
          bottomRef={bottomRef}
          onResend={handleResend}
          onOpenChildSession={openChildSession}
          onQuestionnaireRespond={handleQuestionnaireRespond}
          onQuestionnaireCancel={handleQuestionnaireCancel}
          onCrewRosterPickerSubmit={handleCrewRosterPickerSubmit}
          onCrewRosterPickerSkip={handleCrewRosterPickerSkip}
          onViewCrewDossier={handleViewCrewDossier}
          onViewCrewByCallsign={handleViewCrewByCallsign}
          onTurnFeedback={handleTurnFeedback}
          onSaveMarkdown={handleSaveMarkdown}
        />

        {toolEnablePrompt && (
          <ToolEnableBanner toolId={toolEnablePrompt.toolId} toolName={toolEnablePrompt.toolName} onRespond={handleToolEnableRespond} />
        )}
      </Box>

      {/* Floating jump-to-bottom pill — sibling of scroll container, not child.
          This keeps it fixed relative to the thread area viewport instead of
          scrolling with the message content. */}
      <ScrollToBottomPill
        visible={showJumpPill}
        onClick={handleScrollToBottom}
      />
    </Box>
  );
});
