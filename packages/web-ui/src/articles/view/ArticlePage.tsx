import { memo, type MouseEvent, useMemo } from 'react';
import Box from '@mui/material/Box';
import { handleExternalAnchorClick } from '../../utils/open-external-url';
import { articleKindKicker, type ArticleKind } from '@agentx/shared/browser';
import { compileArticle } from '../compile';
import { ArticleView } from './ArticleView';

/** Compile a saved article and render the designed page. */
export const ArticlePage = memo(function ArticlePage({
  content,
  title,
  createdAt,
  sessionId,
  kind,
}: {
  content: string;
  title?: string;
  createdAt?: string;
  sessionId?: string | null;
  kind?: ArticleKind;
}) {
  const article = useMemo(
    () => compileArticle({ content, title, kicker: articleKindKicker(kind ?? 'article') }),
    [content, title, kind],
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    handleExternalAnchorClick(event);
  };

  return (
    <Box onClickCapture={handleClick} sx={{ minWidth: 0, width: '100%' }}>
      <ArticleView
        article={article}
        createdAt={createdAt}
        sessionId={sessionId}
        kind={kind}
      />
    </Box>
  );
});
