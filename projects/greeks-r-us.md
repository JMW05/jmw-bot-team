# Greeks R Us

## Type
Premium campaign/e-commerce style website with high-impact art direction and motion.

## Current design authority
The hero centers on the Diva Box reveal artwork. The real painted campaign title/art should remain the authority rather than being replaced by generic web typography.

## Hero choreography
Opening sequence includes cream screen, smaller logo, box settle, women around it, lid lift, crimson light, title/tissue rising from the box, paint flecks, then Join Our World. Motion should play once and have a strong reduced-motion state.

## Critical quality rule
Do not confuse technical animation success with premium art direction. Preserve artwork proportions; avoid warping, cutouts, cheap compositing, or motion that makes the source art look AI-generated.

## Critical QA
- desktop and mobile hero composition
- opening timing
- final static state
- reduced motion
- scroll/swipe/key interruption behavior if implemented
- no image warping/cropping artifacts
- performance/load behavior
- console errors

## Deployment guardrail
Review staging/branch separately from production. Do not deploy merely because lint/build/tests pass.