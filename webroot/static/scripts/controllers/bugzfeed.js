/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Bugzfeed Controller. This works with the BugzfeedWorker background service.
 * @extends BzDeck.BaseController
 */
BzDeck.BugzfeedController = class BugzfeedController extends BzDeck.BaseController {
  /**
   * Get a BugzfeedController instance.
   * @constructor
   * @argument {undefined}
   * @return {Object} controller - New BugzfeedController instance.
   */
  constructor () {
    super(); // This does nothing but is required before using `this`

    this.worker = new Worker('/static/scripts/workers/bugzfeed.js');
    this.connected = false;
    this.subscriptions = new Set();

    // Add event handlers. Disconnect from the WebSocket server when the page is closed, otherwise the client continues
    // working background. Connect when the page is opened again or the network status has changed.
    window.addEventListener('online', event => this.connect());
    window.addEventListener('pageshow', event => this.connect());
    window.addEventListener('pagehide', event => this.disconnect());

    // Listen messages from the worker.
    this.worker.addEventListener('message', event => this.onmessage(event.data));
  }

  /**
   * Called whenever a message is received from the worker.
   * @argument {Object} data - Posted message.
   * @return {undefined}
   */
  onmessage (data) {
    let { status, id, ids } = data;

    let func = {
      'Connected': () => this.connected = true,
      'Disonnected': () => this.connected = false,
      'BugUpdated': () => this.trigger(':BugUpdated', { id }),
      'SubscriptionsUpdated': () => this.subscriptions = new Set(ids),
    }[status];

    if (BzDeck.config.debug) {
      console.info('BugzfeedController.onmessage', data)
    }

    if (func) {
      func();
    }
  }

  /**
   * Post a message to BugzfeedWorker.
   * @argument {Object} data
   * @return {undefined}
   */
  notify (data) {
    if (BzDeck.config.debug) {
      console.info('BugzfeedController.notify', data)
    }

    this.worker.postMessage(data);
  }

  /**
   * Connect to the WebSocket server.
   * @argument {undefined}
   * @return {undefined}
   */
  connect () {
    if (BzDeck.host) {
      this.notify({ command: 'Connect', endpoint: BzDeck.host.endpoints.websocket });
    }
  }

  /**
   * Disconnect from the WebSocket server.
   * @argument {undefined}
   * @return {undefined}
   */
  disconnect () {
    this.notify({ command: 'Disconnect' });
  }

  /**
   * Subscribe to one or more bugs. Because FlareTail.app.Events has the subscribe function, this function begins with
   * an underscore.
   * @argument {Array.<Number>} ids - Bug IDs to subscribe.
   * @return {undefined}
   */
  _subscribe (ids) {
    this.notify({ command: 'Subscribe', ids });
  }

  /**
   * Unsubscribe from one or more bugs.
   * @argument {Array.<Number>} ids - Bug IDs to unsubscribe.
   * @return {undefined}
   */
  _unsubscribe (ids) {
    this.notify({ command: 'Unsubscribe', ids });
  }
}
