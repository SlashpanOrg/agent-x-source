import { useState, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { colors, alphaColor } from '../../theme';
import { QuestionBlockRenderer } from './QuestionnaireBlocks';
import {
  canSubmitQuestionnaire,
  formatQuestionnaireAnswers,
  initialQuestionnaireState,
  sanitizeQuestionnairePayload,
  type QuestionnaireRecord,
  type QuestionnaireResponseState,
} from './types';

export interface QuestionnaireMessageProps {
  record: QuestionnaireRecord;
  onRespond?: (response: string) => void;
  /** Called when the user cancels the questionnaire — should stop the turn. */
  onCancel?: () => void;
  /** Agent persona name — used as the fallback source label. */
  agentName?: string;
}

function sourceLabel(record: QuestionnaireRecord, agentName?: string): string {
  const payload = record.payload;
  if (payload.title) return payload.title;
  if (payload.source?.kind === 'crew') {
    return payload.source.callsign ?? payload.source.name ?? 'Crew';
  }
  return agentName ?? 'Agent-X';
}

function ReadonlyAnswer({ prompt, answer }: { prompt: string; answer: string }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 0.5,
      py: 0.35,
      borderBottom: `1px solid ${colors.border.subtle}`,
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, lineHeight: 1.4 }}>{prompt}</Typography>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.primary, fontWeight: 500, lineHeight: 1.4, textAlign: 'right' }}>{answer}</Typography>
    </Box>
  );
}

