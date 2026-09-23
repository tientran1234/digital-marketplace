/**
 * Forty questions over the two seed documents: what a buyer would actually
 * type into the ask box, with the passage that answers it and the fact the
 * answer has to carry.
 *
 * `passages` names headings rather than chunk ordinals so the set survives a
 * change to the chunker — retrieval is what is under test, not the offsets.
 * Six questions have no answer in the corpus; refusing them is the score.
 */
export interface EvalQuestion {
  id: string;
  /** Slug of the seed product the question is asked about. */
  slug: string;
  question: string;
  /** Headings of the chunks that hold the answer. Empty: the corpus does not answer it. */
  passages: string[];
  /** Every pattern must appear in the answer. Empty for the unanswerable six. */
  answer: RegExp[];
  /** Patterns that would only appear in a made-up answer. */
  reject?: RegExp[];
}

const pricing = (n: number, question: string, passages: string[], answer: RegExp[], reject?: RegExp[]): EvalQuestion => ({
  id: `pricing-${String(n).padStart(2, "0")}`,
  slug: "saas-pricing-playbook",
  question,
  passages,
  answer,
  ...(reject ? { reject } : {}),
});

const brain = (n: number, question: string, passages: string[], answer: RegExp[], reject?: RegExp[]): EvalQuestion => ({
  id: `brain-${String(n).padStart(2, "0")}`,
  slug: "notion-second-brain-template",
  question,
  passages,
  answer,
  ...(reject ? { reject } : {}),
});

export const questions: EvalQuestion[] = [
  pricing(1, "How many plans should a small SaaS offer?", ["Why three plans"], [/three plans/i]),
  pricing(2, "Should quotas follow the cost driver or the value driver?", ["Choosing quotas"], [/cost driver/i]),
  pricing(3, "Is it a good idea to charge per seat?", ["Choosing quotas"], [/seats/i]),
  pricing(4, "How long is the refund window?", ["Refunds"], [/fourteen day/i]),
  pricing(5, "Do buyers have to give a reason when they ask for a refund?", ["Refunds"], [/no questions asked/i]),
  pricing(6, "What discount should annual billing get?", ["Annual billing"], [/fifteen to twenty percent/i]),
  pricing(7, "How long should a free trial run?", ["Free trials"], [/fourteen days/i]),
  pricing(8, "Should the free trial ask for a credit card up front?", ["Free trials"], [/card up front/i]),
  pricing(9, "How should I sell overage on top of a plan?", ["Usage-based add-ons"], [/pack/i]),
  pricing(10, "Why not show buyers a usage meter that ticks?", ["Usage-based add-ons"], [/anxiety/i]),
  pricing(11, "How long do existing customers keep the old price after a price rise?", ["Grandfathering"], [/twelve months/i]),
  pricing(12, "Should coupons be public?", ["Discounts and coupons"], [/private/i]),
  pricing(13, "How deep can a discount go before it needs a shorter term?", ["Discounts and coupons"], [/twenty percent/i]),
  pricing(14, "Above what deal size is a sales call worth making?", ["Enterprise quotes"], [/two thousand dollars/i]),
  pricing(15, "What does the first enterprise customer usually ask for?", ["Enterprise quotes"], [/security review/i]),
  pricing(16, "Which currency should I price in?", ["Taxes and currency"], [/buyer's currency/i]),
  pricing(17, "Who is responsible for VAT and sales tax?", ["Taxes and currency"], [/merchant of record/i]),
  pricing(18, "How do I tell whether a price change worked?", ["Measuring a price change"], [/cohort/i]),
  pricing(19, "Which number moves first after a price change?", ["Measuring a price change"], [/trial to paid/i]),
  pricing(20, "What should happen when a customer wants to downgrade?", ["Churn and downgrades"], [/one click/i]),
  pricing(21, "How many dunning retries recover an expired card?", ["Churn and downgrades"], [/three retries/i]),
  pricing(22, "Which payment processor should I use for seller payouts?", [], [], [/stripe/i, /paypal/i]),
  pricing(23, "Does the playbook recommend a referral programme?", [], [], [/referral/i]),
  pricing(24, "How do I hire my first salesperson?", [], [], [/salesperson/i]),

  brain(1, "How many top-level databases does the template have?", ["Structure"], [/four/i]),
  brain(2, "How many of the four databases does a note link to?", ["Structure"], [/exactly one/i]),
  brain(3, "Should I file a note while I am capturing it?", ["Capture"], [/do not file/i]),
  brain(4, "How do I capture something from my phone?", ["Capture"], [/mobile shortcut/i]),
  brain(5, "Which day is the weekly review on?", ["Weekly review"], [/friday/i]),
  brain(6, "How long does the weekly review take?", ["Weekly review"], [/twenty minutes/i]),
  brain(7, "What makes something a project rather than an area?", ["Projects database"], [/outcome and a deadline/i]),
  brain(8, "How many projects should be active at once?", ["Projects database"], [/five projects/i]),
  brain(9, "Do areas get a deadline?", ["Areas database"], [/never get a deadline/i]),
  brain(10, "How should resources be tagged?", ["Resources and tags"], [/by topic/i]),
  brain(11, "When should a finished project move to the archive?", ["Archive rules"], [/the week it finishes/i]),
  brain(12, "What happens to what I wrote in the daily note?", ["Daily notes"], [/promoted/i]),
  brain(13, "What happens if I edit the same block offline on two devices?", ["Syncing and offline"], [/last write wins/i]),
  brain(14, "Does the template include a Gantt chart view?", [], [], [/gantt/i]),
  brain(15, "How do I export my notes to Obsidian?", [], [], [/obsidian/i]),
  brain(16, "Does the template support handwriting on a tablet?", [], [], [/handwriting/i]),
];

export const answerable = (q: EvalQuestion) => q.passages.length > 0;
