# PWA physical-device release checklist

Run this checklist against the HTTPS staging or production origin before a PWA-sensitive release. Record the application revision, device, OS, and browser version with the result.

## iPhone and iPad

- In Safari, confirm the in-app instructions lead to **Share → Add to Home Screen**. Repeat on an iPad using the desktop-class browser identity.
- Launch from the home-screen icon and confirm the app opens without browser chrome, uses the expected icon and colors, and respects display safe areas.
- Sign in online and open every list once. Enable airplane mode, quit the installed app, relaunch it, and confirm the dashboard and lists remain available.
- Make an offline todo edit, fully close and reopen the app, reconnect, and confirm the edit synchronizes exactly once.
- Deploy a newer revision, reopen the old installed app, accept the update prompt, and confirm it reloads into the new revision without losing queued work.

## Android

- In Chrome, confirm the install action completes and the launcher icon remains legible under circle, squircle, and rounded-square masks.
- Confirm the install dialog uses the current mobile and desktop screenshots.
- Share distinct title, text, and URL values from another app. Confirm all distinct values appear once in the quick-add dialog and none appear in the resulting browser URL.
- Repeat sharing while offline, then add the todo to a cached writable list.
- Make an offline edit, close the app, reconnect without reopening it, and confirm Background Sync eventually delivers the edit. Then reopen the app and confirm the queue is empty.
- Accept an available application update and confirm unrelated origin storage is preserved.

## Release record

- Note any unsupported platform capability separately from an application failure; Background Sync and Web Share Target support vary by browser.
- Attach screenshots or a short screen recording for failures.
- Do not approve the release with lost offline edits, duplicated synchronization, exposed share content, a broken standalone launch, or an unreadable adaptive icon.
