export type ConsumerRequestKind = 'shopping' | 'booking' | 'travel' | 'finance' | null;

export interface RequestProfile {
  consumerKind: ConsumerRequestKind;
  isConsumerRequest: boolean;
  requiresMultiStep: boolean;
  requiresFreshData: boolean;
}

const SHOPPING_RE = /\b(shop|shopping|buy|purchase|product|price|deal|deals|discount|retailer|store|amazon|ebay|etsy)\b/i;
const BUDGETED_PRODUCT_RE = /\b(?:find|looking\s+for|recommend)\b.*\b(?:under|below|within)\s+\$?\d/i;
const BOOKING_RE = /\b(?:flight|flights|hotel|hotels|airbnb|train|rental car|car rental|travel tickets?|event tickets?)\b/i;
const BOOKING_ACTION_RE = /\b(?:book|booking|reserve|reservation)\b.*\b(?:trip|travel|room|hotel|flight|train|car|ticket|table)\b/i;
const TRAVEL_RE = /\b(vacation|holiday|trip|travel|itinerary|เที่ยว|旅游|tour)\b/i;
const FINANCE_RE = /\b(finance|financial|budget|tax|taxes|investment|investing|portfolio|stock|stocks|shares|loan|mortgage|cash flow|profit|revenue|expense|expenses|accounting)\b/i;
const FRESH_RE = /\b(latest|current|today|now|price|prices|availability|available|schedule|schedules|rate|rates|deal|deals|book|booking|reserve|reservation)\b/i;
const MULTI_STEP_RE = /\b(compare|comparison|versus|vs\.?|options|recommend|recommendation|plan|planning|itinerary|optimize|optimise|forecast|analy[sz]e|research|shortlist|best|top|multiple|several|for the next|over the next)\b/i;

export function classifyConsumerRequest(text: string): ConsumerRequestKind {
  const lower = text.toLowerCase();
  if (BOOKING_RE.test(lower) || BOOKING_ACTION_RE.test(lower)) return 'booking';
  if (TRAVEL_RE.test(lower)) return 'travel';
  if (SHOPPING_RE.test(lower) || BUDGETED_PRODUCT_RE.test(lower)) return 'shopping';
  if (FINANCE_RE.test(lower)) return 'finance';
  return null;
}

export function profileRequest(text: string): RequestProfile {
  const trimmed = text.trim();
  const consumerKind = classifyConsumerRequest(trimmed);
  const isConsumerRequest = consumerKind !== null;
  return {
    consumerKind,
    isConsumerRequest,
    requiresFreshData: isConsumerRequest && FRESH_RE.test(trimmed),
    requiresMultiStep: MULTI_STEP_RE.test(trimmed) || trimmed.length > 240,
  };
}
