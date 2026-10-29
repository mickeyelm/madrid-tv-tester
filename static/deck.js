/* MADRiD TV Web: the remote, on the page. The home station is driven from a
 * phone; here the same controls live in a drawer under the picture. Channel
 * modules register a panel; the shell renders the dial and the panels.
 *
 *   MadridDeck.register(slug, {title, mount(el, api)})   api = {post, get, state, tune, webcam}
 *   MadridDeck.refresh()                                  re-render the active panel
 */
(function (root) {
  "use strict";
  var panels = {};
  var api = {
    register: function (slug, panel) { panels[slug] = panel; },
    panels: panels,
    refresh: function () { if (root.MadridShell && root.MadridShell.renderDeck) { root.MadridShell.renderDeck(); } }
  };
  root.MadridDeck = api;
}(window));
