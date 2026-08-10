import { getLogger } from '@agentx/shared';
import { createHash } from 'node:crypto';

export type ReasoningMode = 'quick' | 'deep' | 'creative' | 'tree';

/**
 * Derive a reasoning mode from the detected category and user message text.
 * Replaces the old PromptEngine.detectIntent() reasoning mode logic.
 */
export function deriveReasoningMode(category: string, text: string): ReasoningMode {
  const lower = text.toLowerCase();
  // Tree of Thoughts — explicit triggers
  const treeTriggers = ['tree of thoughts', 'explore multiple paths', 'consider alternatives', 'brainstorm approaches', 'evaluate options'];
  if (treeTriggers.some((t) => lower.includes(t))) return 'tree';
  // Deep reasoning — analytical/research categories
  if (category === 'analysis' || category === 'research' || category === 'datascience') return 'deep';
  // Creative reasoning
  if (category === 'creative') return 'creative';
  // Default: quick
  return 'quick';
}

export interface CategoryScore {
  category: string;
  score: number;
  matchedSignals: string[];
}

export interface IntentMatch {
  primary: string;
  sub?: string;
  confidence: number;
  signals: string[];
}

export interface CategoryResult {
  primary: string;
  sub?: string;
  confidence: number;
  signals?: string[];
  runnerUp?: string;
  /** When multi-intent is detected, secondary intents are populated */
  secondaryIntents?: IntentMatch[];
  /** Detection method: 'cache' | 'regex' | 'embedding' | 'fallback' */
  detectionMethod?: string;
}

interface CategoryPattern {
  category: string;
  sub?: string;
  patterns: RegExp[];
  weight: number;
  signals: string[];
}

export interface EmbeddingCategoryProvider {
  /** Compute embedding for a text query */
  embed(text: string): Promise<number[]>;
  /** Compare query embedding against category prototypes, return ranked matches */
  classify(embedding: number[]): Promise<Array<{ category: string; sub?: string; score: number }>>;
}

/**
 * Semantic category detector with:
 * - Weighted multi-pattern scoring
 * - Multi-intent detection (returns secondary intents)
 * - LRU detection cache (message hash → result)
 * - Confidence calibration (score → [0,1] probability)
 * - Optional embedding-based fallback for ambiguous cases
 */
