/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Attachment Collection that represents all downloaded bug attachments. Each attachment is an
 * AttachmentModel.
 * @extends BzDeck.BaseCollection
 */
BzDeck.AttachmentCollection = class AttachmentCollection extends BzDeck.BaseCollection {
  /**
   * Get an AttachmentCollection instance.
   * @constructor
   * @argument {undefined}
   * @return {Object} attachments - New AttachmentCollection instance.
   */
  constructor () {
    super(); // This does nothing but is required before using `this`

    this.model = BzDeck.AttachmentModel;
  }

  /**
   * Load the all attachment data from local bug cache, create a new AttachmentModel instance for each item, cache them
   * in a new Map for faster access, then return a Promise in a way consistent with the super load method.
   * @argument {undefined}
   * @return {Promise.<Map.<Number, Proxy>>} attachments - Promise to be resolved in a map of AttachmentModel instances.
   *  The map key is usually an attachment ID, but it can be a hash value for an unuploaded attachment as the cache
   *  method below shows.
   */
  load () {
    this.map = new Map();

    return BzDeck.collections.bugs.get_all().then(bugs => {
      for (let [id, bug] of bugs) for (let att of bug.attachments || []) {
        this.map.set(att.id, new this.model(att));
      }
    }).then(() => this.map);
  }

  /**
   * Cache data for an unuploaded attachment temporarily on memory. Add custom properties to make it easier to find the
   * cached attachment, track the upload status and update the view. Those properties are unenumerable so later dropped
   * by Object.assign() before the data is sent through the API.
   * @argument {Object} att - Raw attachment upload object for Bugzilla.
   * @argument {Number} size - Actual file size.
   * @return {Promise.<Proxy>} attachment - Promise to be resolved in AttachmentModel instance.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/attachment.html#create-attachment}
   */
  cache (att, size) {
    let current_time = (new Date()).toISOString();

    Object.defineProperties(att, {
      // Add custom properties
      uploaded: { writable: true, value: 0 },
      hash: { value: md5([att.file_name, att.content_type, String(size)].join()) },
      is_unuploaded: { value: true },
      // Emulate properties on the existing attachment objects
      creator: { value: BzDeck.account.data.name },
      creation_time: { value: current_time },
      last_change_time: { value: current_time },
      size: { value: size },
      is_obsolete: { value: false },
    });

    att = new this.model(att);
    this.map.set(att.hash, att);

    return Promise.resolve(att);
  }
}
