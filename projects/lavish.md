# Lavish Designs by Ke

## Type
Custom apparel, memorial items, and photo-gift website with quote/order workflows.

## Brand / direction
Domain: lavishbyke.com. Primary direction uses red; bronze is reduced. U.S. spelling and “organization” with z. Crown motion should respect reduced motion.

## Commerce model
Quote-first for custom work. Known baseline ideas include custom and text-only pricing references, but agents must use the live project as authority for any current customer-facing price. Larger shirt orders may require a deposit; turnaround/rush/shipping rules must be verified from current project copy before changing them.

## Critical apparel paths
Customers should clearly be able to choose:
- Upload My Design
- Create a Simple Design
- Design It For Me

Design It For Me must not assume the customer already has artwork.

## Critical customer-experience rules
- Confirmation emails/statuses must distinguish request received, quote stage, production, and shipping; do not make separate stages read like the same message.
- Custom quote language should sound human and professional without awkward claims about “a real person.”
- Mockup text must remain visible across shirt colors/text colors and placement changes.
- Pickup/shipping/address/payment wording must match the actual workflow.

## Critical QA
custom-shirt order, uploads, simple text designer, dark/light shirts, low contrast, placement/resize/center/reset, quote request, confirmation email rendering, mobile forms, order-status language, errors/empty states.

## Production guardrail
Staging and production are distinct. Verify live behavior rather than accepting a claimed fix.
## JMW Orchestration

```yaml
domain: website
l2_allowed: none
check_commands: npm run check
extra_states:
  - LIVE_EMAIL_QA after OWNER_REVIEW
extra_gates:
  - LIVE_EMAIL_QA
skip_states: none
```

- `l2_allowed: none`: staging deploys need a human yes each time, matching the handoff rule "deployed to staging only when authorized". To allow them standing, record a `DECISIONS.md` authorization (`level: L2`) or change this line in the master profile.
- `LIVE_EMAIL_QA`: real-inbox email QA (quote ready, status update, pickup, shipped, manual, resend) needs the owner to complete Cloudflare Access manually, so it's a human gate before launch review. Never weaken Access to automate it.
- `npm run check` is the known full-suite command from the 2026-10-09 handoff. Verify it still exists in the repo before relying on it.
