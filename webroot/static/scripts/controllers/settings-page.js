/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Settings Page Controller.
 * @extends BzDeck.BaseController
 */
BzDeck.SettingsPageController = class SettingsPageController extends BzDeck.BaseController {
  /**
   * Called by the app router and initialize the Settings Page Controller. If the Settings has an existing tab, switch
   * to it. Otherwise, open a new tab and load the content.
   * @constructor
   * @argument {undefined}
   * @return {Object} controller - New SettingsPageController instance.
   */
  constructor () {
    super(); // This does nothing but is required before using `this`

    let tab_id = history.state ? history.state.tab_id : undefined,
        account = BzDeck.account,
        prefs = new Map();

    Promise.all([...Object.entries(BzDeck.config.prefs)].map(entry => {
      let [name, value] = entry;

      return BzDeck.prefs.get(name).then(_value => {
        value.user = _value;
        prefs.set(name, value);
      });
    })).then(() => {
      BzDeck.views.banner.open_tab({
        page_category: 'settings',
        page_constructor: BzDeck.SettingsPageView,
        page_constructor_args: [prefs, tab_id],
        tab_label: 'Settings',
      }, this);
    });

    this.subscribe('V:PrefValueChanged');
  }

  /**
   * Called by SettingsPageView whenever a preference value is changed by the user. Save it to the database and update
   * the UI where necessary.
   * @argument {Object} data - Passed data.
   * @argument {String} data.name - Preference name.
   * @argument {*}      data.value - New value.
   * @return {undefined}
   */
  on_pref_value_changed (data) {
    let { name, value } = data;

    BzDeck.prefs.set(name, value);

    if (name === 'ui.theme.selected') {
      this.helpers.theme.selected = value;
    }

    if (name === 'ui.date.timezone') {
      this.helpers.datetime.options.timezone = value;
    }

    if (name === 'ui.date.relative') {
      this.helpers.datetime.options.relative = value
    }

    if (name === 'notifications.show_desktop_notifications' && value === true) {
      navigator.permissions.query({ name: 'notifications' }).then(result => {
        if (result.state !== 'granted') {
          Notification.requestPermission(); // Permissions.prototype.request() is not implemented yet
        }
      });
    }
  }
}

BzDeck.SettingsPageController.prototype.route = '/settings';