export function QuestionnaireMessage({ record, onRespond, onCancel, agentName }: QuestionnaireMessageProps) {
  const payload = useMemo(() => sanitizeQuestionnairePayload(record.payload), [record.payload]);
  const { status, answer } = record;
  const isPending = status === 'pending' && !!onRespond;
  const [state, setState] = useState<QuestionnaireResponseState>(() => initialQuestionnaireState(payload));
  // Per-question focus index — keyed by question.id so hovering in one question
  // doesn't affect the highlighted option in other questions.
  const [focusMap, setFocusMap] = useState<Record<string, number>>({});
  const getFocusIdx = useCallback((qid: string) => focusMap[qid] ?? 0, [focusMap]);
  const setFocusIdx = useCallback((qid: string, idx: number) => {
    setFocusMap((prev) => (prev[qid] === idx ? prev : { ...prev, [qid]: idx }));
  }, []);

  const canSubmit = useMemo(() => canSubmitQuestionnaire(payload, state), [payload, state]);

  const handleSubmit = useCallback(() => {
    const response = formatQuestionnaireAnswers(payload, state);
    if (response && onRespond) onRespond(response);
  }, [payload, state, onRespond]);

  const handleSkip = useCallback(() => onRespond?.('(skipped)'), [onRespond]);

  const handleStateChange = useCallback((key: string, value: QuestionnaireResponseState[string]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const answeredLines = useMemo(() => {
    if (!answer || status === 'pending') return [];
    if (status === 'skipped') return [{ prompt: 'Response', answer: 'Skipped' }];
    if (status === 'cancelled') return [{ prompt: 'Response', answer: 'Cancelled' }];
    if (status === 'expired') return [{ prompt: 'Response', answer: 'Expired' }];
    return answer.split('\n').map((line) => {
      const idx = line.indexOf(': ');
      if (idx < 0) return { prompt: 'Answer', answer: line };
      return { prompt: line.slice(0, idx), answer: line.slice(idx + 2) };
    });
  }, [answer, status]);

  const qCount = payload.questions.length;
  // When expired or cancelled, render the questions in a disabled/readonly state
  // so the user can see what was asked but cannot interact with the inputs.
  const isDisabled = !isPending && (status === 'expired' || status === 'cancelled');
  // For answered/skipped questionnaires with a recorded answer, show the readonly
  // answer summary. For expired/cancelled, show the disabled question form instead.
  const showDisabledForm = isDisabled;
  const showReadonlyAnswers = !isPending && !isDisabled;

  return (
    <Box sx={{
      borderRadius: '10px',
      border: `1px solid ${isPending ? alphaColor(colors.accent.blue, '35') : colors.border.default}`,
      bgcolor: colors.bg.secondary,
      overflow: 'hidden',
      maxWidth: 520,
    }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1,
        py: 0.5,
        borderBottom: `1px solid ${colors.border.subtle}`,
        bgcolor: colors.bg.tertiary,
      }}>
        <Typography sx={{
          fontSize: '0.48rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: isPending ? colors.accent.blue : colors.text.dim,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Questionnaire
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
            {sourceLabel(record, agentName)}
          </Typography>
          {!isPending && (
            <Typography sx={{
              fontSize: '0.48rem',
              color: status === 'skipped' ? colors.text.dim : status === 'expired' || status === 'cancelled' ? colors.accent.red : colors.accent.green,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {status === 'skipped' ? 'skipped' : status === 'expired' ? 'expired' : status === 'cancelled' ? 'cancelled' : 'answered'}
            </Typography>
          )}
        </Box>
      </Box>

      {isPending || showDisabledForm ? (
        <>
          {payload.questions.map((question, index) => (
            <Box key={question.id} sx={{ borderBottom: index < qCount - 1 ? `1px solid ${colors.border.subtle}` : undefined }}>
              <Box sx={{ px: 1, pt: 0.65, pb: 0.25 }}>
                <Typography sx={{
                  fontSize: '0.48rem',
                  color: colors.text.dim,
                  fontFamily: "'JetBrains Mono', monospace",
                  mb: 0.25,
                }}>
                  {qCount > 1 ? `Q${index + 1}` : 'Question'}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', color: colors.text.primary, lineHeight: 1.45 }}>
                  {question.prompt}
                </Typography>
              </Box>
              <QuestionBlockRenderer
                question={question}
                state={state}
                onStateChange={handleStateChange}
                focusIdx={getFocusIdx(question.id)}
                onFocusIdx={(idx) => setFocusIdx(question.id, idx)}
                listRef={{ current: null }}
                onSubmit={handleSubmit}
                onSkip={handleSkip}
                disabled={isDisabled}
              />
            </Box>
          ))}
          {isPending && (
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 0.75,
              px: 1,
              py: 0.5,
              borderTop: `1px solid ${colors.border.subtle}`,
            }}>
              {payload.allowSkip !== false && (
                <Button size="small" onClick={handleSkip} sx={{
                  minWidth: 0, px: 0.75, fontSize: '0.55rem', textTransform: 'none', color: colors.text.dim,
                }}>
                  Skip
                </Button>
              )}
              <Box sx={{ flex: 1 }} />
              {onCancel && (
                <Button size="small" onClick={onCancel} sx={{
                  minWidth: 0, px: 0.75, fontSize: '0.55rem', textTransform: 'none',
                  color: colors.accent.red,
                  '&:hover': { bgcolor: alphaColor(colors.accent.red, '12') },
                }}>
                  Cancel
                </Button>
              )}
              <Button size="small" disabled={!canSubmit} onClick={handleSubmit} sx={{
                minWidth: 0, px: 1, fontSize: '0.55rem', textTransform: 'none',
                bgcolor: colors.accent.blue, color: colors.bg.primary,
                '&:hover': { bgcolor: alphaColor(colors.accent.blue, 'cc') },
                '&.Mui-disabled': { bgcolor: colors.bg.hover, color: colors.text.dim },
              }}>
                {payload.submitLabel ?? 'Submit'}
              </Button>
            </Box>
          )}
        </>
      ) : showReadonlyAnswers ? (
        <Box sx={{ px: 1, py: 0.65 }}>
          {answeredLines.map((row, i) => (
            <ReadonlyAnswer key={i} prompt={row.prompt} answer={row.answer} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
