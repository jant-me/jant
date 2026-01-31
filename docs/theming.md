# Theming

Jant uses CSS variables for theming, making it easy to customize colors while maintaining consistency.

## Built-in Themes

Select a theme in `/dash/settings`:

- **default** - Clean and neutral
- **ocean** - Cool blues
- **forest** - Natural greens
- **sunset** - Warm oranges
- **lavender** - Soft purples
- **rose** - Pink tones
- **sand** - Earthy beige
- **slate** - Professional gray
- **gameboy** - Retro green
- **terminal** - Hacker aesthetic
- **notepad** - Paper-like
- **nord** - Arctic, blue-gray
- **dracula** - Dark purple
- **solarized** - Ethan Schoonover's classic

All themes support both light and dark mode automatically.

## CSS Variables

Themes are defined through CSS variables:

```css
:root {
  --color-bg: #ffffff;
  --color-text: #1a1a1a;
  --color-text-muted: #666666;
  --color-accent: #0066cc;
  --color-border: #e5e5e5;
  --color-card-bg: #f9f9f9;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1a1a1a;
    --color-text: #ffffff;
    /* ... */
  }
}
```

## Custom Theme

Create your own theme by adding CSS to your project:

```css
/* my-theme.css */
[data-theme="my-theme"] {
  --color-bg: #fefefe;
  --color-text: #333;
  --color-accent: #ff6600;
  /* ... */
}

[data-theme="my-theme"].dark {
  --color-bg: #1a1a1a;
  --color-text: #eee;
  /* ... */
}
```

Then set `THEME=my-theme` in settings.

## Component Styling

Jant uses [BaseCoat](https://github.com/hunvreus/basecoat) for UI components. Style components using its class names:

```html
<button class="btn btn-primary">Post</button>
<input class="input" placeholder="What's on your mind?" />
<div class="card">...</div>
```

Use Tailwind utilities for layout only:

```html
<!-- Good: Tailwind for layout -->
<div class="flex gap-4 mt-2">...</div>

<!-- Avoid: Tailwind for component styling -->
<button class="bg-blue-500 px-4 py-2 rounded">...</button>
```

## Animation

Transitions use these CSS variables:

```css
--transition-fast: 150ms ease-out;
--transition-base: 200ms ease-out;
```

Apply to interactive elements:

```css
.my-element {
  transition: opacity var(--transition-base);
}
```
