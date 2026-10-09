# Website Standards

## Before changing code

1. Identify the framework, package manager, build system, hosting/deployment platform, and existing project conventions.
2. Read the current repository before proposing replacement architecture.
3. Reuse existing components and patterns when they are sound.
4. Identify what is source-of-truth data versus presentation-only content.
5. Confirm whether the task is local, staging, or production.

## Implementation standards

- Prefer maintainable, reusable components.
- Avoid duplicate logic and unnecessary dependencies.
- Preserve existing working behavior unless change is required.
- Keep content editable where practical.
- Handle loading, empty, success, and failure states.
- Validate forms on both client and server where applicable.
- Do not rely on client-side checks for security.
- Do not silently swallow errors.
- Avoid fake data in production-facing flows unless clearly labeled.
- Do not fabricate integrations or claim an API is connected when it is not.

## Responsive behavior

All user-facing work should be intentionally checked at desktop, tablet, and mobile sizes.
No horizontal overflow unless the component intentionally scrolls.
No clipped controls, unreadable text, unreachable actions, or off-screen dialogs.

## Performance

- Optimize images and video appropriately.
- Avoid autoplay-heavy or CPU-heavy animation.
- Lazy-load noncritical media when useful.
- Avoid needless network requests.
- Avoid large dependencies for small visual effects.

## Accessibility

Follow `checklists/accessibility.md`.
At minimum, preserve semantic structure, labels, keyboard access, visible focus, contrast, and reduced-motion support where motion exists.

## Definition of done

A change is not done merely because code was written.
It must be verified using the project's actual lint/typecheck/test/build commands when available, plus relevant visual/functional testing.
