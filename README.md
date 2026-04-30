# Dashboard Status Shortcuts (Thymer)

Global (App) plugin for **Thymer**: quick access to every collection that defines a **custom** view labeled **Dashboard**.

## Features

- **Status bar**: one compact dashboard icon (inline SVG) opens a frosted popover of collection icons.
- **Sidebar**: optional second launcher with the same menu (vertical stack + tail toward the sidebar).
- **Discovery**: scans workspace collections (skips journal plugins) for `views[]` where `type === "custom"` and `label === "Dashboard"`.
- **Navigation**: `panel.navigateTo` with `type: "overview"`, `rootId` = collection GUID, `subId` = dashboard view id.
- **Config**: in `plugin.json`, set `"custom": { "unifiedDashboardMenu": false }` for legacy one-status-icon-per-collection mode.

## Install

1. Thymer → Command Palette → **Plugins** → create or edit a **global** plugin.
2. Paste `plugin.js` into **Custom Code** and `plugin.json` into **Configuration**.
3. Save.

Official SDK: [thymerapp/thymer-plugin-sdk](https://github.com/thymerapp/thymer-plugin-sdk)
