/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Bug Controller. Most of the member functions are for updating bugs. See the Bugzilla API documentation for
 * details of the spec.
 * @extends BzDeck.BaseController
 * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/bug.html}
 */
BzDeck.BugController = class BugController extends BzDeck.BaseController {
  /**
   * Get a BugController instance.
   * @constructor
   * @argument {String} id_prefix - Prefix for the instance ID, such as home, search or details.
   * @argument {Object} bug - BugModel instance.
   * @return {Object} controller - New BugController instance.
   */
  constructor (id_prefix, bug) {
    super(); // This does nothing but is required before using `this`

    // Set the Controller (and View) ID. Add a timestamp to avoid multiple submissions (#303) but there would be a
    // better way to solve the issue... The Controller and View should be reused whenever possible.
    this.id = `${id_prefix}-${Date.now()}-bug-${bug.id}`;

    this.bug = bug;
    this.reset_changes();
    this.att_changes = new Map();

    this.uploads = Object.create(Array.prototype, {
      total:    { writable: true, value: 0 },
    });

    Object.defineProperties(this, {
      has_changes:      { get: () => !!Object.keys(this.changes).length },
      has_att_changes:  { get: () => !!this.att_changes.size },
      has_comment:      { get: () => !!this.changes.comment },
      has_attachments:  { get: () => !!this.uploads.length },
      has_errors:       { get: () => !!this.find_errors().length },
      can_submit:       { get: () => !this.has_errors &&
                                      (this.has_changes || this.has_att_changes || this.has_attachments) },
    });

    // Attachments
    this.on('V:AttachFiles', data => this.attach_files(data.files));
    this.on('V:AttachText', data => this.attach_text(data.text));
    this.on('V:RemoveAttachment', data => this.remove_attachment(data.hash));
    this.on('V:MoveUpAttachment', data => this.move_up_attachment(data.hash));
    this.on('V:MoveDownAttachment', data => this.move_down_attachment(data.hash));
    this.on('AttachmentView:EditAttachment', data => this.edit_attachment(data));

    // Subscription
    this.on('V:Subscribe', data => this.update_subscription('add'));
    this.on('V:Unsubscribe', data => this.update_subscription('remove'));

    // Other changes
    this.on('V:EditComment', data => this.edit_comment(data.text));
    this.on('V:EditField', data => this.edit_field(data.name, data.value));
    this.on('V:EditFlag', data => this.edit_flag(data.flag, data.added));
    this.on('V:AddParticipant', data => this.add_participant(data.field, data.email));
    this.on('V:RemoveParticipant', data => this.remove_participant(data.field, data.email));

    // Timeline
    this.subscribe('V:CommentSelected');

    // Form submission
    this.on('V:Submit', () => this.submit());

    // Add the people involved in the bug to the local user database
    BzDeck.collections.users.add_from_bug(this.bug);

    // Check the fragment; use a timer to wait for the timeline rendering
    window.setTimeout(window => this.check_fragment(), 150);
    window.addEventListener('popstate', event => this.check_fragment());
    window.addEventListener('hashchange', event => this.check_fragment());
  }

  /**
   * Called by BugTimelineEntryView whenever a comment is selected. Update the location hash to include the comment ID.
   * @argument {Object} data - Passed data.
   * @argument {Number} data.number - Comment number.
   * @return {undefined}
   */
  on_comment_selected (data) {
    if (location.pathname === `/bug/${this.bug.id}`) {
      window.history.replaceState({}, document.title, `${location.pathname}#c${data.number}`);
    }
  }

  /**
   * Called in the constructor and whenever the location fragment or history state is updated. If the current bug is
   * still displayed, fire an event so the relevant views can do something.
   * @argument {undefined}
   * @return {undefined}
   */
  check_fragment () {
    if (location.pathname === `/bug/${this.bug.id}`) {
      this.trigger(':HistoryUpdated', { hash: location.hash, state: history.state });
    }
  }

  /**
   * Create and return a Proxy for the bug changes object that fires an event whenever any field value is modified.
   * @argument {undefined}
   * @return {Proxy} changes - Changes object.
   */
  reset_changes () {
    this.changes = new Proxy({}, {
      set: (obj, name, value) => {
        if (obj[name] !== value) {
          obj[name] = value;
          this.trigger(':FieldEdited', { name, value });
        }

        return true;
      },
      deleteProperty: (obj, name) => {
        if (name in obj) {
          delete obj[name];
          this.trigger(':FieldEdited', { name, value: this.bug[name] || '' });
        }

        return true;
      }
    });

    return this.changes;
  }

  /**
   * Called internally whenever a bug field or an attachment property is edited by the user. Fire an event to notify the
   * views of the change.
   * @argument {undefined}
   * @return {undefined}
   */
  onedit () {
    let { changes, att_changes, uploads, can_submit } = this;

    this.trigger(':BugEdited', { changes, att_changes, uploads, can_submit });
  }

  /**
   * Called by BugView whenever a new comment is edited by the user. Cache the comment and notify changes accordingly.
   * @argument {String} comment - Comment text.
   * @return {undefined}
   */
  edit_comment (comment) {
    if (comment.match(/\S/)) {
      let added = !this.has_comment;

      this.changes.comment = { body: comment };

      if (added) {
        this.trigger(':CommentEdited', { added: true, has_comment: true, can_submit: this.can_submit });
        this.onedit();
      }
    } else {
      let removed = this.has_comment;

      delete this.changes.comment;

      if (removed) {
        this.trigger(':CommentEdited', { removed: true, has_comment: false, can_submit: this.can_submit });
        this.onedit();
      }
    }
  }

  /**
   * Called by BugView whenever any field is edited by the user. Cache the value and notify changes accordingly. Only
   * the following fields are supported at this moment: status, resolution, dupe_of.
   * @argument {String} name - Field name.
   * @argument {*} value - Field value.
   * @return {undefined}
   */
  edit_field (name, value) {
    let { field, product } = BzDeck.host.data.config,
        is_closed = value => field.status.closed.includes(value);

    if (['blocks', 'depends_on', 'see_also', 'dupe_of'].includes(name) &&
        typeof value === 'string' && value.match(/^\d+$/)) {
      value = Number.parseInt(value);
    }

    if (value === this.bug[name]) {
      delete this.changes[name];

      if (name === 'product') {
        delete this.changes.version;
        delete this.changes.component;
        delete this.changes.target_milestone;
      }

      if (name === 'status') {
        delete this.changes.resolution;
        delete this.changes.dupe_of;
      }
    } else if (value !== this.changes[name]) {
      this.changes[name] = value;

      // When the Product is updated, the Version, Component, Target Milestone have to be updated as well
      if (name === 'product') {
        let { version: versions, component, target_milestone_detail } = product[value],
            components = Object.keys(component),
            milestones = target_milestone_detail.filter(ms => ms.is_active).map(ms => ms.name);

        this.changes.version = versions.find(v => ['unspecified'].includes(v)) || versions[0];
        this.changes.component = components.find(c => ['General'].includes(c)) || components[0];
        this.changes.target_milestone = milestones.find(m => ['---'].includes(m)) || milestones[0];
      }

      if (name === 'status') {
        if (is_closed(value)) {
          if (this.bug.resolution !== 'FIXED') {
            this.changes.resolution = 'FIXED';
          } else {
            delete this.changes.resolution;
          }

          delete this.changes.dupe_of;
        } else {
          this.changes.resolution = '';
        }
      }
    }

    if (name === 'resolution' && value !== 'DUPLICATE') {
      delete this.changes.dupe_of;
    }

    this.onedit();
  }

  /**
   * Called by BugView whenever any flag is edited by the user. Cache the value and notify changes accordingly.
   * @argument {Object} flag - Flag change object.
   * @argument {Number} flag.id - Bugzilla-defined numeric ID of the flag.
   * @argument {String} flag.name - Type of the flag, such as 'review' or 'needinfo'.
   * @argument {String} flag.requestee - Person created the flag.
   * @argument {Boolean} added - Whether the flag is newly added.
   * @return {undefined}
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/bug.html}
   */
  edit_flag (flag, added) {
    let flags = this.changes.flags = this.changes.flags || [];

    if (added) {
      flags.push(flag);
    } else {
      let { id, name, requestee } = flag,
          index = flags.findIndex(f => f.id === id || (f.name === name && f.requestee === requestee));

      if (index > -1) {
        flags.splice(index, 1);
      }

      if (!flags.length) {
        delete this.changes.flags;
      }
    }

    this.trigger(':FlagEdited', { flags: this.changes.flags, flag, added });
    this.onedit();
  }

  /**
   * Called by BugView whenever a participant is added by the user. Cache the value and notify changes accordingly.
   * @argument {String} field - assigned_to, qa_contact, mentor or cc.
   * @argument {String} email - Account name of the participant to be added.
   * @return {Boolean} result - Whether the participant is successfully added to the cache.
   */
  add_participant (field, email) {
    if (['mentor', 'cc'].includes(field)) {
      let change = this.changes[field] || {};

      if ((change.remove || []).includes(email)) {
        change.remove.splice(change.remove.indexOf(email), 1);
      } else {
        change.add = change.add || [];

        if ((this.bug[field] || []).includes(email) || change.add.includes(email)) {
          return false;
        }

        change.add.push(email);
      }

      this.changes[field] = change;
    } else {
      if (this.changes[field] === email) {
        return false;
      }

      if (this.bug[field] === email) {
        delete this.changes[field];
      } else {
        this.changes[field] = email;
      }
    }

    this.trigger(':ParticipantAdded', { field, email });
    this.onedit();
    this.cleanup_multiple_item_change(field);

    return true;
  }

  /**
   * Called by BugView whenever a participant is removed by the user. Cache the value and notify changes accordingly.
   * @argument {String} field - assigned_to, qa_contact, mentor or cc.
   * @argument {String} email - Account name of the participant to be removed.
   * @return {Boolean} result - Whether the participant is successfully removed from the cache.
   */
  remove_participant (field, email) {
    if (['mentor', 'cc'].includes(field)) {
      let change = this.changes[field] || {};

      if ((change.add || []).includes(email)) {
        change.add.splice(change.add.indexOf(email), 1);
      } else {
        change.remove = change.remove || [];

        if (!(this.bug[field] || []).includes(email) || change.remove.includes(email)) {
          return false;
        }

        change.remove.push(email);
      }

      this.changes[field] = change;
    } else {
      this.changes[field] = field === 'assigned_to' ? BzDeck.host.default_assignee : '';
    }

    this.trigger(':ParticipantRemoved', { field, email });
    this.onedit();
    this.cleanup_multiple_item_change(field);

    return true;
  }

  /**
   * Subscribe to the bug by adding the user's email to the Cc list, or unsubscribe from the bug by removing the user's
   * email from the Cc list. Notify the result accordingly.
   * @argument {String} how - add or remove.
   * @return {Promise} request - Can be a rejected Promise if any error is found.
   */
  update_subscription (how) {
    let subscribe = how === 'add',
        email = BzDeck.account.data.name;

    // Update the view first
    this.trigger(subscribe ? ':ParticipantAdded' : ':ParticipantRemoved', { field: 'cc', email });

    return this.post_changes({ cc: { [how]: [email] }}).then(result => {
      if (result.error) {
        this.trigger(subscribe ? ':FailedToSubscribe' : ':FailedToUnsubscribe');
      } else {
        this.trigger(subscribe ? ':Subscribed' : ':Unsubscribed');
        this.fetch();
      }
    });
  }

  /**
   * Clean up a change with both additions and removals, such as mentor or cc. If there are no changes, removed the
   * object from the cache.
   * @argument {String} field - mentor or cc.
   * @return {Boolean} result - Whether the change object is updated.
   */
  cleanup_multiple_item_change (field) {
    let change = this.changes[field];

    if (!change) {
      return false;
    }

    if (change.remove && !change.remove.length) {
      delete change.remove;
    }

    if (change.add && !change.add.length) {
      delete change.add;
    }

    if (Object.keys(change).length) {
      this.changes[field] = change;
    } else {
      delete this.changes[field];
    }

    return true;
  }

  /**
   * Called by BugView whenever new attachment files are provided by the user through a file input form control or a
   * drag-and-drop action. Read and cache the files. If the file size exceeds Bugzilla's limitation, notify the error.
   * @argument {(FileList|Array)} files - Selected files.
   * @return {undefined}
   * @todo Integrate online storage APIs to upload large attachments (#111)
   */
  attach_files (files) {
    let oversized_files = new Set(),
        max_size = BzDeck.host.data.config.max_attachment_size;

    for (let _file of files) {
      let worker = new SharedWorker('/static/scripts/workers/tasks.js'),
          file = _file, // Redeclare the variable so it can be used in the following load event
          is_patch = /\.(patch|diff)$/.test(file.name) || /^text\/x-(patch|diff)$/.test(file.type);

      // Check if the file is not exceeding the limit
      if (file.size > max_size) {
        oversized_files.add(file);

        continue;
      }

      worker.port.addEventListener('message', event => {
        this.add_attachment({
          data: event.data.split(',')[1], // Drop 'data:<type>;base64,'
          summary: is_patch ? 'Patch' : file.name,
          file_name: file.name,
          content_type: is_patch ? 'text/plain' : file.type || 'application/x-download',
          is_patch,
        }, file.size);
      });

      worker.port.start();
      worker.port.postMessage(['readfile', { file }]);
    }

    if (!oversized_files.size) {
      return;
    }

    let message,
        num_format = num => num.toLocaleString('en-US'),
        max = num_format(max_size);

    if (oversized_files.size > 1) {
      message = `These files cannot be attached because they may exceed the maximum attachment size (${max} bytes) \
                 specified by the current Bugzilla instance. You can upload the files to an online storage and post \
                 the links instead.`; // l10n
    } else {
      message = `This file cannot be attached because it may exceed the maximum attachment size (${max} bytes) \
                 specified by the current Bugzilla instance. You can upload the file to an online storage and post the \
                 link instead.`; // l10n
    }

    message += '\n\n' + oversized_files.map(file => `* ${file.name} (${num_format(file.size)} bytes)`).join('\n');

    this.trigger(':AttachmentError', { message });
  }

  /**
   * Called whenever a new attachment text is provided by the user through a text input form control or a drag-and-drop
   * action. Read and cache the text.
   * @argument {String} text - Added plain text or URL string.
   * @return {undefined}
   */
  attach_text (text) {
    let worker = new SharedWorker('/static/scripts/workers/tasks.js'),
        blob = new Blob([text], { type: 'text/plain' }),
        summary = text.substr(0, 25) + (text.length > 25 ? '...' : ''),
        file_name = URL.createObjectURL(blob).match(/\w+$/)[0] + '.txt',
        content_type = 'text/plain',
        is_patch = !!text.match(/\-\-\-\ .*\n\+\+\+\ .*(?:\n[@\+\-\ ].*)+/m),
        is_ghpr = text.match(/^https:\/\/github\.com\/(.*)\/pull\/(\d+)$/),
        is_mrbr = text.match(/^https:\/\/reviewboard\.mozilla\.org\/r\/(\d+)\/$/);

    if (is_patch) {
      // TODO: Append a revision to the summary, based on the currently-attached patches if any
      summary = 'Patch';
    }

    if (is_ghpr) {
      summary = `GitHub Pull Request: ${is_ghpr[1]}#${is_ghpr[2]}`;
      content_type = 'text/x-github-pull-request';
    }

    if (is_mrbr) {
      summary = `MozReview Request: ${is_mrbr[1]}`;
      content_type = 'text/x-review-board-request';
    }

    worker.port.addEventListener('message', event => {
      let data = event.data.split(',')[1]; // Drop 'data:text/plain;base64,'

      this.add_attachment({ data, summary, file_name, content_type, is_patch }, blob.size);
    });

    worker.port.start();
    worker.port.postMessage(['readfile', { file: blob }]);
  }

  /**
   * Find an attachment index from the cached new attachment list by comparing the hash values.
   * @argument {String} hash - Hash value of the attachment object to find.
   * @return {Number} index - 0 or a positive integer if the attachment is found, -1 if not found.
   */
  find_att_index (hash) {
    return this.uploads.findIndex(a => a.hash === hash);
  }

  /**
   * Find an attachment object from the cached new attachment list by comparing the hash values.
   * @argument {String} hash - Hash value of the attachment object to find.
   * @return {Proxy} attachment - AttachmentModel instance if the attachment is found, undefined if not found
   */
  find_attachment (hash) {
    return this.uploads.find(a => a.hash === hash);
  }

  /**
   * Add an attachment to the cached new attachment list.
   * @argument {Object} att - Raw attachment upload object for Bugzilla.
   * @argument {Number} size - Actual file size.
   * @return {undefined}
   */
  add_attachment (att, size) {
    // Cache as an AttachmentModel instance
    BzDeck.collections.attachments.cache(att, size).then(attachment => {
      // Check if the file has already been attached
      if (this.find_attachment(attachment.hash)) {
        return;
      }

      this.uploads.push(attachment);

      this.trigger(':AttachmentAdded', { attachment });
      this.trigger(':UploadListUpdated', { uploads: this.uploads });
      this.onedit();
    });
  }

  /**
   * Remove an attachment from the cached new attachment list.
   * @argument {String} hash - Hash value of the attachment object to remove.
   * @return {Boolean} result - Whether the attachment is found and removed.
   */
  remove_attachment (hash) {
    let index = this.find_att_index(hash);

    if (index === -1) {
      return false;
    }

    this.uploads.splice(index, 1);

    this.trigger(':AttachmentRemoved', { index, hash });
    this.trigger(':UploadListUpdated', { uploads: this.uploads });
    this.onedit();

    return true;
  }

  /**
   * Edit a property of an unuploaded or existing attachment.
   * @argument {Object} change - Change details.
   * @argument {Number} change.id - Numeric ID for an existing attachment or undefined for an unuploaded one.
   * @argument {String} change.hash - Hash value for an unuploaded attachment or undefined for an existing one.
   * @argument {String} change.prop - Edited property name.
   * @argument {*}      change.value - New value.
   * @return {undefined}
   */
  edit_attachment (change) {
    let { id, hash, prop, value } = change;

    if (hash) {
      // Edit a new attachment
      let attachment = this.find_attachment(hash);

      if (attachment && attachment[prop] !== value) {
        attachment[prop] = value;

        this.trigger(':AttachmentEdited', { attachment, change });
        this.onedit();
      }

      return;
    }

    // Edit an existing attachment
    BzDeck.collections.attachments.get(id).then(attachment => {
      if (!attachment || attachment.bug_id !== this.bug.id) {
        return;
      }

      let changes = this.att_changes.get(id) || {},
          edited = true;

      // The properties prefixed with 'is_' are supposed to be a boolean but actually 0 or 1, so use the non-strict
      // inequality operator for comparison. This includes 'is_patch' and 'is_obsolete'.
      if (attachment[prop] != value) {
        changes[prop] = value;
      } else if (prop in changes) {
        delete changes[prop];
      } else {
        edited = false;
      }

      if (Object.keys(changes).length) {
        this.att_changes.set(id, changes);
      } else {
        this.att_changes.delete(id);
      }

      if (!edited) {
        return;
      }

      this.trigger(':AttachmentEdited', { attachment, change });
      this.onedit();
    });
  }

  /**
   * Move up an attachment within the cached new attachment list when the order of the unuploaded attachments matters.
   * @argument {String} hash - Hash value of the attachment object to move.
   * @return {Boolean} result - Whether the attachment is found and reordered.
   */
  move_up_attachment (hash) {
    let index = this.find_att_index(hash);

    if (index === -1) {
      return false;
    }

    this.uploads.splice(index - 1, 2, this.uploads[index], this.uploads[index - 1]);

    return true;
  }

  /**
   * Move down an attachment within the cached new attachment list when the order of the unuploaded attachments matters.
   * @argument {String} hash - Hash value of the attachment object to move.
   * @return {Boolean} result - Whether the attachment is found and reordered.
   */
  move_down_attachment (hash) {
    let index = this.find_att_index(hash);

    if (index === -1) {
      return false;
    }

    this.uploads.splice(index, 2, this.uploads[index + 1], this.uploads[index]);

    return true;
  }

  /**
   * Find any errors in the user-modified fields. Only the dupe_of field is supported at this moment.
   * @argument {undefined}
   * @return {Array.<String>} errors - List of the detected errors.
   */
  find_errors () {
    let errors = [];

    if (this.changes.resolution === 'DUPLICATE' && !this.changes.dupe_of ||
        this.changes.dupe_of !== undefined && typeof this.changes.dupe_of !== 'number' ||
        this.changes.dupe_of === this.bug.id) {
      errors.push('Please specify a valid duplicate bug ID.'); // l10n
    }

    if (this.changes.summary === '') {
      errors.push('The summary should not be empty.'); // l10n
    }

    return errors;
  }

  /**
   * Submit all the changes made on the bug to Bugzilla.
   * @argument {undefined}
   * @return {Promise} submission - Can be a rejected Promise if any error is found.
   */
  submit () {
    if (this.has_errors) {
      this.trigger(':SubmitError', { button_disabled: true, error: this.find_errors()[0] });

      return Promise.reject('The changes cannot be submitted because of errors.');
    }

    if (!this.can_submit) {
      return Promise.reject('No changes have been made on the bug.');
    }

    this.trigger(':Submit');

    this.uploads.total = 0;

    return new Promise((resolve, reject) => {
      if (!this.has_changes) {
        // Jump into the attachment(s)
        resolve();
      } else if (Object.keys(this.changes).length === 1 && this.has_comment && this.uploads.length === 1) {
        // If the comment is the only change and there's a single attachment, send the comment with the attachment
        this.uploads[0].comment = this.changes.comment.body;
        resolve();
      } else {
        // Post the changes first
        this.post_changes(this.changes).then(result => {
          if (result.error) {
            reject(new Error(result.message));
          } else {
            resolve();
          }
        }).catch(error => reject(new Error(error.message)));
      }
    }).then(() => {
      // Update existing attachment(s)
      return Promise.all([...this.att_changes].map(c => this.post_att_changes(c[0], c[1])));
    }).then(() => {
      if (!this.has_attachments) {
        // There is nothing more to do if no file is attached
        return Promise.resolve();
      }

      // Upload files in series
      return this.uploads.reduce((sequence, att) => sequence.then(() => this.post_attachment(att)), Promise.resolve());
    }).then(() => {
      // All done! Clear the cached changes and uploads data
      this.reset_changes();
      this.att_changes.clear();
      this.uploads.length = 0;
      this.uploads.total = 0;

      // The timeline will soon be updated via Bugzfeed. Fetch the bug only if Bugzfeed is not working for some reason
      this.fetch();

      this.trigger(':SubmitSuccess');
    }).catch(error => {
      // Failed to post at least one attachment
      this.trigger(':SubmitError', {
        button_disabled: false,
        error: error.message || 'Failed to post your comment or attachment(s). Try again later.',
      });
    }).then(() => {
      this.trigger(':SubmitComplete');
    });
  }

  /**
   * Post the meta data changes made on the bug to Bugzilla.
   * @argument {Object} data - Bug change object.
   * @return {Promise} request - Can be a rejected Promise if any error is found.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/bug.html#update-bug}
   */
  post_changes (data) {
    return BzDeck.host.request(`bug/${this.bug.id}`, null, { method: 'PUT', data });
  }

  /**
   * Post attachment changes to Bugzilla.
   * @argument {Number} att_id - Attachment ID.
   * @argument {Object} data - Attachment change object.
   * @return {Promise} request - Can be a rejected Promise if any error is found.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/attachment.html#update-attachment}
   */
  post_att_changes (att_id, data) {
    return BzDeck.host.request(`bug/attachment/${att_id}`, null, { method: 'PUT', data });
  }

  /**
   * Post the new attachments added to the bug to Bugzilla.
   * @argument {Proxy} attachment - AttachmentModel instance.
   * @return {Promise} request - Can be a rejected Promise if any error is found.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/attachment.html#create-attachment}
   */
  post_attachment (attachment) {
    let size_computable,
        size = 0;

    return BzDeck.host.request(`bug/${this.bug.id}/attachment`, null, {
      method: 'POST',
      data: Object.assign({}, attachment.data), // Clone the object to drop the custom properties (hash, uploaded)
      listeners: {
        progress: data => {
          if (!size) {
            size_computable = data.lengthComputable;
            size = data.total;
            this.uploads.total += size;
          }

          if (size_computable) {
            attachment.uploaded = data.loaded;
            this.notify_upload_progress();
          }
        }
      }
    }).then(result => {
      return result.error ? Promise.reject(new Error(result.message)) : Promise.resolve(result);
    }).then(result => {
      if (!size_computable) {
        attachment.uploaded = size;
        this.notify_upload_progress();
      }

      this.trigger(':AttachmentUploaded', { attachment });

      this.uploads.total -= attachment.uploaded;
      this.remove_attachment(attachment.hash);
    }).catch(error => {
      // Failed to post at least one attachment
      this.trigger(':AttachmentUploadError', {
        button_disabled: false,
        error: error.message || 'Failed to upload your attachment. Try again later.',
      });
    });
  }

  /**
   * Notify the upload progress while the new attachent is being uploaded to Bugzilla.
   * @argument {undefined}
   * @return {undefined}
   */
  notify_upload_progress () {
    let uploaded = this.uploads.map(att => att.uploaded).reduce((p, c) => p + c),
        total = this.uploads.total;

    this.trigger(':SubmitProgress', { uploaded, total, percentage: Math.round(uploaded / total * 100) });
  }

  /**
   * Retrieve the bug to update the timeline, when Bugzfeed is not working.
   * @argument {undefined}
   * @return {undefined}
   */
  fetch () {
    let bugzfeed = BzDeck.controllers.bugzfeed;

    if (!bugzfeed.connected || !bugzfeed.subscriptions.has(this.bug.id)) {
      this.bug.fetch();
    }
  }
}
