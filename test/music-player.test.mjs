import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let vite;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
  });
});

after(async () => {
  await vite?.close();
});

const installDomGlobals = (window) => {
  const values = {
    window,
    self: window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousDescriptors = new Map();

  for (const [key, value] of Object.entries(values)) {
    previousDescriptors.set(
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    );
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  return () => {
    for (const [key, descriptor] of previousDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
};

const trackDocumentListeners = (document) => {
  const listeners = new Map([
    ['keydown', new Set()],
    ['pointerdown', new Set()],
  ]);
  const originalAdd = document.addEventListener;
  const originalRemove = document.removeEventListener;

  document.addEventListener = function (type, listener, options) {
    listeners.get(type)?.add(listener);
    return originalAdd.call(this, type, listener, options);
  };
  document.removeEventListener = function (type, listener, options) {
    listeners.get(type)?.delete(listener);
    return originalRemove.call(this, type, listener, options);
  };

  return {
    count: (type) => listeners.get(type)?.size ?? 0,
    restore: () => {
      document.addEventListener = originalAdd;
      document.removeEventListener = originalRemove;
    },
  };
};

test('renders the collapsed Spotify cycling playlist player contract', async () => {
  const { default: MusicPlayer } = await vite.ssrLoadModule(
    '/src/components/MusicPlayer/index.tsx'
  );
  const html = renderToStaticMarkup(React.createElement(MusicPlayer));

  assert.ok(html.includes('aria-label="Open cycling music"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-controls="spotify-player-panel"'));
  assert.ok(
    html.includes(
      'https://open.spotify.com/embed/playlist/1r8NqobH79G9YEA3Iobx4a'
    )
  );
  assert.ok(
    html.includes('https://open.spotify.com/playlist/1r8NqobH79G9YEA3Iobx4a')
  );
  assert.ok(html.includes('title="Cycling &amp; Spinning Music 2026"'));
  assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/i);
});

test('places the music control after About and before the theme toggle', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  const restoreGlobals = installDomGlobals(dom.window);

  try {
    const { default: Header } = await vite.ssrLoadModule(
      '/src/components/Header/index.tsx'
    );
    const html = renderToStaticMarkup(React.createElement(Header));
    dom.window.document.body.innerHTML = html;

    const header = dom.window.document.querySelector('.running-header');
    const aboutLink = [...(header?.querySelectorAll('a') ?? [])].find(
      (link) => link.textContent?.trim() === 'About'
    );
    const musicToggle = header?.querySelector(
      'button[aria-controls="spotify-player-panel"]'
    );
    const themeToggle = [...(header?.querySelectorAll('button') ?? [])].find(
      (button) => /^Switch to (light|dark) theme$/.test(button.title)
    );

    assert.ok(header);
    assert.ok(aboutLink);
    assert.ok(musicToggle);
    assert.ok(themeToggle);
    assert.ok(
      aboutLink.compareDocumentPosition(musicToggle) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING
    );
    assert.ok(
      musicToggle.compareDocumentPosition(themeToggle) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING
    );
  } finally {
    restoreGlobals();
    dom.window.close();
  }
});

test('keeps the player mounted and manages close focus across interactions', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="root"></main><button id="outside-target" type="button">Outside</button></body></html>',
    { pretendToBeVisual: true, url: 'http://localhost/' }
  );
  const restoreGlobals = installDomGlobals(dom.window);
  const listenerTracker = trackDocumentListeners(dom.window.document);
  const { createRoot } = await import('react-dom/client');
  const { default: MusicPlayer } = await vite.ssrLoadModule(
    '/src/components/MusicPlayer/index.tsx'
  );
  const container = dom.window.document.querySelector('#root');
  const outsideTarget = dom.window.document.querySelector('#outside-target');
  assert.ok(container);
  assert.ok(outsideTarget);

  const root = createRoot(container);
  let isMounted = true;

  const dispatchClick = async (element) => {
    await act(async () => {
      element.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
  };

  try {
    await act(async () => {
      root.render(React.createElement(MusicPlayer));
    });

    const toggle = container.querySelector(
      'button[aria-controls="spotify-player-panel"]'
    );
    const panel = container.querySelector('#spotify-player-panel');
    const iframe = panel?.querySelector('iframe');
    assert.ok(toggle);
    assert.ok(panel);
    assert.ok(iframe);
    assert.equal(toggle.getAttribute('aria-label'), 'Open cycling music');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');

    await dispatchClick(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.equal(panel.querySelector('iframe') === iframe, true);
    assert.equal(listenerTracker.count('keydown'), 1);
    assert.equal(listenerTracker.count('pointerdown'), 1);

    const closeButton = panel.querySelector(
      'button[aria-label="Close cycling music"]'
    );
    assert.ok(closeButton);
    closeButton.focus();
    assert.equal(dom.window.document.activeElement === closeButton, true);
    await dispatchClick(closeButton);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(
      dom.window.document.activeElement === toggle,
      true,
      'internal close should restore focus to the music toggle'
    );
    assert.equal(panel.contains(dom.window.document.activeElement), false);
    assert.equal(panel.querySelector('iframe') === iframe, true);
    assert.equal(listenerTracker.count('keydown'), 0);
    assert.equal(listenerTracker.count('pointerdown'), 0);

    await dispatchClick(toggle);
    closeButton.focus();
    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Escape',
        })
      );
    });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(
      dom.window.document.activeElement === toggle,
      true,
      'Escape should restore focus to the music toggle'
    );
    assert.equal(panel.contains(dom.window.document.activeElement), false);

    await dispatchClick(toggle);
    outsideTarget.focus();
    await act(async () => {
      outsideTarget.dispatchEvent(
        new dom.window.Event('pointerdown', {
          bubbles: true,
          cancelable: true,
        })
      );
    });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(
      dom.window.document.activeElement === outsideTarget,
      true,
      'outside pointer close should not steal focus from the outside target'
    );

    await dispatchClick(toggle);
    assert.equal(listenerTracker.count('keydown'), 1);
    assert.equal(listenerTracker.count('pointerdown'), 1);
    await act(async () => {
      root.unmount();
    });
    isMounted = false;
    assert.equal(listenerTracker.count('keydown'), 0);
    assert.equal(listenerTracker.count('pointerdown'), 0);
    assert.doesNotThrow(() => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape' })
      );
      outsideTarget.dispatchEvent(
        new dom.window.Event('pointerdown', { bubbles: true })
      );
    });
  } finally {
    if (isMounted) {
      await act(async () => {
        root.unmount();
      });
    }
    listenerTracker.restore();
    restoreGlobals();
    dom.window.close();
  }
});
