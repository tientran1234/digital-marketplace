/**
 * The demo corpus: the documents `pnpm db:seed` indexes, and the documents the
 * eval suite in `evals/` asks its questions about. They live here rather than
 * inline in the seed script so the eval measures the same text a fresh install
 * gets — a question that drifts off the corpus fails the suite instead of
 * quietly scoring zero.
 */
export interface SeedDoc {
  slug: string;
  title: string;
  description: string;
  priceMinor: number;
  text: string;
}

export const seedDocs: SeedDoc[] = [
  {
    slug: "saas-pricing-playbook",
    title: "SaaS Pricing Playbook",
    description: "How to choose plans, price points and quotas for a small SaaS — with worked examples.",
    priceMinor: 1900,
    text: `# SaaS Pricing Playbook

## Why three plans
Three plans give buyers a reference point. The middle plan is the one you want most people on; the top plan exists to make the middle look reasonable. A fourth plan buys you nothing but a longer comparison table.

## Choosing quotas
Quotas should track the cost driver, not the value driver. If AI messages cost you money per call, meter messages. Never meter seats if seats do not cost you anything. One metered quantity per plan is the ceiling; buyers cannot forecast two.

## Refunds
Offer a fourteen day refund window with no questions asked. Refund requests are a signal about onboarding, not about pricing. Track the reason codes and read them monthly.

## Annual billing
Annual plans reduce churn but concentrate cash flow. Discount fifteen to twenty percent and require payment up front. Never offer annual billing on the cheapest plan — the support load is the same and the cash is not worth the accounting.

## Free trials
Fourteen days is long enough for a team to reach the first useful outcome and short enough to keep urgency. Do not ask for a card up front unless abuse is already a problem; requiring one roughly halves signups and raises trial to paid conversion by less than that.

## Usage-based add-ons
Sell overage as a pack, not as a meter that ticks. A buyer who has bought a pack of a thousand extra messages knows what they spent; a buyer watching a meter opens the billing page every morning and eventually cancels out of anxiety.

## Grandfathering
When you raise prices, leave existing customers on the old price for at least twelve months and tell them so in the same email that announces the change. The goodwill costs less than the churn, and the announcement is the part people remember.

## Discounts and coupons
A public discount is a price cut with extra steps. Keep coupons private, time boxed, and capped in number. Never discount deeper than twenty percent without also shortening the term.

## Enterprise quotes
Below roughly two thousand dollars a year, a quote costs more to produce than the deal returns. Publish a price up to that line and take calls above it. The first enterprise deal will ask for a security review, invoicing in arrears, and a custom contract — budget two weeks.

## Taxes and currency
Price in the buyer's currency but settle in yours. Sales tax and VAT are the merchant of record's problem; if you do not want that problem, use a merchant of record and pay the percentage. Rounding a converted price to a clean number is worth more than the few cents it costs.

## Measuring a price change
Compare cohorts, not months. The cohort that signed up after the change is the only honest comparison, and it takes a full billing cycle plus the refund window before the numbers mean anything. Watch trial to paid conversion first; revenue per signup moves later.

## Churn and downgrades
A downgrade is a save, not a loss — make it one click and ask one question on the way. Involuntary churn from expired cards is usually a larger number than anyone expects; dunning with three retries over ten days recovers most of it.`,
  },
  {
    slug: "notion-second-brain-template",
    title: "Second Brain Notion Template",
    description: "A PARA-based Notion workspace with weekly review checklists. Free.",
    priceMinor: 0,
    text: `# Second Brain Template

## Structure
Four top-level databases: Projects, Areas, Resources, Archive. Every note links to exactly one of them. Nothing lives outside the four; a note with no home is a note you will never find again.

## Capture
Use the mobile shortcut to capture into the inbox. Do not file while capturing — deciding where something belongs is the slow part, and doing it at capture time is how people stop capturing.

## Weekly review
Every Friday: clear the inbox, move finished projects to Archive, pick three outcomes for next week. The review takes about twenty minutes once the inbox habit holds.

## Projects database
A project has an outcome and a deadline. If it has neither, it is an area, not a project. The status field has four values: Planning, Active, Paused, Done. Keep no more than five projects Active at once.

## Areas database
An area is a standard to maintain rather than a thing to finish — health, finances, the team you manage. Areas never get a deadline and never move to Archive while you still hold the responsibility.

## Resources and tags
Resources are reference material: articles, snippets, receipts. Tag by topic, never by project, so a resource survives the project that made you save it. Three tags per item is plenty.

## Archive rules
Archive is not a delete. Move a project there the week it finishes, with its notes attached, and leave the links intact so the search still reaches it. Nothing is ever deleted from the template.

## Daily notes
The daily note is a scratchpad, not a journal. Anything worth keeping gets promoted into a project or a resource during the weekly review; the rest is allowed to rot.

## Syncing and offline
Notion syncs through its own service, so the template needs no extra integration. Offline edits on mobile queue until the app reconnects; editing the same block on two devices while offline resolves last write wins, which is the one place the template can lose text.`,
  },
];
