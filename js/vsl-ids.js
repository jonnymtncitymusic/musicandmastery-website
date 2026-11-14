/**
 * Every VSL played by js/vsl-player.js on this site, by the key a page puts in data-vsl, in ONE
 * place. Swapping a video is one edit here, then `node scripts/vsl-assets.mjs`, which moves the ?v=
 * token on every page that loads this file (/js/ is served immutable for a year, so without the
 * new token a returning visitor keeps the old id). `npm test` fails on a stale token.
 *
 * VSL B on the 46 landing pages is NOT here: those pages still use js/hero-vsl.js with the id in
 * their own HTML (vRMcILWtQHU), left alone so this change touches none of them.
 *
 * VSL_TEMP names the keys whose id is a stand-in for local preview only. `npm test` fails while
 * any key is listed, so a branch cannot go live on a stand-in: put the real id in, take the key
 * out of VSL_TEMP, run the script.
 */
window.VSL_IDS = {
  // VSL A, the post-signup video, two cuts (start.html and watch-next.html play the lead cut,
  // watch-booked.html the booked cut, thank-you.html picks one from ?type=). Jonny's approved finals,
  // unlisted on the channel, uploaded 2026-11-13 (VSLs in signup grill Q26).
  vsl_a_lead: 'WMB7g5Z65xY',   // "You just asked about music lessons... I'll call you very soon", 3:15
  vsl_a_booked: 'JSGK0kV6TbM', // "You've already picked a time for your first free lesson", 3:11
};
window.VSL_TEMP = [];
