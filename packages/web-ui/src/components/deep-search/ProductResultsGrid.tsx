import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import type { DeepSearchResult } from '@agentx/shared/browser';
import { colors, alphaColor } from '../../theme';
import { openSearchResultUrl } from './card-utils';

function ProductImage({ result }: { result: DeepSearchResult }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = result.extracted.imageUrl;
  if (!imageUrl || failed) {
    return (
      <Box sx={{
        height: 148,
        display: 'grid',
        placeItems: 'center',
        bgcolor: alphaColor(colors.accent.cyan, '08'),
        color: colors.text.dim,
      }}>
        <ShoppingBagOutlinedIcon sx={{ fontSize: 34, opacity: 0.45 }} />
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={imageUrl}
      alt=""
      onError={() => setFailed(true)}
      sx={{ width: '100%', height: 148, objectFit: 'cover', display: 'block', bgcolor: colors.bg.secondary }}
    />
  );
}

function ratingLabel(result: DeepSearchResult): string | null {
  const { rating, reviewCount } = result.extracted;
  if (!rating) return null;
  return `${rating}${reviewCount ? ` · ${reviewCount} reviews` : ''}`;
}

export function ProductResultsGrid({ results }: { results: DeepSearchResult[] }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      gap: 0.85,
      p: 0.85,
    }}>
      {results.map((result, index) => {
        const rating = ratingLabel(result);
        return (
          <Box
            key={result.id}
            role="link"
            tabIndex={0}
            onClick={() => openSearchResultUrl(result.url)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openSearchResultUrl(result.url);
              }
            }}
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              borderRadius: 1.25,
              border: `1px solid ${colors.border.default}`,
              bgcolor: alphaColor(colors.accent.cyan, '05'),
              cursor: 'pointer',
              transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
              '&:hover, &:focus-visible': {
                transform: 'translateY(-2px)',
                borderColor: alphaColor(colors.accent.cyan, '55'),
                boxShadow: `0 8px 22px ${alphaColor(colors.accent.cyan, '12')}`,
                outline: 'none',
              },
            }}
          >
            <ProductImage result={result} />
            <Box sx={{ p: 0.85, minWidth: 0 }}>
              <Typography sx={{
                fontSize: '0.68rem',
                fontWeight: 650,
                color: colors.text.primary,
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {result.title}
              </Typography>
              <Typography sx={{
                mt: 0.45,
                fontSize: '0.52rem',
                color: colors.text.dim,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {result.extracted.brand || result.domain}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.45, mt: 0.65, minHeight: 18 }}>
                {result.extracted.price && (
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: colors.accent.green }}>
                    {result.extracted.price}
                  </Typography>
                )}
                {rating && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.15, minWidth: 0 }}>
                    <StarRoundedIcon sx={{ fontSize: 13, color: colors.accent.orange }} />
                    <Typography sx={{ fontSize: '0.49rem', color: colors.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rating}
                    </Typography>
                  </Box>
                )}
              </Box>
              {result.extracted.reviewHighlights?.[0] && (
                <Typography sx={{
                  mt: 0.55,
                  fontSize: '0.5rem',
                  color: colors.text.secondary,
                  fontStyle: 'italic',
                  lineHeight: 1.35,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  “{result.extracted.reviewHighlights[0]}”
                </Typography>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.65 }}>
                <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                  #{index + 1} · {Math.round(result.scores.final * 100)}% match
                </Typography>
                <OpenInNewIcon sx={{ fontSize: 12, color: colors.text.dim }} />
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
