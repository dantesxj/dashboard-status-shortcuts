// ==Plugin==
// name: Dashboard Status Shortcuts
// description: Unified status bar control + popover to open each collection's custom Dashboard (auto-discovered).
// icon: ti-layout-dashboard
// ==/Plugin==

/**
 * Global plugin: discovers collections with a custom view labeled "Dashboard".
 * Default: one status bar anchor (inline SVG) opening an upward frosted popover with a tail
 * toward the anchor; icon rows mirror Today's Notes collection icon resolution.
 * Set `custom.unifiedDashboardMenu` to false in plugin.json to restore one icon per collection.
 */

class Plugin extends AppPlugin {
  async onLoad() {
    if (typeof super.onLoad === 'function') super.onLoad();
    this._anchorItem = null;
    this._sidebarItem = null;
    this._statusItems = [];
    this._targets = [];
    this._eventIds = [];
    this._refreshTimer = null;
    this._refreshSeq = 0;
    this._popoverEl = null;
    this._popoverSource = null;
    this._boundDocMouse = null;
    this._boundDocClick = null;
    this._boundDocKey = null;
    this._boundWinResize = null;
    this._boundWinScroll = null;
    this._lockObserver = null;
    this._cssInjected = false;

    if (typeof this.ui?.addStatusBarItem !== 'function') {
      console.warn('[Dashboard Status] addStatusBarItem not available');
      return;
    }

    this._injectCss();
    await this._refreshAll();
    this._subscribeEvents();
    setTimeout(() => this._moveAnchorOrItemsToEnd(), 600);
  }

  onUnload() {
    for (const id of this._eventIds || []) {
      try { this.events.off(id); } catch (_) {}
    }
    this._eventIds = [];
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._closePopover();
    this._removeDocListeners();
    this._clearAllStatusItems();
    this._refreshSeq++;
  }

  _useUnifiedMenu() {
    try {
      const c = this.getConfiguration?.()?.custom;
      if (c && c.unifiedDashboardMenu === false) return false;
    } catch (_) {}
    return true;
  }

  _workspaceGuid() {
    try {
      return this.data.getActiveUsers?.()?.[0]?.workspaceGuid ?? null;
    } catch (_) {
      return null;
    }
  }

  _injectCss() {
    if (this._cssInjected) return;
    this._cssInjected = true;
    try {
      this.ui.injectCSS(`
        .dss-anchor { display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;line-height:0;vertical-align:middle;cursor:pointer; }
        .dss-anchor svg { display:block; }
        .dss-shell {
          position: fixed;
          z-index: 200000;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          max-width: min(360px, calc(100vw - 16px));
          pointer-events: auto;
        }
        .dss-shell--bottom {
          flex-direction: column;
          align-items: flex-start;
        }
        .dss-shell--side {
          flex-direction: row;
          align-items: center;
        }
        .dss-card {
          max-height: min(280px, 46vh);
          overflow-y: auto;
          padding: 6px 10px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
          background: color-mix(in srgb, Canvas 42%, transparent);
          color: CanvasText;
          -webkit-backdrop-filter: blur(18px) saturate(1.25);
          backdrop-filter: blur(18px) saturate(1.25);
          box-shadow:
            0 0 0 1px color-mix(in srgb, CanvasText 8%, transparent),
            0 -6px 28px color-mix(in srgb, CanvasText 18%, transparent),
            0 0 22px color-mix(in srgb, Highlight 24%, transparent);
        }
        /* One frosted shell only — icon row matches Journal Footer Suite .jfs-tab / .tn-header-tri (flat, no per-icon chip). */
        .dss-rows {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          gap: 6px;
        }
        .dss-rows--side {
          flex-direction: column;
          flex-wrap: nowrap;
          justify-content: flex-start;
          align-items: center;
          gap: 4px;
        }
        .dss-row {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          margin: 0;
          padding: 0;
          border: none;
          border-radius: 0;
          background: transparent;
          color: var(--text-secondary, color-mix(in srgb, CanvasText 88%, Canvas));
          font: inherit;
          cursor: pointer;
          line-height: 0;
          flex-shrink: 0;
          opacity: 0.86;
          transition: opacity 0.12s ease, color 0.12s ease;
        }
        .dss-row:hover {
          opacity: 1;
          color: CanvasText;
        }
        .dss-row:focus {
          outline: none;
        }
        .dss-row:focus-visible {
          opacity: 1;
          color: CanvasText;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, Highlight 50%, transparent);
          border-radius: 4px;
        }
        .dss-row-ico {
          display: flex;
          align-items: center;
          justify-content: center;
          width: auto;
          height: auto;
          line-height: 0;
        }
        .dss-row-ico .ti { font-size: 15px; line-height: 1; opacity: 1; }
        .dss-row-ico svg { width: 15px; height: 15px; display: block; }
        .dss-collection-icon-emoji { font-size: 15px; line-height: 1; }
        .dss-caret {
          display: block;
          margin-top: -1px;
          flex-shrink: 0;
          filter: drop-shadow(0 2px 6px color-mix(in srgb, CanvasText 22%, transparent));
        }
        .dss-caret-path {
          fill: color-mix(in srgb, Canvas 76%, transparent);
          stroke: color-mix(in srgb, CanvasText 28%, transparent);
          stroke-width: 0.6;
        }
      `);
    } catch (_) {}
  }

