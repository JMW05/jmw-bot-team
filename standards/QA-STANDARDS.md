# QA Standards

## Independence

Never accept "fixed" as evidence.
Reproduce the scenario and verify the current implementation.

## Minimum checks

When practical, test:
- desktop around 1440px;
- tablet around 1024px;
- tablet/small layout around 768px;
- mobile around 430px;
- mobile around 390px.

## Functional checks

- navigation;
- links and CTAs;
- forms and validation;
- modals/drawers;
- uploads;
- state changes;
- filters/search;
- login/auth if in scope;
- loading, empty, success, and error states;
- back/forward behavior when relevant;
- direct URL entry for important routes.

## Technical checks

Use the project's actual commands if available:
- lint;
- typecheck;
- unit/integration tests;
- production build.

Also inspect browser console/network when browser tooling is available.

## Visual checks

Look for:
- overflow;
- clipping;
- overlap;
- hidden controls;
- broken images;
- incorrect crops;
- low-contrast text;
- layout jumps;
- sticky/fixed elements covering content;
- content cut off below the viewport;
- motion/animation distortion.

## Findings format

For each issue:
- Severity
- Page/route
- Viewport/device
- Steps to reproduce
- Expected
- Actual
- Evidence
- Recommended correction

Never call a page fully verified if a required path could not be exercised.
