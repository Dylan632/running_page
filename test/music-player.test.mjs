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

const trackWindowTimeouts = (window) => {
  const activeTimeouts = new Set();
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;

  window.setTimeout = function (handler, timeout, ...args) {
    let timeoutId;
    timeoutId = originalSetTimeout.call(
      this,
      (...handlerArgs) => {
        activeTimeouts.delete(timeoutId);
        if (typeof handler === 'function') handler(...handlerArgs);
      },
      timeout,
      ...args
    );
    activeTimeouts.add(timeoutId);
    return timeoutId;
  };
  window.clearTimeout = function (timeoutId) {
    activeTimeouts.delete(timeoutId);
    return originalClearTimeout.call(this, timeoutId);
  };

  return {
    count: () => activeTimeouts.size,
    restore: () => {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    },
  };
};

test('renders the collapsed Spotify cycling playlist player contract', async () => {
  const { default: MusicPlayer } = await vite.ssrLoadModule(
    '/src/components/MusicPlayer/index.tsx'
  );
  const html = renderToStaticMarkup(React.createElement(MusicPlayer));
  const dom = new JSDOM(html);

  try {
    const iframe = dom.window.document.querySelector('iframe');
    assert.ok(iframe);
    assert.equal(
      iframe.getAttribute('src'),
      'https://open.spotify.com/embed/playlist/1r8NqobH79G9YEA3Iobx4a',
      'the embed URL must remain exact and must not add an autoplay query'
    );
    assert.ok(html.includes('aria-label="Open cycling music"'));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes('aria-controls="spotify-player-panel"'));
    assert.ok(
      html.includes('https://open.spotify.com/playlist/1r8NqobH79G9YEA3Iobx4a')
    );
    assert.ok(html.includes('title="Cycling &amp; Spinning Music 2026"'));
    assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/i);
  } finally {
    dom.window.close();
  }
});

test('places the music control after About and before the theme toggle', async () => {
  const { default: Header } = await vite.ssrLoadModule(
    '/src/components/Header/index.tsx'
  );
  const html = renderToStaticMarkup(React.createElement(Header));
  const dom = new JSDOM(html);

  try {
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
    const musicRoot = musicToggle?.parentElement;
    const themeWrapper = themeToggle?.parentElement;

    assert.ok(header);
    assert.ok(aboutLink);
    assert.ok(musicToggle);
    assert.ok(themeToggle);
    assert.ok(musicRoot);
    assert.ok(themeWrapper);
    assert.equal(musicRoot.parentElement, aboutLink.parentElement);
    assert.equal(themeWrapper.parentElement, aboutLink.parentElement);
    assert.equal(aboutLink.nextElementSibling, musicRoot);
    assert.equal(musicRoot.nextElementSibling, themeWrapper);
  } finally {
    dom.window.close();
  }
});

test('shows running and cycling as an explicit page switch', async () => {
  const expectedMode =
    process.env.VITE_ACTIVITY_MODE === 'cycling' ? 'cycling' : 'running';
  const { default: Header } = await vite.ssrLoadModule(
    '/src/components/Header/index.tsx'
  );
  const html = renderToStaticMarkup(React.createElement(Header));
  const dom = new JSDOM(html);

  try {
    const header = dom.window.document.querySelector('.running-header');
    const brand = header?.querySelector('.running-brand');
    const activitySwitch = header?.querySelector('nav[aria-label="运动类型"]');
    const links = [...(activitySwitch?.querySelectorAll('a') ?? [])];
    const runningLink = links.find(
      (link) => link.textContent?.trim() === '跑步'
    );
    const cyclingLink = links.find(
      (link) => link.textContent?.trim() === '骑行'
    );

    assert.equal(
      brand?.getAttribute('href'),
      'https://github.com/Dylan632',
      'the avatar and name should no longer switch activity pages'
    );
    assert.ok(activitySwitch);
    assert.equal(links.length, 2);
    assert.equal(
      runningLink?.getAttribute('href'),
      'https://running-page-zeta-lake.vercel.app/'
    );
    assert.equal(
      cyclingLink?.getAttribute('href'),
      'https://dylan632.github.io/cycling_page/'
    );
    assert.equal(
      runningLink?.getAttribute('aria-current'),
      expectedMode === 'running' ? 'page' : null
    );
    assert.equal(
      cyclingLink?.getAttribute('aria-current'),
      expectedMode === 'cycling' ? 'page' : null
    );
  } finally {
    dom.window.close();
  }
});

test('keeps the player mounted and manages close focus across interactions', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="root"></main><button id="outside-target" type="button">Outside</button><span id="outside-static">Outside text</span></body></html>',
    { pretendToBeVisual: true, url: 'http://localhost/' }
  );
  const restoreGlobals = installDomGlobals(dom.window);
  const listenerTracker = trackDocumentListeners(dom.window.document);
  const timeoutTracker = trackWindowTimeouts(dom.window);
  const { createRoot } = await import('react-dom/client');
  const { default: MusicPlayer } = await vite.ssrLoadModule(
    '/src/components/MusicPlayer/index.tsx'
  );
  const container = dom.window.document.querySelector('#root');
  const outsideTarget = dom.window.document.querySelector('#outside-target');
  const outsideStatic = dom.window.document.querySelector('#outside-static');
  assert.ok(container);
  assert.ok(outsideTarget);
  assert.ok(outsideStatic);

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
    closeButton.focus();
    await act(async () => {
      outsideTarget.dispatchEvent(
        new dom.window.Event('pointerdown', {
          bubbles: true,
          cancelable: true,
        })
      );
      outsideTarget.focus();
    });
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(
      dom.window.document.activeElement === outsideTarget,
      true,
      'outside pointer close should not steal focus from the outside target'
    );

    await dispatchClick(toggle);
    closeButton.focus();
    assert.equal(dom.window.document.activeElement === closeButton, true);
    await act(async () => {
      outsideStatic.dispatchEvent(
        new dom.window.Event('pointerdown', {
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(
      panel.contains(dom.window.document.activeElement),
      false,
      'outside close on static content must not leave focus in the hidden panel'
    );
    assert.equal(
      dom.window.document.activeElement === toggle,
      true,
      'outside close should recover focus when static content cannot receive it'
    );

    await dispatchClick(toggle);
    closeButton.focus();
    await act(async () => {
      outsideStatic.dispatchEvent(
        new dom.window.Event('pointerdown', {
          bubbles: true,
          cancelable: true,
        })
      );
      toggle.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.equal(
      dom.window.document.activeElement === closeButton,
      true,
      'a stale outside-close task must not steal focus after the player reopens'
    );
    await dispatchClick(closeButton);

    await dispatchClick(toggle);
    assert.equal(listenerTracker.count('keydown'), 1);
    assert.equal(listenerTracker.count('pointerdown'), 1);
    await act(async () => {
      closeButton.focus();
      outsideStatic.dispatchEvent(
        new dom.window.Event('pointerdown', {
          bubbles: true,
          cancelable: true,
        })
      );
      root.unmount();
    });
    isMounted = false;
    assert.equal(listenerTracker.count('keydown'), 0);
    assert.equal(listenerTracker.count('pointerdown'), 0);
    assert.equal(
      timeoutTracker.count(),
      0,
      'unmount should cancel a pending outside-close focus task'
    );
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
    timeoutTracker.restore();
    restoreGlobals();
    dom.window.close();
  }
});