  _subscribeEvents() {
    const schedule = () => this._scheduleRefresh();
    try {
      this._eventIds.push(this.events.on('collection.created', schedule));
      this._eventIds.push(this.events.on('collection.updated', schedule));
    } catch (_) {}
    try {
      this._eventIds.push(this.events.on('reload', schedule));
    } catch (_) {}
  }

  _scheduleRefresh() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._refreshAll().catch(() => {});
    }, 400);
  }

  _clearAllStatusItems() {
    for (const it of this._statusItems || []) {
      try { it?.remove?.(); } catch (_) {}
    }
    this._statusItems = [];
    try {
      this._anchorItem?.remove?.();
    } catch (_) {}
    this._anchorItem = null;
    try {
      this._sidebarItem?.remove?.();
    } catch (_) {}
    this._sidebarItem = null;
  }

  _moveItemToEnd(item) {
    try {
      const el = item?.getElement?.();
      const p = el?.parentNode;
      if (el && p && p.lastElementChild !== el) p.appendChild(el);
    } catch (_) {}
  }

  _moveAnchorOrItemsToEnd() {
    if (this._anchorItem) this._moveItemToEnd(this._anchorItem);
    for (const it of this._statusItems || []) this._moveItemToEnd(it);
  }

  _normalizeStatusIcon(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'ti-dashboard';
    if (s.startsWith('ti-')) return s;
    if (s === 'notes') return 'ti-notes';
    return 'ti-dashboard';
  }

  /** Same candidate order as Today's Notes footer (`_collectionIconName`). */
  _collectionIconName(coll) {
    if (!coll) return '';
    const candidates = [];
    const push = (v) => {
      if (v == null || typeof v === 'object') return;
      const t = String(v).trim();
      if (t) candidates.push(t);
    };
    try {
      const cfg = coll.getConfiguration?.() || {};
      push(cfg.icon);
      push(cfg.collection_icon);
      push(cfg.iconName);
      push(cfg.emoji);
    } catch (_) {}
    try {
      const data = coll?.getData?.() || {};
      push(data.icon);
      push(data.emoji);
    } catch (_) {}
    push(coll?.icon);
    try {
      push(coll.getIcon?.());
    } catch (_) {}
    for (const raw of candidates) {
      if (/^ti-photo$/i.test(raw)) continue;
      if (raw.startsWith('ti-')) return raw;
      if (/^[a-z0-9_-]+$/i.test(raw)) return `ti-${raw.replace(/^ti-?/, '').replace(/_/g, '-')}`;
      if (/[^\x00-\x7F]/.test(raw)) return raw;
    }
    return '';
  }

  _createIconNode(iconNames) {
    const list = Array.isArray(iconNames) ? iconNames : [iconNames];
    for (const name of list) {
      const key = String(name || '').trim();
      if (!key) continue;
      try {
        const node = this.ui.createIcon?.(key);
        if (node) return node;
      } catch (_) {}
    }
    return null;
  }

  /** Mirrors Today's Notes `_appendCollectionIconVisual` for reliable Tabler / emoji / webfont fallback. */
  _appendCollectionIconVisual(parent, rawIcon) {
    if (!parent) return false;
    const s = String(rawIcon || '').trim();
    if (!s) return false;
    if (/[^\x00-\x7F]/.test(s) && !/^ti[-\s]/i.test(s)) {
      const span = document.createElement('span');
      span.className = 'dss-collection-icon-emoji';
      span.textContent = s;
      span.setAttribute('aria-hidden', 'true');
      parent.appendChild(span);
      return true;
    }
    const candidates = [];
    if (s.startsWith('ti-')) {
      candidates.push(s, s.slice(3));
    } else {
      candidates.push(`ti-${s.replace(/^ti-?/i, '')}`, s);
    }
    for (const c of candidates) {
      const node = this._createIconNode([c]);
      if (node) {
        parent.appendChild(node);
        return true;
      }
    }
    const slug = (s.startsWith('ti-') ? s.slice(3) : s.replace(/^ti-?/i, '')).replace(/_/g, '-').replace(/\s+/g, '-');
    if (/^[a-z0-9-]+$/i.test(slug)) {
      const i = document.createElement('i');
      i.className = `ti ti-${slug.toLowerCase()}`;
      i.setAttribute('aria-hidden', 'true');
      parent.appendChild(i);
      return true;
    }
    return false;
  }

  _appendRowIcon(parent, collection, viewIconFallback) {
    if (!parent) return;
    const raw =
      this._collectionIconName(collection) ||
      String(viewIconFallback || '').trim() ||
      '';
    if (this._appendCollectionIconVisual(parent, raw)) return;
    try {
      const node = this.ui.createIcon?.('ti-layout-dashboard');
      if (node) {
        parent.appendChild(node);
        return;
      }
    } catch (_) {}
    const i = document.createElement('i');
    i.className = 'ti ti-layout-dashboard';
    i.setAttribute('aria-hidden', 'true');
    parent.appendChild(i);
  }

  _findDashboardView(collection) {
    let cfg = null;
    try {
      cfg = collection.getConfiguration?.();
    } catch (_) {
      return null;
    }
    const views = cfg?.views;
    if (!Array.isArray(views)) return null;
    const view = views.find(
      (v) =>
        v &&
        v.type === 'custom' &&
        String(v.label || '').trim() === 'Dashboard' &&
        v.shown !== false &&
        v.id
    );
    if (!view) return null;
    return { view, collection };
  }

  _anchorHtml() {
    const inner =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect width="7" height="9" x="3" y="3" rx="1"/>' +
      '<rect width="7" height="5" x="14" y="3" rx="1"/>' +
      '<rect width="7" height="9" x="14" y="12" rx="1"/>' +
      '<rect width="7" height="5" x="3" y="16" rx="1"/>' +
      '</svg>';
    return (
      '<span class="dss-anchor" aria-hidden="true">' +
      inner +
      '</span>'
    );
  }

  _anchorTooltip() {
    const n = this._targets?.length || 0;
    if (n === 0) return 'Dashboards — none found';
    return n === 1 ? 'Dashboards — open menu' : `Dashboards — ${n} collections (open menu)`;
  }

  /** Sidebar API item has no getElement(); resolve host node by label/icon patterns with fallbacks. */
  _resolveSidebarAnchorElement() {
    const trySelectors = [
      '[title*="Dashboards"]',
      '[aria-label*="Dashboards"]',
      '.sidebar [class*="item"]',
      '.sidebar button',
      '.sidebar a',
      '[class*="sidebar"] button',
      '[class*="sidebar"] a',
    ];
    for (const sel of trySelectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch (_) {}
      for (const n of nodes) {
        if (!n || typeof n.getBoundingClientRect !== 'function') continue;
        const text = String(n.textContent || '').trim();
        const title = String(n.getAttribute?.('title') || '').trim();
        const aria = String(n.getAttribute?.('aria-label') || '').trim();
        const hasDashboardWord = /dashboards/i.test(text) || /dashboards/i.test(title) || /dashboards/i.test(aria);
        const hasIconHint = !!(n.querySelector?.('.ti-layout-dashboard') || n.querySelector?.('.ti-grid-dots'));
        if (hasDashboardWord || hasIconHint) return n;
      }
    }
    // Last resort: any visible sidebar container; popover still opens near sidebar edge.
    try {
      return document.querySelector('.sidebar') || document.querySelector('[class*="sidebar"]');
    } catch (_) {
      return null;
    }
  }

  _stopLockObserver() {
    if (this._lockObserver) {
      try { this._lockObserver.disconnect(); } catch (_) {}
      this._lockObserver = null;
    }
  }

  _startLockObserver() {
    this._stopLockObserver();
    try {
      if (document.querySelector('.tal-overlay')) {
        this._closePopover();
        return;
      }
    } catch (_) {}
    try {
      this._lockObserver = new MutationObserver(() => {
        try {
          if (!this._popoverEl) return;
          if (document.querySelector('.tal-overlay')) this._closePopover();
        } catch (_) {}
      });
      this._lockObserver.observe(document.body, { childList: true });
    } catch (_) {}
  }

  _removeDocListeners() {
    this._stopLockObserver();
    if (this._boundDocMouse) {
      try { document.removeEventListener('mousedown', this._boundDocMouse, true); } catch (_) {}
      this._boundDocMouse = null;
    }
    if (this._boundDocClick) {
      try { document.removeEventListener('click', this._boundDocClick, true); } catch (_) {}
      this._boundDocClick = null;
    }
    if (this._boundDocKey) {
      try { document.removeEventListener('keydown', this._boundDocKey, true); } catch (_) {}
      this._boundDocKey = null;
    }
    if (this._boundWinResize) {
      try { window.removeEventListener('resize', this._boundWinResize); } catch (_) {}
      this._boundWinResize = null;
    }
    if (this._boundWinScroll) {
      try { window.removeEventListener('scroll', this._boundWinScroll, true); } catch (_) {}
      this._boundWinScroll = null;
    }
  }

  _closePopover() {
    this._removeDocListeners();
    try {
      this._popoverEl?.remove();
    } catch (_) {}
    this._popoverEl = null;
    this._popoverSource = null;
  }

  _togglePopover(ws, source = 'status', anchorEl = null) {
    if (this._popoverEl && this._popoverSource === source) {
      this._closePopover();
      return;
    }
    this._openPopover(ws, source, anchorEl);
  }

  _openPopover(ws, source = 'status', anchorElOverride = null) {
    this._closePopover();
    const anchorEl =
      anchorElOverride ||
      (source === 'sidebar'
        ? this._resolveSidebarAnchorElement()
        : this._anchorItem?.getElement?.());
    if (!anchorEl) return;
    try {
      if (document.querySelector('.tal-overlay')) return;
    } catch (_) {}

    const shell = document.createElement('div');
    shell.className = source === 'sidebar' ? 'dss-shell dss-shell--side' : 'dss-shell dss-shell--bottom';
    shell.setAttribute('role', 'menu');
    shell.setAttribute('aria-label', 'Dashboard shortcuts');

    const card = document.createElement('div');
    card.className = 'dss-card';

    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'dss-rows';
    if (source === 'sidebar') rowsWrap.classList.add('dss-rows--side');

    const list = this._targets || [];
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText =
        'padding:10px 12px;opacity:0.72;font-size:12px;text-align:center;cursor:default;width:100%;';
      empty.textContent = 'No custom Dashboard views found.';
      rowsWrap.appendChild(empty);
    } else {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dss-row';
        btn.setAttribute('role', 'menuitem');
        btn.title = t.collName;
        btn.setAttribute('aria-label', `Open ${t.collName} dashboard`);
        const ico = document.createElement('span');
        ico.className = 'dss-row-ico';
        this._appendRowIcon(ico, t.collection, t.viewIconFallback);
        btn.appendChild(ico);
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this._closePopover();
          this._openDashboard(ws, t.collectionGuid, t.viewId);
        });
        rowsWrap.appendChild(btn);
      }
    }

    card.appendChild(rowsWrap);
    shell.appendChild(card);

    const NS = 'http://www.w3.org/2000/svg';
    const caret = document.createElementNS(NS, 'svg');
    caret.classList.add('dss-caret');
    if (source === 'sidebar') {
      caret.setAttribute('width', '9');
      caret.setAttribute('height', '20');
      caret.setAttribute('viewBox', '0 0 9 20');
    } else {
      caret.setAttribute('width', '20');
      caret.setAttribute('height', '9');
      caret.setAttribute('viewBox', '0 0 20 9');
    }
    caret.setAttribute('aria-hidden', 'true');
    const caretPath = document.createElementNS(NS, 'path');
    caretPath.classList.add('dss-caret-path');
    caretPath.setAttribute(
      'd',
      source === 'sidebar' ? 'M9 0 L1 10 L9 20 Z' : 'M0 1 L10 9 L20 1 Z'
    );
    caret.appendChild(caretPath);
    if (source === 'sidebar') shell.insertBefore(caret, card);
    else shell.appendChild(caret);

    document.body.appendChild(shell);
    this._popoverEl = shell;
    this._popoverSource = source;

    const position = () => {
      if (!this._popoverEl || !anchorEl.isConnected) return;
      const r = anchorEl.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      shell.style.visibility = 'hidden';
      shell.style.left = '0';
      shell.style.top = '0';
      shell.style.bottom = 'auto';
      const sw = shell.offsetWidth;
      const sh = shell.offsetHeight;
      shell.style.visibility = '';
      if (source === 'sidebar') {
        let left = r.right + gap;
        left = Math.max(margin, Math.min(left, vw - sw - margin));
        let top = r.top + (r.height / 2) - (sh / 2);
        top = Math.max(margin, Math.min(top, vh - sh - margin));
        shell.style.left = `${Math.round(left)}px`;
        shell.style.top = `${Math.round(top)}px`;
        shell.style.bottom = 'auto';
        card.style.maxHeight = `${Math.min(300, Math.max(80, vh - margin * 2 - 10))}px`;
      } else {
        let left = r.left + r.width / 2 - sw / 2;
        left = Math.max(margin, Math.min(left, vw - sw - margin));
        const bottomFromViewportBottom = vh - r.top + gap;
        shell.style.left = `${Math.round(left)}px`;
        shell.style.bottom = `${Math.round(bottomFromViewportBottom)}px`;
        shell.style.top = 'auto';
        card.style.maxHeight = `${Math.min(280, Math.max(80, r.top - margin - gap - 14))}px`;
        const anchorCenter = r.left + (r.width / 2);
        const caretW = 20;
        const rightBias = 20;
        const caretLeftRaw = anchorCenter - left - (caretW / 2) + rightBias;
        const caretLeft = Math.max(8, Math.min(caretLeftRaw, sw - caretW - 8));
        caret.style.marginLeft = `${Math.round(caretLeft)}px`;
      }
    };

    position();

    this._boundDocMouse = (ev) => {
      const t = ev.target;
      if (!this._popoverEl) return;
      if (this._popoverEl.contains(t)) return;
      if (anchorEl.contains(t)) return;
      this._closePopover();
    };
    this._boundDocClick = (ev) => {
      const t = ev.target;
      if (!this._popoverEl) return;
      if (this._popoverEl.contains(t)) return;
      if (anchorEl.contains(t)) return;
      this._closePopover();
    };
    this._boundDocKey = (ev) => {
      if (ev.key === 'Escape') this._closePopover();
    };
    this._boundWinResize = () => {
      if (!this._popoverEl) return;
      position();
    };
    this._boundWinScroll = () => {
      if (!this._popoverEl) return;
      position();
    };

    setTimeout(() => {
      try {
        document.addEventListener('mousedown', this._boundDocMouse, true);
        document.addEventListener('click', this._boundDocClick, true);
        document.addEventListener('keydown', this._boundDocKey, true);
        window.addEventListener('resize', this._boundWinResize);
        window.addEventListener('scroll', this._boundWinScroll, true);
      } catch (_) {}
    }, 0);

    this._startLockObserver();

    try {
      const first = shell.querySelector('button.dss-row');
      first?.focus?.();
    } catch (_) {}
  }

  async _refreshAll() {
    const seq = ++this._refreshSeq;
    let collections = [];
    try {
      collections = (await this.data.getAllCollections()) || [];
    } catch (e) {
      console.warn('[Dashboard Status] getAllCollections failed', e);
      return;
    }
    if (seq !== this._refreshSeq) return;

    this._closePopover();
    this._clearAllStatusItems();

    const hits = [];
    for (const c of collections) {
      try {
        if (c?.isJournalPlugin?.()) continue;
      } catch (_) {}
      const hit = this._findDashboardView(c);
      if (hit) hits.push(hit);
    }

    hits.sort((a, b) =>
      String(a.collection.getName?.() || '').localeCompare(String(b.collection.getName?.() || ''), undefined, {
        sensitivity: 'base',
      })
    );

    const ws = this._workspaceGuid();

    this._targets = hits.map(({ view, collection }) => {
      const cfg = collection.getConfiguration?.() || {};
      const iconHint = this._normalizeStatusIcon(
        view.icon || cfg.icon || 'ti-dashboard'
      );
      return {
        collection,
        collectionGuid: collection.getGuid?.(),
        viewId: view.id,
        collName: collection.getName?.() || 'Collection',
        viewIconFallback: view.icon || cfg.icon || '',
        iconHint,
      };
    });

    if (this._useUnifiedMenu()) {
      try {
        this._anchorItem = this.ui.addStatusBarItem({
          htmlLabel: this._anchorHtml(),
          tooltip: this._anchorTooltip(),
          onClick: () => this._togglePopover(ws, 'status', this._anchorItem?.getElement?.()),
        });
      } catch (e) {
        console.warn('[Dashboard Status] unified anchor failed', e);
        return;
      }
      this._moveItemToEnd(this._anchorItem);
      try {
        if (typeof this.ui.addSidebarItem === 'function') {
          this._sidebarItem = this.ui.addSidebarItem({
            icon: 'ti-layout-dashboard',
            label: 'Dashboards',
            tooltip: 'Dashboards — open menu',
            onClick: () => this._togglePopover(ws, 'sidebar', this._resolveSidebarAnchorElement()),
          });
        }
      } catch (e) {
        console.warn('[Dashboard Status] sidebar anchor failed', e);
      }
      return;
    }

    for (const t of this._targets) {
      const icon = t.iconHint || 'ti-dashboard';
      const tip = `Open Dashboard — ${t.collName}`;
      let item = null;
      try {
        item = this.ui.addStatusBarItem({
          icon,
          tooltip: tip,
          onClick: () => this._openDashboard(ws, t.collectionGuid, t.viewId),
        });
      } catch (e) {
        console.warn('[Dashboard Status] addStatusBarItem failed', t.collName, e);
        continue;
      }
      if (item) {
        this._statusItems.push(item);
        this._moveItemToEnd(item);
      }
    }
  }

  _openDashboard(workspaceGuid, collectionGuid, viewId) {
    if (!collectionGuid) return;
    const ws = workspaceGuid || this._workspaceGuid();
    let panel = null;
    try {
      panel = this.ui.getActivePanel?.();
    } catch (_) {}

    const nav = {
      type: 'overview',
      rootId: collectionGuid,
      subId: viewId || null,
      workspaceGuid: ws,
    };

    try {
      if (panel) {
        panel.navigateTo(nav);
        try { this.ui.setActivePanel?.(panel); } catch (_) {}
        return;
      }
    } catch (e) {
      console.warn('[Dashboard Status] navigateTo (active panel) failed', e);
    }

    try {
      this.ui.createPanel?.({}).then((p) => {
        if (!p) return;
        try {
          p.navigateTo(nav);
          this.ui.setActivePanel?.(p);
        } catch (e2) {
          console.warn('[Dashboard Status] navigateTo (new panel) failed', e2);
        }
      });
    } catch (e) {
      console.warn('[Dashboard Status] createPanel failed', e);
    }
  }
}
