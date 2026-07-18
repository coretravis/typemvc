# Styling a TypeMVC application

TypeMVC does not own your CSS. It has no scoped-styles compiler, no cascade, no
design system, and no opinion about class names it enforces with a linter. What
it gives you is one thing the framework was missing: a home for a component's
stylesheet next to the component, so the rules that make a `Pill` a pill do not
live three thousand lines away in a file nothing keeps in sync with it.

This guide is the opinion that goes with that mechanism. It is a set of defaults,
not rules the compiler checks. Adopt them, adapt them, or replace them; the
framework takes no position either way.

## Co-location: `Name.tmvc.css`

A `.tmvc` file may have a sibling stylesheet with the same name and `.css`
appended:

```
src/components/Pill.tmvc
src/components/Pill.tmvc.css
```

If the sibling exists, the plugin imports it from the component's generated
module. If it does not, nothing happens. There is no directive to write and no
way to get it wrong: the filename is the declaration. The same convention applies
unchanged to views and layouts.

`Pill.tmvc.css`, not `Pill.css`. The double extension says the compiler owns this
relationship. It sorts next to its component, and it cannot be confused with a
hand-authored `Pill.css` that an application imports globally for its own reasons.

Because the import rides on the component's own module, the bundler does the rest:
a `<style>` tag in development, an extracted CSS asset in a build, granular hot
reload while you edit, and, since the stylesheet is code split with the
component, a lazily loaded route brings its CSS with it instead of every rule
loading on first paint.

Co-location is a Vite plugin feature. The zero-build runtime parser has no build
step and cannot import CSS, so a document it evaluates renders without its sibling
stylesheet. Build with the plugin to co-locate styles.

## What co-location gives you, and what it does not

It gives you three things:

- **Adjacency.** The component and its rules are one unit you read, move, and
  review together.
- **Code splitting.** A route's styles load with the route, not on first paint.
- **Deletion safety.** Delete the component and its stylesheet goes with it. No
  orphaned rules survive in a global file.

It does not give you **encapsulation**. Two components can both define `.pill`,
and the second one wins wherever both apply. Nothing scopes a selector to a
component. The naming convention below is what prevents the collision, and it is
discipline, not a guarantee the compiler makes.

That is the honest limitation, and it is deliberate. Scoped styles mean the
framework parses your CSS, rewrites your selectors, and takes a position on your
cascade, which is the part of a design system a team most wants to own. TypeMVC
says no to that loudly rather than yes to it slowly.

## Tokens own appearance

Colour, radius, shadow, spacing and type live in custom properties. A component's
stylesheet consumes tokens; it does not hard code values.

```css
/* src/styles/tokens.css */
:root {
  --color-accent: #2f6fed;
  --radius-pill: 999px;
  --space-2: 8px;
}
```

```css
/* src/components/Pill.tmvc.css */
.pill {
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  color: var(--color-accent);
}
```

Reskinning the application is then editing one file, not hunting hex codes
through every component.

## The model owns amount

A height, a fill, a position, a coordinate: these are data, not appearance. They
belong to the model, and they reach CSS as a value, never as a class per value
and never as twenty rules for twenty numbers.

Two forms deliver a value to CSS, and one is preferred.

Setting a custom property through the `style` attribute has always worked:

```html
<div class="bar" style="--fill: ${context.model.percent}%"></div>
```

The preferred form is the `style:` prefixed binding:

```html
<div class="bar" style:--fill="${context.model.percent}"></div>
```

```css
.bar {
  height: calc(var(--fill, 0) * 1%);
}
```

The prefixed binding is applied through `element.style.setProperty`, so it writes
no inline `style` attribute. A page whose Content Security Policy forbids inline
styles still draws the chart. It also updates one property in place instead of
rewriting the whole attribute, and it leaves any other `style:` binding on the
element alone. Reach for it before you reach for a class named `.fill-40`.

## Naming prevents collision

A component's rules are namespaced by the component. A BEM-ish shape works well:

```css
.spark__bar { fill: var(--color-track); }
.spark__bar.is-selected { fill: var(--color-accent); }
```

The point is not the syntax. It is that `.spark__bar` cannot collide by accident
with a bar in another component, because these rules are global and the name is
the only thing keeping them apart. Pick a convention and hold to it.

## The application owns the cascade

A recommended order is reset, then tokens, then base element styles, then
components, then utilities. Import them in that order so later layers win where
they overlap:

```ts
// src/main.ts
import './styles/reset.css';
import './styles/tokens.css';
import './styles/base.css';
// component stylesheets load with their components
```

This order is a suggestion. The application owns it. The framework injects
nothing into your cascade, with one exception noted for exactly this reason: the
router adds a single visually-hidden rule for the route announcer that reads a
page's title to assistive technology on navigation. Nothing else.