export class CategoryDetector {
  private patterns: CategoryPattern[] = [
    // Finance
    { category: 'finance', sub: 'tax', weight: 3, signals: ['tax'], patterns: [/\btax\b/i, /\btaxable\b/i] },
    { category: 'finance', sub: 'compound', weight: 3, signals: ['compound-interest'], patterns: [/\bcompound\b/i, /\binterest\s+rate\b/i] },
    { category: 'finance', sub: 'break-even', weight: 3, signals: ['break-even'], patterns: [/\bbreak[- ]?even\b/i] },
    { category: 'finance', sub: 'roi', weight: 2, signals: ['roi'], patterns: [/\broi\b/i, /\breturn\s+on\s+investment\b/i] },
    { category: 'finance', sub: 'calculation', weight: 2, signals: ['finance'], patterns: [/\bbudget\b/i, /\bforecast\b/i, /\binvoice\b/i, /\bp&l\b/i, /\bprofit\b/i, /\bloss\b/i] },
    { category: 'finance', sub: 'personal', weight: 3, signals: ['personal-finance'], patterns: [/\bpersonal\s+finance\b/i, /\bmy\s+(?:budget|savings|expenses|portfolio)\b/i, /\bretirement\b/i] },
    { category: 'finance', sub: 'corporate', weight: 3, signals: ['corporate-finance'], patterns: [/\bcorporate\s+finance\b/i, /\bcash\s*flow\b/i, /\bfinancial\s+model\b/i, /\bfinancial\s+statements?\b/i] },

    // Shopping, travel, and bookings — consumer workflows should be routed
    // to the right live-data/integration tools without requiring technical
    // wording from the user.
    { category: 'shopping', sub: 'product', weight: 3, signals: ['shopping'], patterns: [/\b(?:shop|shopping|buy|purchase|price|deal|retailer|amazon|ebay|etsy)\b/i, /\bproducts?\s+(?:to buy|to purchase|recommend(?:ed)?|worth buying)\b/i] },
    { category: 'booking', sub: 'travel', weight: 3, signals: ['booking'], patterns: [/\b(?:flight|hotel|airbnb|train|rental car|travel tickets?|event tickets?)\b/i, /\b(?:book|booking|reserve|reservation)\b.*\b(?:trip|travel|room|hotel|flight|train|car|ticket|table)\b/i] },
    { category: 'travel', sub: 'planning', weight: 3, signals: ['travel-planning'], patterns: [/\b(?:vacation|holiday|trip|travel|itinerary)\b/i] },

    // Marketing
    { category: 'marketing', sub: 'tweet', weight: 3, signals: ['tweet'], patterns: [/\btweet\b/i, /\bsocial\s+post\b/i] },
    { category: 'marketing', sub: 'hero', weight: 3, signals: ['hero-section'], patterns: [/\bhero\s+section\b/i, /\bhero\s+copy\b/i] },
    { category: 'marketing', sub: 'email', weight: 3, signals: ['email-campaign'], patterns: [/\bemail\s+campaign\b/i, /\bcold\s+email\b/i] },
    { category: 'marketing', sub: 'copy', weight: 2, signals: ['marketing'], patterns: [/\bad\s+copy\b/i, /\bcampaign\b/i, /\bseo\b/i, /\bfunnel\b/i, /\bmarketing\b/i] },

    // Analysis — SWOT and sentiment are sub-categories of analysis
    { category: 'analysis', sub: 'swot', weight: 3, signals: ['swot'], patterns: [/\bswot\b/i, /\bstrengths.*weaknesses/i, /\bopportunities.*threats/i] },
    { category: 'analysis', sub: 'sentiment', weight: 3, signals: ['sentiment'], patterns: [/\bsentiment\b/i, /\bpositive.*negative.*review/i, /\bclassify.*review\b/i] },
    { category: 'analysis', sub: 'data', weight: 3, signals: ['csv-data'], patterns: [/\.csv\b/i, /\bsales\.csv\b/i, /\btotal\s+revenue\b/i, /\bbest\s+month\b/i] },
    { category: 'analysis', sub: 'anomaly', weight: 3, signals: ['anomaly'], patterns: [/\banomaly\b/i, /\banomalies\b/i, /\boutlier\b/i] },
    { category: 'analysis', sub: 'trend', weight: 3, signals: ['trend'], patterns: [/\btrend\b/i, /\bgrowth\s+rate\b/i] },
    { category: 'analysis', sub: 'data', weight: 2, signals: ['data-analysis'], patterns: [/\.xlsx\b/i, /\bmetrics\b/i, /\baudit\b/i, /\bperformance\s+report\b/i, /\bstats\b/i, /\banalyze\s+data\b/i] },

    // Research
    { category: 'research', weight: 2, signals: ['research'], patterns: [/\bresearch\b/i, /\binvestigate\b/i, /\bwhat\s+is\b/i, /\bhow\s+does\b/i, /\bwhy\s+does\b/i, /\bexplain\b/i, /\bwiki\b/i, /\barticle\b/i, /\bcompare\b/i] },

    // Websearch — deep web search skill
    { category: 'websearch', sub: 'realtime', weight: 3, signals: ['realtime-search'], patterns: [/\blatest\b/i, /\bcurrent\b/i, /\btoday'?s\b/i, /\brecent\b/i, /\bup[- ]?to[- ]?date\b/i, /\bjust\s+happened\b/i] },
    { category: 'websearch', sub: 'fact-check', weight: 3, signals: ['fact-check'], patterns: [/\bfact[- ]?check\b/i, /\bverify\s+(?:this|the|a)\b/i, /\bis\s+(?:this|that)\s+true\b/i, /\btrue\s+or\s+false\b/i, /\bdebunk\b/i] },
    { category: 'websearch', sub: 'people', weight: 3, signals: ['people-search'], patterns: [/\bwho\s+is\b/i, /\bfind\s+(?:information\s+)?about\s+(?:a\s+)?person\b/i, /\bbio(?:graphy)?\b/i] },
    { category: 'websearch', sub: 'news', weight: 3, signals: ['news-search'], patterns: [/\bnews\s+(?:about|on)\b/i, /\bheadlines?\b/i, /\bbreaking\b/i, /\bcurrent\s+events\b/i] },
    { category: 'websearch', sub: 'general', weight: 2, signals: ['websearch'], patterns: [/\bsearch\s+(?:the\s+)?web\b/i, /\bgoogle\b/i, /\blook\s+up\b/i, /\bfind\s+online\b/i, /\bweb\s+search\b/i, /\bonline\s+source\b/i] },

    // Creative
    { category: 'creative', sub: 'story', weight: 3, signals: ['story'], patterns: [/\bstory\b/i, /\bnarrative\b/i] },
    { category: 'creative', sub: 'poem', weight: 3, signals: ['poem'], patterns: [/\bpoem\b/i, /\bpoetry\b/i, /\bverse\b/i] },
    { category: 'creative', sub: 'script', weight: 3, signals: ['script'], patterns: [/\bscript\b/i, /\bscreenplay\b/i] },
    { category: 'creative', sub: 'dialogue', weight: 3, signals: ['dialogue'], patterns: [/\bdialogue\b/i, /\bconversation\s+between\b/i] },
    { category: 'creative', weight: 2, signals: ['creative'], patterns: [/\bbrainstorm\b/i, /\bcreative\b/i, /\bsci-fi\b/i, /\bscifi\b/i] },

    // Content
    { category: 'content', sub: 'summarize', weight: 3, signals: ['summarize'], patterns: [/\bsummarize\b/i, /\bsummary\b/i, /\btldr\b/i] },
    { category: 'content', sub: 'rewrite', weight: 3, signals: ['rewrite'], patterns: [/\brewrite\b/i, /\brephrase\b/i, /\bparaphrase\b/i] },
    { category: 'content', sub: 'headline', weight: 3, signals: ['headline'], patterns: [/\bheadline\b/i, /\btitle\b/i] },
    { category: 'content', sub: 'extract', weight: 3, signals: ['keywords'], patterns: [/\bkeywords?\b/i, /\bextract\s+key\b/i] },
    { category: 'content', weight: 2, signals: ['content'], patterns: [/\bdraft\b/i, /\bblog\b/i, /\bproofread\b/i, /\bedit\s+text\b/i] },

    // Documentation — technical writing skill
    { category: 'documentation', sub: 'api-doc', weight: 3, signals: ['api-doc'], patterns: [/\bapi\s+(?:doc|reference|documentation)\b/i, /\bopenapi\b/i, /\bswagger\b/i, /\bendpoint\s+doc/i] },
    { category: 'documentation', sub: 'readme', weight: 3, signals: ['readme'], patterns: [/\breadme\b/i, /\bcontributing\s+guide\b/i, /\bchangelog\b/i] },
    { category: 'documentation', sub: 'tutorial', weight: 3, signals: ['tutorial'], patterns: [/\btutorial\b/i, /\bhow[- ]?to\s+guide\b/i, /\bstep[- ]?by[- ]?step\b/i, /\bwalkthrough\b/i] },
    { category: 'documentation', sub: 'architecture', weight: 3, signals: ['architecture-doc'], patterns: [/\barchitecture\s+(?:doc|document|overview)\b/i, /\bdesign\s+doc\b/i, /\brfc\b/i, /\btechnical\s+spec\b/i] },
    { category: 'documentation', sub: 'general', weight: 2, signals: ['documentation'], patterns: [/\bdocumentation\b/i, /\bdocumenting\b/i, /\buser\s+guide\b/i, /\bmanual\b/i, /\bdocs\b/i] },

    // Communication
    { category: 'communication', weight: 2, signals: ['communication'], patterns: [/\bsend\s+message\b/i, /\bnotify\b/i, /\bremind\b/i, /\bschedule\s+meeting\b/i, /\bmeeting\b/i, /\bslack\b/i, /\btelegram\b/i, /\bescalat/i, /\bdelay\b/i] },

    // Edge — safety boundary detection (not a TurnCategory, handled specially)
    { category: 'edge', weight: 3, signals: ['edge'], patterns: [/outside\s+(?:the\s+)?workspace/i, /outside\s+(?:the\s+)?scope/i, /forbidden\s+path/i, /read\s+.*passwd/i, /read\s+.*\/etc\//i, /read\s+.*\/var\//i, /read\s+.*\/tmp\//i, /read\s+['"]?\s*(?:\/|[A-Za-z]:\\)/i] },

    // Coding
    { category: 'coding', sub: 'debug', weight: 3, signals: ['debug'], patterns: [/\bdebug\b/i, /\bbug\b/i, /\bstack\s+trace\b/i, /\berror\s+message\b/i, /\bcrash\b/i, /\bexception\b/i] },
    { category: 'coding', sub: 'refactor', weight: 3, signals: ['refactor'], patterns: [/\brefactor\b/i, /\brestructure\b/i, /\bclean\s+up\s+code\b/i] },
    { category: 'coding', sub: 'review', weight: 3, signals: ['review'], patterns: [/\bcode\s+review\b/i, /\breview\s+(?:this|the)\s+(?:code|function|file|class)\b/i] },
    { category: 'coding', sub: 'test', weight: 3, signals: ['test'], patterns: [/\bunit\s+test/i, /\bwrite\s+test/i, /\btest\s+case/i, /\bjest\b/i, /\bpytest\b/i] },
    { category: 'coding', sub: 'write', weight: 2, signals: ['coding'], patterns: [/\bfunction\b/i, /\bclass\b/i, /\balgorithm\b/i, /\bimplement\b/i, /\btypescript\b/i, /\bpython\b/i, /\bjavascript\b/i, /\brust\b/i, /\bgo\s+lang\b/i, /\bjava\b/i, /\bapi\b/i, /\bendpoint\b/i, /\bsnippet\b/i] },
    { category: 'coding', sub: 'convert', weight: 3, signals: ['convert'], patterns: [/\bconvert\b.*(?:python|typescript|javascript|java|rust|go|c\+\+)/i, /(?:python|typescript|javascript|java|rust|go|c\+\+).*\bconvert\b/i, /\bport\b.*(?:from|to)\b/i] },

    // Data Science / ML
    { category: 'datascience', sub: 'model', weight: 3, signals: ['ml-model'], patterns: [/\bmachine\s+learning\b/i, /\bml\b\s+model/i, /\bneural\s+network\b/i, /\btransformer\b/i, /\bclassifier\b/i, /\bregression\b/i, /\bdeep\s+learning\b/i] },
    { category: 'datascience', sub: 'feature-engineering', weight: 3, signals: ['feature-engineering'], patterns: [/\bfeature\s+engineering\b/i, /\bfeature\s+selection\b/i, /\bfeature\s+extract/i, /\bencoding\b/i, /\bnormaliz/i, /\bscaling\b/i] },
    { category: 'datascience', sub: 'metrics', weight: 3, signals: ['ml-metrics'], patterns: [/\bprecision\b.*\brecall\b/i, /\bf1\s+score\b/i, /\baccuracy\b/i, /\bconfusion\s+matrix\b/i, /\bauc\b/i, /\broc\b/i, /\bgradient\s+descent\b/i] },
    { category: 'datascience', sub: 'pipeline', weight: 3, signals: ['ml-pipeline'], patterns: [/\btraining\s+pipeline\b/i, /\bdata\s+pipeline\b/i, /\bmodel\s+training\b/i, /\bmodel\s+deploy/i, /\binference\b/i, /\bembedding\b/i] },
    { category: 'datascience', sub: 'general', weight: 2, signals: ['datascience'], patterns: [/\bdata\s+science\b/i, /\bpandas\b/i, /\bnumpy\b/i, /\btensorflow\b/i, /\bpytorch\b/i, /\bscikit/i, /\bjupyter\b/i, /\bnotebook\b/i] },
  ];

  private readonly CONFIDENCE_THRESHOLD = 2;
  private readonly MULTI_INTENT_THRESHOLD = 3;
  private readonly CACHE_SIZE = 128;

  private cache = new Map<string, { result: CategoryResult; timestamp: number }>();
  private embeddingProvider: EmbeddingCategoryProvider | null = null;

  /** Set an optional embedding-based fallback for ambiguous cases */
  setEmbeddingProvider(provider: EmbeddingCategoryProvider): void {
    this.embeddingProvider = provider;
  }

  /** Synchronous detection — uses regex scoring + cache */
  detect(text: string): CategoryResult {
    const hash = this.hashText(text);
    const cached = this.cache.get(hash);
    if (cached) {
      return { ...cached.result, detectionMethod: 'cache' };
    }

    const result = this.detectWithScoring(text);
    this.cache.set(hash, { result, timestamp: Date.now() });
    this.evictCache();
    return result;
  }

  /** Async detection — falls back to embedding for low-confidence cases */
  async detectAsync(text: string): Promise<CategoryResult> {
    const regexResult = this.detect(text);

    // If regex confidence is high, use it
    if (regexResult.confidence >= 0.6) {
      return regexResult;
    }

    // If embedding provider is available, try it for ambiguous cases
    if (this.embeddingProvider) {
      try {
        const embedding = await this.embeddingProvider.embed(text);
        const matches = await this.embeddingProvider.classify(embedding);
        if (matches.length > 0 && matches[0]!.score > 0.7) {
          const top = matches[0]!;
          const result: CategoryResult = {
            primary: top.category,
            sub: top.sub,
            confidence: top.score,
            signals: regexResult.signals,
            runnerUp: regexResult.primary,
            detectionMethod: 'embedding',
          };
          // Update cache with the better result
          const hash = this.hashText(text);
          this.cache.set(hash, { result, timestamp: Date.now() });
          return result;
        }
      } catch (err) {
        getLogger().warn('CATEGORY_DETECTOR', `Embedding fallback failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { ...regexResult, detectionMethod: regexResult.detectionMethod ?? 'regex' };
  }

  private detectWithScoring(text: string): CategoryResult {
    const lower = text.toLowerCase();
    const scores = new Map<string, CategoryScore>();

    for (const pattern of this.patterns) {
      for (const re of pattern.patterns) {
        if (re.test(lower)) {
          const key = pattern.sub ? `${pattern.category}:${pattern.sub}` : pattern.category;
          const existing = scores.get(key);
          if (existing) {
            existing.score += pattern.weight;
            existing.matchedSignals.push(...pattern.signals);
          } else {
            scores.set(key, {
              category: pattern.category,
              score: pattern.weight,
              matchedSignals: [...pattern.signals],
            });
          }
        }
      }
    }

    if (scores.size === 0) {
      return { primary: 'general', sub: undefined, confidence: 0, signals: [], detectionMethod: 'fallback' };
    }

    // Sort by score descending
    const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
    const runnerUp = sorted[1]?.[0];

    // Aggregate by primary category
    const primaryScores = new Map<string, number>();
    const primarySignals = new Map<string, string[]>();
    for (const [, score] of scores) {
      primaryScores.set(score.category, (primaryScores.get(score.category) ?? 0) + score.score);
      const sigs = primarySignals.get(score.category) ?? [];
      sigs.push(...score.matchedSignals);
      primarySignals.set(score.category, sigs);
    }
    const sortedPrimaries = [...primaryScores.entries()].sort((a, b) => b[1] - a[1]);
    const [topPrimary, topPrimaryScore] = sortedPrimaries[0]!;

    // Determine sub-category from the top-scoring sub within the winning primary
    let topSub: string | undefined;
    let bestSubScore = 0;
    for (const [key, score] of scores) {
      if (score.category === topPrimary) {
        const sub = key.includes(':') ? key.split(':')[1] : undefined;
        if (sub && score.score > bestSubScore) {
          bestSubScore = score.score;
          topSub = sub;
        }
      }
    }

    // ── Multi-intent detection ──
    // If a second primary category has a score >= MULTI_INTENT_THRESHOLD and
    // is a different category, it's a secondary intent
    const secondaryIntents: IntentMatch[] = [];
    for (let i = 1; i < sortedPrimaries.length; i++) {
      const [secPrimary, secScore] = sortedPrimaries[i]!;
      if (secScore >= this.MULTI_INTENT_THRESHOLD && secPrimary !== topPrimary) {
        // Find best sub for this secondary
        let secSub: string | undefined;
        let secBestSub = 0;
        for (const [key, score] of scores) {
          if (score.category === secPrimary) {
            const sub = key.includes(':') ? key.split(':')[1] : undefined;
            if (sub && score.score > secBestSub) {
              secBestSub = score.score;
              secSub = sub;
            }
          }
        }
        secondaryIntents.push({
          primary: secPrimary,
          sub: secSub,
          confidence: this.calibrateConfidence(secScore),
          signals: primarySignals.get(secPrimary) ?? [],
        });
      }
    }

    // ── Confidence calibration ──
    // Map raw score to [0,1] using a sigmoid-like function
    const confidence = this.calibrateConfidence(topPrimaryScore);

    const allSignals = primarySignals.get(topPrimary) ?? [];

    if (topPrimaryScore < this.CONFIDENCE_THRESHOLD) {
      getLogger().info('CATEGORY_DETECTOR', `Low confidence (${topPrimaryScore}) for "${text.slice(0, 80)}" — falling back to general. Runner-up: ${runnerUp ?? 'none'}`);
      return {
        primary: 'general',
        sub: undefined,
        confidence: 0,
        signals: allSignals,
        runnerUp: topPrimary,
        secondaryIntents: secondaryIntents.length > 0 ? secondaryIntents : undefined,
        detectionMethod: 'fallback',
      };
    }

    return {
      primary: topPrimary,
      sub: topSub,
      confidence,
      signals: allSignals,
      runnerUp: sortedPrimaries[1]?.[0],
      secondaryIntents: secondaryIntents.length > 0 ? secondaryIntents : undefined,
      detectionMethod: 'regex',
    };
  }

  /**
   * Calibrate raw score to [0,1] confidence using a saturating function.
   * Score 2 → ~0.4, score 4 → ~0.7, score 6+ → ~0.9+
   */
  private calibrateConfidence(score: number): number {
    // Sigmoid-like: 1 / (1 + exp(-0.5 * (score - 3)))
    return 1 / (1 + Math.exp(-0.5 * (score - 3)));
  }

  private hashText(text: string): string {
    return createHash('md5').update(text).digest('hex').slice(0, 16);
  }

  private evictCache(): void {
    if (this.cache.size <= this.CACHE_SIZE) return;
    // Evict oldest 25% (simple LRU approximation)
    const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = Math.floor(this.CACHE_SIZE * 0.25);
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i]![0]);
    }
  }

  /** Clear the detection cache (for testing) */
  clearCache(): void {
    this.cache.clear();
  }
}
