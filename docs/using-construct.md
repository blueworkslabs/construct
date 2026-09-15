# Using Construct

This guide describes the UX-refresh branch. Released older builds use the earlier
workshop screen; see the release handoff for the corresponding installer.

## Your Library

Construct starts with the tools installed on your phone. Opening Library does not
fetch a catalog. Tap **Open** to use a tool; it can work offline once installed,
subject to the capabilities it needs. The card's **More actions** menu contains
module access, update/recovery choices, disabling and removal.

A new installation is a **Trial**. Open it, try its main function, then choose
**Construct menu → Mark working** from the running tool. Library cannot mark an
untested session working. If an update fails, its card keeps the error visible
and offers the recovery actions available for that installation.

## Find and update tools

Choose **Construct menu → Settings** to enter a catalog URL. **Use catalog** is
explicit: editing the field alone does not connect or replace the active source.
For a bundled first experiment, choose **Use demo catalog**, then **Use catalog**.
An operator-configured build may also offer **Use configured registry**.

In **Browse**, **Refresh catalog** checks the selected source. One normal release
per tool is prominent. **Versions** exposes the exact version choices, including
clearly labelled test fixtures; older code is not presented as a normal update.
Every install still verifies the publisher signature and asks you to review
access. A failed catalog request does not remove installed tools.

## Inside a tool

The small native **Construct menu** is reserved for Close module, Module access,
Diagnostics and trial Mark working. The tool keeps its own task controls in the
main workspace. Opening the menu can pause activity; returning does not
necessarily resume a game automatically. Back opens the module menu rather than
silently discarding the session.

Tool-specific **Help** contains longer guidance. Android's larger text and display
rotation are supported by adaptive layouts; native camera rotation deliberately
closes the camera, while the measurement workspace retains current work through
rotation. Leaving measurement still clears unsaved work.

## Access, saved data and recovery

Module access is separate from Android permission. Contacts and camera need both;
allowing Android permission does not grant every tool access. New sensitive access
starts off. Required-access revocation asks for confirmation and stops the module.

**Roll back** restores previous working code, not old saved data. **Remove** keeps
module data for a later reinstall; uninstalling Construct removes its private data.
Damaged modules and unreadable indexes expose their own repair controls without
hiding healthy tools. Read those confirmations before proceeding.

Camera photos start in a private album. **Save to phone gallery** is an explicit
native copy action, not an additional module permission. Gallery copies survive
private-photo deletion and may be backed up by your photo app. Module JavaScript
never receives the photo bytes.

**Construct menu → Diagnostics** provides a technical report. Review it before
sharing: module-written messages may include module data. A diagnostic report is
not a backup of your saved tools or photos.
