/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Bug Attachments View that represents the Attachment tabpanel content within a Bug Details tabpanel.
 * @extends BzDeck.BaseView
 */
BzDeck.BugAttachmentsView = class BugAttachmentsView extends BzDeck.BaseView {
  /**
   * Get a BugAttachmentsView instance.
   * @constructor
   * @argument {String} view_id - Instance identifier. It should be the same as the BugController instance, otherwise
   *  the relevant notification events won't work.
   * @argument {Number} bug_id - Corresponding bug ID.
   * @argument {HTMLElement} $container - Container node to render the attachments.
   * @return {Object} view - New BugAttachmentsView instance.
   */
  constructor (view_id, bug_id, $container) {
    super(); // This does nothing but is required before using `this`

    let mobile = this.helpers.env.device.mobile,
        mql = window.matchMedia('(max-width: 1023px)');

    this.id = view_id;
    this.bug_id = bug_id;
    this.attachments = new Map();

    this.$container = $container;
    this.$title = this.$container.querySelector('h4');
    this.$listbox = this.$container.querySelector('[role="listbox"]');
    this.$obsolete_checkbox = this.$container.querySelector('.list [role="checkbox"]');

    for (let $attachment of this.$container.querySelectorAll('[itemprop="attachment"]')) {
      $attachment.remove();
    }

    this.$$listbox = new this.widgets.ListBox(this.$listbox, []);
    this.$$listbox.bind('click', event => this.listbox_onclick(event));
    this.$$listbox.bind('dblclick', event => this.listbox_onclick(event));

    this.$$listbox.bind('Selected', event => {
      let $target = event.detail.items[0];

      if (!$target || mobile && mql.matches) {
        return;
      }

      let attachment = this.attachments.get($target.dataset.hash || Number($target.dataset.id));

      new this.widgets.ScrollBar(this.$container.querySelector('.content'));
      new BzDeck.AttachmentView(attachment, this.$container.querySelector('.content .scrollable-area-content'));

      this.trigger('BugView:AttachmentSelected', { attachment });
    });

    this.$$obsolete_checkbox = new this.widgets.CheckBox(this.$obsolete_checkbox);

    this.$$obsolete_checkbox.bind('Toggled', event => {
      let checked = event.detail.checked;

      for (let $att of this.$listbox.querySelectorAll('[role="option"]')) {
        $att.setAttribute('aria-hidden', checked ? 'false' : $att.querySelector('[itemprop="is_obsolete"]').content);
      }

      this.$$listbox.update_members();
    });

    this.init_uploader();

    this.subscribe('BugController:AttachmentAdded');
    this.subscribe('BugController:AttachmentRemoved');
    this.subscribe('BugController:AttachmentEdited');
    this.subscribe('BugController:UploadListUpdated');
    this.subscribe('BugController:HistoryUpdated');
  }

  /**
   * Render the provided attachments.
   * @argument {Array.<Proxy>} attachments - Attachment list of the bug.
   * @return {undefined}
   */
  render (attachments) {
    let $fragment = new DocumentFragment(),
        $listitem = this.get_template('details-attachment-listitem');

    attachments.reverse(); // The newest attachment should be on the top of the list

    Promise.all(attachments.map(att => {
      return BzDeck.collections.users.get(att.creator, { name: att.creator });
    })).then(creators => attachments.forEach((att, index) => {
      this.attachments.set(att.id || att.hash, att);

      this.fill($fragment.appendChild($listitem.cloneNode(true)), {
        id: att.hash ? att.hash.substr(0, 7) : att.id,
        summary: att.summary,
        last_change_time: att.last_change_time,
        creator: creators[index].properties,
        content_type: att.content_type,
        is_patch: !!att.is_patch,
        is_obsolete: !!att.is_obsolete,
        is_unuploaded: !!att.is_unuploaded,
      }, {
        id: `bug-${this.bug_id}-attachment-${att.hash ? att.hash.substr(0, 7) : att.id}`,
        'aria-hidden': !!att.is_obsolete,
        'data-id': att.id,
        'data-hash': att.hash,
      });
    })).then(() => {
      let has_obsolete = [...this.attachments.values()].some(a => !!a.is_obsolete);

      this.update_list_title();
      this.$obsolete_checkbox.setAttribute('aria-hidden', !has_obsolete);
      this.$listbox.insertBefore($fragment, this.$listbox.firstElementChild);
      this.$listbox.dispatchEvent(new CustomEvent('Rendered'));
      this.$$listbox.update_members();
    });
  }

  /**
   * Called whenever the attachment list is clicked.
   * @argument {MouseEvent} event - click or dblclick.
   * @return {undefined}
   */
  listbox_onclick (event) {
    let $selected = this.$$listbox.view.selected[0],
        id = $selected ? $selected.dataset.hash || Number($selected.dataset.id) : undefined,
        mobile = this.helpers.env.device.mobile,
        narrow = window.matchMedia('(max-width: 1023px)').matches;

    if (id && ((event.type === 'click' && mobile && narrow) || event.type === 'dblclick')) {
      this.trigger('GlobalView:OpenAttachment', { id });
    }
  }

  /**
   * Initialize the attachment uploading interface. This offers Add/Remove buttons as well as the drag-and-drop support.
   * @argument {undefined}
   * @return {undefined}
   */
  init_uploader () {
    this.$drop_target = this.$container.querySelector('[aria-dropeffect]');
    this.$add_button = this.$container.querySelector('[data-command="add-attachment"]');
    this.$remove_button = this.$container.querySelector('[data-command="remove-attachment"]');
    this.$file_picker = this.$container.querySelector('input[type="file"]');

    this.$drop_target.addEventListener('dragover', event => {
      this.$drop_target.setAttribute('aria-dropeffect', 'copy');
      event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed = 'copy';
      event.preventDefault();
    });

    this.$drop_target.addEventListener('dragleave', event => {
      this.$drop_target.setAttribute('aria-dropeffect', 'none');
      event.preventDefault();
    });

    this.$drop_target.addEventListener('drop', event => {
      let dt = event.dataTransfer;

      if (dt.types.contains('Files')) {
        this.trigger('BugView:FilesSelected', { input: dt });
      } else if (dt.types.contains('text/plain')) {
        this.trigger('BugView:AttachText', { text: dt.getData('text/plain') });
      }

      this.$drop_target.setAttribute('aria-dropeffect', 'none');
      event.preventDefault();
    });

    this.$$listbox.bind('Selected', event => {
      let $selected = this.$$listbox.view.selected[0],
          hash = $selected ? $selected.dataset.hash : undefined;

      this.$remove_button.setAttribute('aria-disabled', !hash);
    });

    this.$$listbox.assign_key_bindings({
      'Backspace': event => {
        let $selected = this.$$listbox.view.selected[0],
            hash = $selected ? $selected.dataset.hash : undefined;

        if (hash) {
          this.trigger('BugView:RemoveAttachment', { hash });
          this.$remove_button.setAttribute('aria-disabled', 'true');
        }
      },
    });

    let can_choose_dir = this.$file_picker.isFilesAndDirectoriesSupported === false;

    if (can_choose_dir) {
      this.$add_button.title = 'Add attachments... (Shift+Click to choose directory)'; // l10n
    }

    this.$add_button.addEventListener('click', event => {
      can_choose_dir && event.shiftKey ? this.$file_picker.chooseDirectory() : this.$file_picker.click();
    });

    this.$remove_button.addEventListener('mousedown', event => {
      this.trigger('BugView:RemoveAttachment', { hash: this.$$listbox.view.selected[0].dataset.hash });
      this.$remove_button.setAttribute('aria-disabled', 'true');
    });

    this.$file_picker.addEventListener('change', event => {
      this.trigger('BugView:FilesSelected', { input: event.target });
    });
  }

  /**
   * Called by BugController whenever a new attachment is added by the user. Add the item to the listbox.
   * @argument {Object} data - Passed data.
   * @argument {Proxy}  data.attachment - Added attachment data as AttachmentModel instance.
   * @return {undefined}
   */
  on_attachment_added (data) {
    let { attachment } = data;

    this.attachments.set(attachment.hash, attachment);
    this.render([attachment]);
  }

  /**
   * Called by BugController whenever a new attachment is removed by the user. Remove the item from the listbox.
   * @argument {Object} data - Passed data.
   * @argument {String} data.hash - Removed attachment's hash value in the cached list.
   * @return {undefined}
   */
  on_attachment_removed (data) {
    let { hash } = data;

    this.attachments.delete(hash);
    this.$listbox.querySelector(`[data-hash='${hash}']`).remove();
    this.$listbox.dispatchEvent(new CustomEvent('Rendered'));
    this.$$listbox.update_members();
  }

  /**
   * Called by BugController whenever a new attachment is edited by the user. Update the item on the listbox.
   * @argument {Object} data - Passed data.
   * @argument {Object} data.change - Change details.
   * @argument {Number} data.change.id - Numeric ID for an existing attachment or undefined for an unuploaded one.
   * @argument {String} data.change.hash - Hash value for an unuploaded attachment or undefined for an existing one.
   * @argument {String} data.change.prop - Edited property name.
   * @argument {*}      data.change.value - New value.
   * @return {undefined}
   */
  on_attachment_edited (data) {
    let { id, hash, prop, value } = data.change,
        $item = this.$listbox.querySelector(`[data-${hash ? 'hash' : 'id'}='${hash || id}']`);

    if (['summary', 'content_type'].includes(prop)) {
      $item.querySelector(`[itemprop="${prop}"]`).textContent = value;
    }

    if (['is_patch', 'is_obsolete'].includes(prop)) {
      $item.querySelector(`[itemprop="${prop}"]`).content = value;
    }
  }

  /**
   * Called by BugController whenever a new attachment is added or removed by the user. Update the list header title.
   * @argument {Object} data - Passed data.
   * @argument {Array.<Proxy>} data.uploads - List of the new attachments in Array-like object.
   * @return {undefined}
   */
  on_upload_list_updated (data) {
    this.update_list_title();
  }

  /**
   * Update the list header title, showing the number of the attachments including unuploaded ones.
   * @argument {undefined}
   * @return {undefined}
   */
  update_list_title () {
    let total = this.attachments.size,
        uploads = [...this.attachments.values()].filter(att => att.is_unuploaded).length,
        text = total === 1 ? '1 attachment' : `${total} attachments`; // l10n

    if (uploads > 0) {
      text += ' ' + `(${uploads} unuploaded)`; // l10n
    }

    this.$title.textContent = text;
  }

  /**
   * Called whenever the navigation history state is updated. If a valid attachment ID is specified, select that item on
   * the listbox.
   * @argument {Object} data - Passed data.
   * @argument {Object} [data.state] - Current history state.
   * @argument {String} [data.state.att_id] - Attachment ID or hash.
   * @return {undefined}
   */
  on_history_updated (data) {
    let target_id = data.state ? data.state.att_id : undefined,
        $target = target_id ? this.$listbox.querySelector(`[id$='attachment-${target_id}']`) : undefined;

    if ($target && !this.helpers.env.device.mobile && !window.matchMedia('(max-width: 1023px)').matches) {
      if ($target.matches('[data-obsolete="true"]') && !this.$$obsolete_checkbox.checked) {
        this.$obsolete_checkbox.click();
      }

      this.$$listbox.view.selected = this.$$listbox.view.focused = $target;
    }
  }
}
