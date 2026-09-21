(() => {
  const covers = [
    {
      match: /\/projects\/(?:humogram\.jpg|humogram-cover(?:-v2)?\.png)$/i,
      src: '/projects/humogram-cover-v2.png',
    },
    {
      match: /\/projects\/(?:game-vigilance\.png|games-cover(?:-v2)?\.png)$/i,
      src: '/projects/games-cover-v2.png',
    },
    {
      match: /\/projects\/university-schedules-cover(?:-v2)?\.png$/i,
      src: '/projects/university-schedules-cover-v2.png',
    },
  ];

  function applyCover(image) {
    const source = image.getAttribute('src');
    if (!source) return;

    let pathname;
    try {
      pathname = new URL(source, window.location.href).pathname;
    } catch {
      return;
    }

    const cover = covers.find((item) => item.match.test(pathname));
    if (!cover) return;

    if (source !== cover.src) {
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.setAttribute('src', cover.src);
    }
    image.style.objectPosition = '50% 50%';
  }

  function applyCovers(root = document) {
    if (root instanceof HTMLImageElement) applyCover(root);
    root.querySelectorAll?.('img').forEach(applyCover);
  }

  function start() {
    applyCovers();
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          applyCover(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) applyCovers(node);
        });
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
